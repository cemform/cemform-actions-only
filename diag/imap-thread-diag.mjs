// v10: ricerca con { uid: true } e header reali della notifica di test.
import { ImapFlow } from 'imapflow';

const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  logger: false, connectionTimeout: 25000, socketTimeout: 60000,
});
client.on('error', (e) => console.log('client error:', String(e?.message || e).slice(0, 140)));

const flat = [];
function walk(arr) { for (const b of arr) { flat.push(b); if (b.children) walk(b.children); } }
await client.connect();
walk(await client.list());
const allMail = flat.find((b) => String(b.specialUse || '').toLowerCase().includes('\\all'))?.path || '[Gmail]/Tutti i messaggi';

const lock = await client.getMailboxLock(allMail);
const uidNext = Number(client.mailbox?.uidNext || 0);
console.log('ALL uidNext', uidNext, 'exists', client.mailbox?.exists);
try {
  for (const tag of ['threadcheck456', 'latency789']) {
    const uids = await client.search({ body: tag }, { uid: true });
    console.log(`UID SEARCH body:${tag} ->`, uids.length, uids.slice(-4).join(','));
    for (const uid of uids.slice(-4)) {
      let rows = 0;
      for await (const m of client.fetch(String(uid), { envelope: true, internalDate: true, threadId: true, source: true }, { uid: true })) {
        rows++;
        const raw = m.source ? m.source.toString('utf8') : '';
        const h = raw.slice(0, raw.indexOf('\r\n\r\n') + 1);
        console.log('--- uid', uid, 'thread', m.threadId ?? '-', 'date', m.internalDate && new Date(m.internalDate).toISOString());
        console.log('    Subject:', JSON.stringify(m.envelope?.subject || ''));
        console.log('    From:', (m.envelope?.from || []).map((a) => `${a.name || ''}<${a.address}>`).join(','));
        console.log('    To:', (m.envelope?.to || []).map((a) => `${a.name || ''}<${a.address}>`).join(','));
        console.log('    Message-ID:', h.match(/^Message-ID:\s*(<[^>]+>)/im)?.[1] || '-');
        console.log('    References:', (h.match(/^References:\s*(.+)$/im)?.[1] || '-').slice(0, 120));
        console.log('    X-CEMFORM-Draft:', /X-CEMFORM-Draft:/i.test(h) ? 'Y' : 'N', '| In-Reply-To:', /^In-Reply-To:/im.test(h) ? 'Y' : 'N');
        console.log('    Reply-To:', h.match(/^Reply-To:\s*(.+)$/im)?.[1] || '-');
      }
      if (!rows) console.log('--- uid', uid, 'EMPTY');
    }
  }

  // ultimi messaggi per UID (senza SEARCH): la notifica è qui?
  const from = Math.max(1, uidNext - 15);
  console.log('--- last UIDs', from, ':', uidNext - 1);
  for await (const m of client.fetch(`${from}:*`, { envelope: true, internalDate: true, threadId: true }, { uid: true })) {
    console.log('  uid', m.uid, '|', new Date(m.internalDate).toISOString().slice(0, 19), '| from', String(m.envelope?.from?.[0]?.address || '-').split('@')[1] || '-', '| to', (m.envelope?.to || []).map((a) => String(a.address || '').split('@')[1]).join(',') || '-', '| subjLen', String(m.envelope?.subject || '').length);
  }
} catch (e) { console.log('ERR', String(e.message).slice(0, 140)); } finally { lock.release(); }

client.close();
