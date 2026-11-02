// Diagnostica one-off: dove arrivano le notifiche Web3Forms e come Gmail
// assegna il thread a una bozza APPEND con In-Reply-To/References.
// Output volutamente privo di dati personali (solo date, thread id, booleani).
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user, pass }, logger: false,
  connectionTimeout: 20000, socketTimeout: 40000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }

const isWeb3 = (env) => {
  const from = String(env?.from?.[0]?.address || '').toLowerCase();
  const subj = String(env?.subject || '');
  return from.includes('web3forms') || /richiesta info|nuova richiesta|new submission/i.test(subj);
};

await client.connect();
walk(await client.list());
console.log('FOLDERS:', flat.map((b) => `${b.path}${b.specialUse ? ` [${b.specialUse}]` : ''}`).join(' | '));

const findFolder = (test) => flat.find(test)?.path || null;
const inbox = 'INBOX';
const allMail = findFolder((b) => String(b.specialUse || '').toLowerCase().includes('\\all') || /all mail|tutti i messaggi/i.test(b.path));
const drafts = findFolder((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts') || /(^|\/)(drafts|bozze)$/i.test(b.path)) || '[Gmail]/Bozze';
console.log('RESOLVED:', { inbox, allMail, drafts });

const since = new Date(Date.now() - 30 * 864e5);
let candidate = null;
for (const folder of [inbox, allMail].filter(Boolean)) {
  const lock = await client.getMailboxLock(folder);
  try {
    let uids = [];
    try { uids = await client.search({ since }); } catch (e) { console.log(folder, 'search err', String(e.message).slice(0, 80)); }
    console.log(folder, 'since30d:', uids.length);
    const last = uids.slice(-80);
    const hits = [];
    for await (const m of client.fetch(last, { envelope: true, threadId: true }, { uid: true })) {
      if (isWeb3(m.envelope)) hits.push({ uid: m.uid, threadId: m.threadId, date: m.envelope?.date, subject: String(m.envelope?.subject || ''), from: String(m.envelope?.from?.[0]?.address || '') });
    }
    console.log(folder, 'web3-like:', hits.length);
    if (hits.length) {
      const lastHit = hits[hits.length - 1];
      console.log('  latest:', new Date(lastHit.date).toISOString().slice(0, 16), '| thread:', lastHit.threadId ?? '-', '| fromDomain:', lastHit.from.split('@')[1] || '-');
      if (!candidate) candidate = lastHit;
    }
  } finally { lock.release(); }
}

if (!candidate) {
  console.log('NO_WEB3_MESSAGE_FOUND -> impossibile testare il threading su una notifica reale');
  client.close();
  process.exit(0);
}

// Serve il Message-ID originale dalla fonte completa.
let msgId = null;
{
  const lock = await client.getMailboxLock(inbox);
  try {
    for await (const m of client.fetch(String(candidate.uid), { source: true, envelope: true }, { uid: true })) {
      const raw = m.source ? m.source.toString('utf8') : '';
      const mm = raw.match(/^Message-ID:\s*(<[^>]+>)/im);
      msgId = mm ? mm[1].trim() : null;
      if (!msgId && m.envelope?.messageId) msgId = `<${String(m.envelope.messageId).replace(/^<|>$/g, '')}>`;
      const refs = (raw.match(/^References:\s*(.+)$/im)?.[1] || '').trim().replace(/\s+/g, ' ');
      candidate.references = refs ? `${refs} ${msgId}` : msgId;
    }
  } finally { lock.release(); }
}
console.log('NOTIFICATION Message-ID present:', !!msgId, '| threadId present:', !!candidate.threadId);

const build = (subject, mid, refs) => [
  'From: CEMFORM <' + user + '>',
  'To: ' + user,
  'Subject: ' + subject,
  'Date: ' + new Date().toUTCString(),
  'Message-ID: <diag.' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@cemform.it>',
  'In-Reply-To: ' + mid,
  'References: ' + refs,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'diagnostica threading',
].join('\r\n');

const appended = [];
const makeDraft = async (label, subject) => {
  const raw = build(subject, msgId, candidate.references);
  const res = await client.append(drafts, raw, ['\\Draft']);
  const entry = { label, uid: res?.uid || null, threadId: null };
  if (entry.uid) {
    const lock = await client.getMailboxLock(drafts);
    try {
      for await (const m of client.fetch(String(entry.uid), { threadId: true }, { uid: true })) entry.threadId = m.threadId;
    } finally { lock.release(); }
  }
  appended.push(entry);
  console.log(label, '-> draft thread:', entry.threadId ?? '-', '| matches notification:', String(entry.threadId) === String(candidate.threadId));
};

// A: oggetto diverso (come fa oggi Gemini). B: "Re: <oggetto notifica>" (come il tasto Rispondi).
await makeDraft('A_oggetto_diverso', 'Informazioni diagnostica threading');
await makeDraft('B_reply_subject', 'Re: ' + candidate.subject.replace(/^re:\s*/i, ''));

// Pulizia: rimuove le due bozze di test.
const lock = await client.getMailboxLock(drafts);
try {
  for (const entry of appended) {
    if (entry.uid) await client.messageDelete(String(entry.uid), { uid: true });
  }
  console.log('cleanup drafts:', appended.filter((e) => e.uid).length);
} finally { lock.release(); }

client.close();
