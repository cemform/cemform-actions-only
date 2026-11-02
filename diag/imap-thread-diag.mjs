// v9: dove funziona il FETCH (INBOX vs Tutti i messaggi), header reali della
// notifica Web3Forms e uidNext, per progettare la conversione differita.
// Solo dati di test (tag sintetici), nessun dato personale reale.
import { ImapFlow } from 'imapflow';

const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  logger: false, connectionTimeout: 25000, socketTimeout: 60000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 140)));
client.on('close', () => console.log('client closed'));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }

await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';
console.log('ALL:', allMail);

const meta = () => ({ exists: client.mailbox?.exists, uidNext: client.mailbox?.uidNext });

// --- All Mail ---
let lock = await client.getMailboxLock(allMail);
console.log('ALL mailbox', JSON.stringify(meta()));
try {
  const uids = await client.search({ body: 'latency789' });
  console.log('ALL body:latency789 ->', uids.length, uids.slice(-4).join(','));
  for (const uid of uids.slice(-4)) {
    try {
      let rows = 0;
      for await (const m of client.fetch(String(uid), { envelope: true, internalDate: true, threadId: true, source: true, size: true }, { uid: true })) {
        rows++;
        const raw = m.source ? m.source.toString('utf8') : '';
        const h = raw.slice(0, raw.indexOf('\r\n\r\n') + 1);
        console.log('--- uid', uid, 'bytes', m.size, 'thread', m.threadId ?? '-', 'date', m.internalDate && new Date(m.internalDate).toISOString());
        console.log('    subject:', JSON.stringify(m.envelope?.subject || ''));
        console.log('    from:', (m.envelope?.from || []).map((a) => a.address).join(','));
        console.log('    to:', (m.envelope?.to || []).map((a) => a.address).join(','));
        const mid = h.match(/^Message-ID:\s*(<[^>]+>)/im)?.[1];
        const refs = h.match(/^References:\s*(.+)$/im)?.[1];
        console.log('    Message-ID:', mid || '-', '| References:', refs ? refs.slice(0, 80) : '-');
        console.log('    X-CEMFORM-Meta:', /X-CEMFORM-Meta:\s*(\S+)/i.test(h) ? 'Y' : 'N', '| In-Reply-To:', /^In-Reply-To:/im.test(h) ? 'Y' : 'N');
        console.log('    rawHead:', JSON.stringify(h.split('\r\n').slice(0, 14)));
      }
      if (!rows) console.log('--- uid', uid, 'FETCH EMPTY');
    } catch (e) { console.log('--- uid', uid, 'FETCH ERR', String(e.message).slice(0, 120)); }
  }
} catch (e) { console.log('ALL search ERR', String(e.message).slice(0, 120)); } finally { lock.release(); }

// --- INBOX confronto ---
lock = await client.getMailboxLock('INBOX');
console.log('INBOX mailbox', JSON.stringify(meta()));
try {
  const uids = await client.search({ all: true });
  const last = uids.slice(-3);
  console.log('INBOX last uids', last.join(','));
  for (const uid of last) {
    try {
      let rows = 0;
      for await (const m of client.fetch(String(uid), { envelope: true }, { uid: true })) {
        rows++;
        console.log('  inbox uid', uid, '| subjLen', String(m.envelope?.subject || '').length, '| fromDom', String(m.envelope?.from?.[0]?.address || '').split('@')[1] || '-');
      }
      if (!rows) console.log('  inbox uid', uid, 'FETCH EMPTY');
    } catch (e) { console.log('  inbox uid', uid, 'FETCH ERR', String(e.message).slice(0, 120)); }
  }
} catch (e) { console.log('INBOX ERR', String(e.message).slice(0, 120)); } finally { lock.release(); }

client.close();

// --- piano Vercel ---
const key = process.env.VERCEL_API_KEY_GH;
if (key) {
  try {
    const r = await fetch('https://api.vercel.com/v2/teams?limit=20', { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    const teams = (j.teams || []).map((t) => ({ id: t.id, slug: t.slug, plan: t.billing?.plan || t.plan || null, status: t.billing?.status || null }));
    console.log('VERCEL teams:', JSON.stringify(teams));
  } catch (e) { console.log('VERCEL ERR', String(e.message).slice(0, 120)); }
}
