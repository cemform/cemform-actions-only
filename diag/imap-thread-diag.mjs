// Diagnostica one-off: dove arrivano le notifiche Web3Forms e come Gmail
// assegna il thread a una bozza APPEND con In-Reply-To/References.
// Output volutamente privo di dati personali (solo date, thread id, domini, booleani).
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user, pass }, logger: false,
  connectionTimeout: 20000, socketTimeout: 45000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }

await client.connect();
walk(await client.list());
const findFolder = (test) => flat.find(test)?.path || null;
const inbox = 'INBOX';
const allMail = findFolder((b) => String(b.specialUse || '').toLowerCase().includes('\\all') || /all mail|tutti i messaggi/i.test(b.path));
const drafts = findFolder((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts') || /(^|\/)(drafts|bozze)$/i.test(b.path));
console.log('RESOLVED:', { inbox, allMail, drafts });

const since = new Date(Date.now() - 90 * 864e5);
const queries = [
  { label: 'from:web3forms', q: { from: 'web3forms' } },
  { label: 'subject:richiesta info', q: { subject: 'Richiesta info' } },
  { label: 'subject:nuova richiesta', q: { subject: 'Nuova richiesta' } },
  { label: 'body:web3forms', q: { body: 'web3forms' } },
  { label: 'body:access_key', q: { body: 'access_key' } },
];

for (const folder of [allMail, inbox].filter(Boolean)) {
  const lock = await client.getMailboxLock(folder);
  try {
    for (const { label, q } of queries) {
      let uids = [];
      try { uids = await client.search({ since, ...q }); } catch (e) { console.log(folder, label, 'ERR', String(e.message).slice(0, 60)); continue; }
      console.log(folder, label, '->', uids.length);
      if (!uids.length) continue;
      const last = uids.slice(-1)[0];
      for await (const m of client.fetch(String(last), { envelope: true, threadId: true }, { uid: true })) {
        const from = String(m.envelope?.from?.[0]?.address || '');
        console.log('   last:', new Date(m.envelope?.date).toISOString().slice(0, 16), '| domain:', from.split('@')[1] || '-', '| thread:', m.threadId ?? '-', '| subjLen:', String(m.envelope?.subject || '').length);
      }
    }
  } finally { lock.release(); }
}

// Verifica threading solo se esiste una notifica reale.
let candidate = null;
{
  const lock = await client.getMailboxLock(allMail || inbox);
  try {
    const uids = await client.search({ since, or: [{ from: 'web3forms' }, { subject: 'Richiesta info' }] }).catch(() => []);
    if (uids.length) {
      for await (const m of client.fetch(String(uids[uids.length - 1]), { envelope: true, threadId: true, source: true }, { uid: true })) {
        const raw = m.source ? m.source.toString('utf8') : '';
        const mm = raw.match(/^Message-ID:\s*(<[^>]+>)/im);
        const mid = mm ? mm[1].trim() : (m.envelope?.messageId ? `<${String(m.envelope.messageId).replace(/^<|>$/g, '')}>` : null);
        const refs = (raw.match(/^References:\s*(.+)$/im)?.[1] || '').trim().replace(/\s+/g, ' ');
        candidate = { uid: m.uid, threadId: m.threadId, subject: String(m.envelope?.subject || ''), msgId: mid, references: refs ? `${refs} ${mid}` : mid };
      }
    }
  } finally { lock.release(); }
}

if (!candidate || !candidate.msgId) {
  console.log('NO_NOTIFICATION_FOUND -> threading non testabile su notifica reale');
  client.close();
  process.exit(0);
}
console.log('NOTIFICATION found | thread:', candidate.threadId ?? '-', '| refs:', !!candidate.references);

const makeDraft = async (label, subject) => {
  const raw = [
    'From: CEMFORM <' + user + '>',
    'To: ' + user,
    'Subject: ' + subject,
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <diag.' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@cemform.it>',
    'In-Reply-To: ' + candidate.msgId,
    'References: ' + candidate.references,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'diagnostica threading',
  ].join('\r\n');
  const res = await client.append(drafts, raw, ['\\Draft']);
  let tid = null;
  if (res?.uid) {
    const lock = await client.getMailboxLock(drafts);
    try {
      for await (const m of client.fetch(String(res.uid), { threadId: true }, { uid: true })) tid = m.threadId;
    } finally { lock.release(); }
  }
  console.log(label, '| draft thread:', tid ?? '-', '| sameThread:', String(tid) === String(candidate.threadId), '| uid:', res?.uid || '-');
  return res?.uid || null;
};

const ua = await makeDraft('A_oggetto_diverso', 'Informazioni diagnostica threading');
const ub = await makeDraft('B_reply_subject', 'Re: ' + candidate.subject.replace(/^re:\s*/i, ''));

if (ua || ub) {
  const lock = await client.getMailboxLock(drafts);
  try {
    for (const uid of [ua, ub].filter(Boolean)) await client.messageDelete(String(uid), { uid: true });
    console.log('cleanup ok');
  } finally { lock.release(); }
}

client.close();
