// Diagnostica one-off v6: dove sono le bozze create dal sistema e dove la
// notifica del test (ricerca su TUTTA la casella, con etichette Gmail).
// Output senza dati personali.
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const marker = process.env.MARKER || 'testdiagnostica';
const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, connectionTimeout: 20000, socketTimeout: 45000 });
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const drafts = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts'))?.path || '[Gmail]/Bozze';
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
console.log('drafts:', drafts, '| all:', allMail);

const describe = async (folder, query, label) => {
  const lock = await client.getMailboxLock(folder);
  try {
    let uids = [];
    try { uids = await client.search(query); } catch (e) { console.log(label, 'ERR', String(e.message).slice(0, 80)); return; }
    console.log(label, '->', uids.length, uids.length ? 'uids ' + uids.slice(-5).join(',') : '');
    for (const uid of uids.slice(-5)) {
      try {
        let meta = null;
        for await (const m of client.fetch(String(uid), { envelope: true, threadId: true, internalDate: true, labels: true }, { uid: true })) {
          meta = { date: m.internalDate, thread: m.threadId, labels: m.labels || [], subjLen: String(m.envelope?.subject || '').length };
        }
        if (!meta) { console.log('  uid', uid, 'no envelope'); continue; }
        console.log('  uid', uid, '|', new Date(meta.date).toISOString().slice(0, 16), '| thread', meta.thread ?? '-', '| labels', JSON.stringify(meta.labels), '| subjLen', meta.subjLen);
      } catch (e) { console.log('  uid', uid, 'ERR', String(e.message).slice(0, 90)); }
    }
  } finally { lock.release(); }
};

await describe(allMail, { to: marker }, 'allMail to:marker');
await describe(allMail, { header: { 'X-CEMFORM-Draft': 'info-form' } }, 'allMail header:X-CEMFORM-Draft');
await describe(allMail, { body: marker }, 'allMail body:marker');
await describe(drafts, { all: true }, 'drafts all');

client.close();
