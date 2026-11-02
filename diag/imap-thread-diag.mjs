// Misura la latenza di consegna della notifica Web3Forms: cerca il tag univoco
// ogni 5s per 150s e stampa dopo quanti secondi compare. Solo SEARCH (nessun fetch).
import { ImapFlow } from 'imapflow';

const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const tag = process.env.TAG || 'threadlatency123';
const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, connectionTimeout: 25000, socketTimeout: 45000 });
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 120)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
const lock = await client.getMailboxLock(allMail);
const t0 = Date.now();
let foundAt = null;
try {
  for (let i = 0; i < 30; i++) {
    let uids = [];
    try { uids = await client.search({ body: tag }); } catch (e) { console.log('search err', String(e.message).slice(0, 80)); }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`t=${elapsed}s hits=${uids.length}`);
    if (uids.length) { foundAt = elapsed; break; }
    await new Promise((r) => setTimeout(r, 5000));
  }
} finally { lock.release(); }
console.log('RESULT: notification visible after', foundAt === null ? '>150' : foundAt, 's');
client.close();
