// Diagnostica one-off v7: etichetta e mittente del messaggio indirizzato al test.
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
console.log('folders:', flat.map((b) => b.path + (b.specialUse ? `[${b.specialUse}]` : '')).join(' | ').slice(0, 900));
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
const drafts = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts'))?.path || '[Gmail]/Bozze';

let lock = await client.getMailboxLock(allMail);
let uid = null;
try {
  const uids = await client.search({ to: marker });
  console.log('allMail to:marker ->', uids.length);
  uid = uids[uids.length - 1] || null;
  if (uid) {
    for await (const m of client.fetch(String(uid), { labels: true, internalDate: true }, { uid: true })) {
      console.log('  uid', uid, '|', new Date(m.internalDate).toISOString().slice(0, 16), '| labels', JSON.stringify(m.labels || []));
    }
  }
} catch (e) { console.log('  to:marker ERR', String(e.message).slice(0, 100)); } finally { lock.release(); }

if (uid) {
  lock = await client.getMailboxLock(allMail);
  try {
    for await (const m of client.fetch(String(uid), { envelope: true }, { uid: true })) {
      const from = String(m.envelope?.from?.[0]?.address || '');
      const to = (m.envelope?.to || []).map((t) => String(t.address || ''));
      console.log('  fromDomain:', from.split('@')[1] || '-', '| toCount:', to.length, '| toDomain:', (to[0] || '').split('@')[1] || '-', '| subjLen:', String(m.envelope?.subject || '').length);
    }
  } catch (e) { console.log('  envelope ERR', String(e.message).slice(0, 100)); } finally { lock.release(); }
}

lock = await client.getMailboxLock(drafts);
try {
  const uids = await client.search({ all: true });
  console.log('drafts total:', uids.length);
  for await (const m of client.fetch(uids.slice(-6), { internalDate: true, envelope: true }, { uid: true })) {
    console.log('  draft', m.uid, '|', new Date(m.internalDate).toISOString().slice(0, 16), '| subjLen', String(m.envelope?.subject || '').length);
  }
} catch (e) { console.log('drafts ERR', String(e.message).slice(0, 100)); } finally { lock.release(); }

client.close();
