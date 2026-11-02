// Diagnostica one-off v5: individua la notifica del test (body search), la sua
// etichetta Gmail, il mittente reale; verifica SINCE e accesso alle bozze.
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

const sanitize = (raw) => ({
  hasWeb3: /web3forms/i.test(raw),
  fromDom: (raw.match(/^From:[^\n]*@([a-z0-9.-]+)/im) || [])[1] || '-',
  toDom: (raw.match(/^To:[^\n]*@([a-z0-9.-]+)/im) || [])[1] || '-',
  subjLen: String((raw.match(/^Subject:[^\n]*/im) || [''])[0]).length,
});

// 1) le 2 email che contengono l'indirizzo di test
{
  const lock = await client.getMailboxLock(allMail);
  try {
    const uids = await client.search({ body: marker });
    console.log('allMail body hits:', uids.length);
    for await (const m of client.fetch(uids.slice(-5), { envelope: true, threadId: true, internalDate: true, source: true, labels: true }, { uid: true })) {
      const raw = m.source ? m.source.toString('utf8') : '';
      console.log('  hit', new Date(m.internalDate).toISOString().slice(0, 16), '| uid', m.uid, '| thread', m.threadId ?? '-', '| labels', JSON.stringify(m.labels || []), '|', JSON.stringify(sanitize(raw)));
    }
  } finally { lock.release(); }
}

// 2) sanity check SINCE
{
  const lock = await client.getMailboxLock('INBOX');
  try {
    const a = await client.search({ since: new Date(Date.now() - 3600e3) });
    const b = await client.search({ since: new Date('2020-01-01') });
    console.log('SINCE 1h:', a.length, '| SINCE 2020:', b.length);
  } finally { lock.release(); }
}

// 3) drafts: elenco e fetch uno per uno con errore esplicito
{
  const lock = await client.getMailboxLock(drafts);
  try {
    const uids = await client.search({ all: true });
    console.log('drafts total:', uids.length, '| last uids:', uids.slice(-6).join(','));
    for (const uid of uids.slice(-6)) {
      try {
        for await (const m of client.fetch(String(uid), { envelope: true, threadId: true, internalDate: true }, { uid: true })) {
          console.log('  draft uid', uid, '|', new Date(m.internalDate).toISOString().slice(0, 16), '| thread', m.threadId ?? '-', '| subjLen', String(m.envelope?.subject || '').length);
        }
      } catch (e) { console.log('  draft uid', uid, 'ERR', String(e.message).slice(0, 90)); }
    }
  } finally { lock.release(); }
}

client.close();
