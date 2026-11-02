// v11: pulizia definitiva dei test (notifiche + bozze) e verifica finale.
import { ImapFlow } from 'imapflow';

const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  logger: false, connectionTimeout: 25000, socketTimeout: 60000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 140)));

const tags = ['testdiagnostica', 'threadlatency123', 'threadcheck456', 'latency789', 'threadfix901'];

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
const drafts = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts'))?.path || '[Gmail]/Bozze';

let lock = await client.getMailboxLock(allMail);
try {
  for (const tag of tags) {
    const uids = await client.search({ body: tag }, { uid: true });
    console.log(`body:${tag} ->`, uids.length, uids.join(','));
    if (uids.length) {
      try { await client.messageDelete(uids.join(','), { uid: true }); console.log('  deleted', uids.length); }
      catch (e) { console.log('  delete ERR', String(e.message).slice(0, 100)); }
    }
  }
} finally { lock.release(); }

lock = await client.getMailboxLock(drafts);
try {
  const uids = await client.search({ all: true }, { uid: true });
  console.log('drafts remaining:', uids.length);
  const hits = [];
  for await (const m of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
    const raw = m.source ? m.source.toString('utf8') : '';
    const isTest = tags.some((t) => raw.toLowerCase().includes(t));
    if (isTest) hits.push(m.uid);
    console.log('  draft', m.uid, '| test:', isTest ? 'Y' : 'N', '| subjLen', String(m.envelope?.subject || '').length);
  }
  if (hits.length) {
    try { await client.messageDelete(hits.join(','), { uid: true }); console.log('deleted test drafts:', hits.length); }
    catch (e) { console.log('draft delete ERR', String(e.message).slice(0, 100)); }
  }
} finally { lock.release(); }

client.close();
