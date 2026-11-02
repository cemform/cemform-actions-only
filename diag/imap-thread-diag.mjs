// Diagnostica one-off v4: dove finisce la notifica Web3Forms del test e dove
// sono le bozze create dal sistema. Output senza dati personali.
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const marker = process.env.MARKER || 'testdiagnostica';
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
const drafts = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\drafts'))?.path || '[Gmail]/Bozze';
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
console.log('drafts path:', drafts);

const scan = async (folder, query, label, n = 8) => {
  const lock = await client.getMailboxLock(folder);
  try {
    let uids = [];
    try { uids = await client.search(query); } catch (e) { console.log(folder, label, 'ERR', String(e.message).slice(0, 70)); return; }
    console.log(folder, label, '->', uids.length);
    if (!uids.length) return;
    const rows = [];
    for await (const m of client.fetch(uids.slice(-n), { envelope: true, threadId: true, internalDate: true, source: true }, { uid: true })) {
      const raw = m.source ? m.source.toString('utf8') : '';
      const to = raw.match(/^To:\s*(.+)$/im)?.[1] || '';
      const toDomain = (to.match(/@([a-z0-9.-]+)/i) || [])[1] || '-';
      const from = raw.match(/^From:\s*(.+)$/im)?.[1] || '';
      const fromDomain = (from.match(/@([a-z0-9.-]+)/i) || [])[1] || '-';
      rows.push(`${new Date(m.internalDate).toISOString().slice(0, 16)} | from:${fromDomain} | to:${toDomain} | thread:${m.threadId ?? '-'} | cem:${/X-CEMFORM-Draft:\s*info-form/i.test(raw) ? 'Y' : 'N'} | irt:${/^In-Reply-To:/im.test(raw) ? 'Y' : 'N'} | uid:${m.uid}`);
    }
    rows.sort().reverse();
    for (const r of rows.slice(0, 6)) console.log('   ', r);
  } finally { lock.release(); }
};

await scan(allMail, { body: marker }, 'body:' + marker, 10);
await scan(allMail, { to: 'info@cemform.it' }, 'to:info@', 10);
await scan('INBOX', { since: new Date(Date.now() - 36 * 3600 * 1000) }, 'last36h', 10);
await scan(drafts, { all: true }, 'all-drafts', 10);

client.close();
