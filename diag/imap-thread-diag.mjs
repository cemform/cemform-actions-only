// Diagnostica one-off v8: quando arrivano le notifiche del test e con che etichetta.
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const marker = process.env.MARKER || 'testdiagnostica';
const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, connectionTimeout: 25000, socketTimeout: 60000 });
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
const drafts = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts'))?.path || '[Gmail]/Bozze';

const lock = await client.getMailboxLock(allMail);
try {
  for (const [label, q] of [['body:marker', { body: marker }], ['to:marker', { to: marker }]]) {
    const uids = await client.search(q);
    console.log(label, '->', uids.length, uids.slice(-6).join(','));
    for (const uid of uids.slice(-6)) {
      const m = await client.fetchOne(String(uid), { envelope: true, internalDate: true, labels: true }, { uid: true });
      if (!m) { console.log('  uid', uid, 'fetchOne false'); continue; }
      console.log('  uid', uid, '|', new Date(m.internalDate).toISOString().slice(0, 19), '| labels', JSON.stringify(m.labels || []), '| fromDom', String(m.envelope?.from?.[0]?.address || '').split('@')[1] || '-', '| subjLen', String(m.envelope?.subject || '').length);
    }
  }
} finally { lock.release(); }

const dl = await client.getMailboxLock(drafts);
try {
  const uids = await client.search({ all: true });
  console.log('drafts total:', uids.length, uids.slice(-6).join(','));
  for (const uid of uids.slice(-6)) {
    const m = await client.fetchOne(String(uid), { envelope: true, internalDate: true }, { uid: true });
    if (!m) { console.log('  draft', uid, 'fetchOne false'); continue; }
    console.log('  draft', uid, '|', new Date(m.internalDate).toISOString().slice(0, 19), '| subjLen', String(m.envelope?.subject || '').length);
  }
} finally { dl.release(); }

client.close();
