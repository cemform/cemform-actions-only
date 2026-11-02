// Conteggio notifiche per tag (solo SEARCH): verifica se e quando sono arrivate.
import { ImapFlow } from 'imapflow';

const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, logger: false, connectionTimeout: 25000, socketTimeout: 45000 });
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
console.log('all:', allMail);

const lock = await client.getMailboxLock(allMail);
try {
  for (const tag of ['testdiagnostica', 'threadlatency123', 'threadcheck456', 'latency789']) {
    let uids = [];
    try { uids = await client.search({ body: tag }); } catch (e) { console.log(tag, 'ERR', String(e.message).slice(0, 70)); continue; }
    console.log(`body:${tag} ->`, uids.length, uids.slice(-5).join(','));
  }
  const now = await client.search({ since: new Date(Date.now() - 6 * 3600e3) });
  console.log('since 6h:', now.length);
} finally { lock.release(); }

client.close();
