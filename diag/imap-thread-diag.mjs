// Diagnostica one-off v3: verifica che la bozza creata da /api/info stia nello
// stesso thread Gmail (X-GM-THRID) della notifica Web3Forms, poi pulisce i test.
// Nessun dato personale in output: solo date, thread id, booleani, conteggi.
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const target = process.env.TARGET || 'cemformazione+testdiagnostica@gmail.com';
const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user, pass }, logger: false,
  connectionTimeout: 20000, socketTimeout: 45000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
const findFolder = (test) => flat.find(test)?.path || null;

await client.connect();
walk(await client.list());
const inbox = 'INBOX';
const drafts = findFolder((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts') || /(^|\/)(drafts|bozze)$/i.test(b.path));

const fetchLast = async (folder, query, n, opts = {}) => {
  const lock = await client.getMailboxLock(folder);
  try {
    let uids = [];
    try { uids = await client.search(query); } catch (e) { console.log(folder, 'search ERR', String(e.message).slice(0, 80)); return []; }
    const out = [];
    for await (const m of client.fetch(uids.slice(-n), { envelope: true, threadId: true, internalDate: true, source: true, ...opts }, { uid: true })) {
      out.push({ uid: m.uid, threadId: m.threadId ? String(m.threadId) : null, date: m.internalDate, subject: String(m.envelope?.subject || ''), raw: m.source ? m.source.toString('utf8') : '' });
    }
    return out;
  } finally { lock.release(); }
};

// 1) notifiche Web3Forms (ultime 5 per data di arrivo)
const notifs = await fetchLast(inbox, { from: 'web3forms' }, 5);
notifs.sort((a, b) => new Date(b.date) - new Date(a.date));
console.log('notifications:', notifs.length, '| newest:', notifs[0] ? new Date(notifs[0].date).toISOString().slice(0, 19) : '-', '| thread:', notifs[0]?.threadId ?? '-');

// 2) bozze create dal sistema (ultime 5)
const dr = await fetchLast(drafts, { all: true }, 60);
const drInfo = dr.filter((m) => /X-CEMFORM-Draft:\s*info-form/i.test(m.raw)).sort((a, b) => new Date(b.date) - new Date(a.date));
const newestDraft = drInfo[0];
console.log('cemform drafts:', drInfo.length, '| newest:', newestDraft ? new Date(newestDraft.date).toISOString().slice(0, 19) : '-', '| thread:', newestDraft?.threadId ?? '-', '| subjRe:', /^re\s*:/i.test(newestDraft?.subject || '') ? 'si' : 'no', '| hasRefs:', /^References:/im.test(newestDraft?.raw || '') ? 'si' : 'no', '| toTarget:', (newestDraft?.raw || '').toLowerCase().includes(target.toLowerCase()) ? 'si' : 'no');

if (notifs[0] && newestDraft) {
  console.log('THREAD MATCH:', String(notifs[0].threadId) === String(newestDraft.threadId));
}

// 3) cleanup: notifiche e bozze di test
const inboxHits = await fetchLast(inbox, { from: 'web3forms' }, 40);
const delInbox = inboxHits.filter((m) => m.raw.toLowerCase().includes(target.toLowerCase())).map((m) => m.uid);
if (delInbox.length) {
  const lock = await client.getMailboxLock(inbox);
  try { await client.messageDelete(delInbox.join(','), { uid: true }); console.log('deleted test notifications:', delInbox.length); } finally { lock.release(); }
}
const draftHits = await fetchLast(drafts, { all: true }, 80);
const delDrafts = draftHits.filter((m) => /X-CEMFORM-Draft:\s*info-form/i.test(m.raw) && m.raw.toLowerCase().includes(target.toLowerCase())).map((m) => m.uid);
if (delDrafts.length) {
  const lock = await client.getMailboxLock(drafts);
  try { await client.messageDelete(delDrafts.join(','), { uid: true }); console.log('deleted test drafts:', delDrafts.length); } finally { lock.release(); }
}

client.close();
