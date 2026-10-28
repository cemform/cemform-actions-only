'use strict';

const TOKEN = process.env.MAKE_API_TOKEN;
const MODE = (process.env.MODE || 'probe').toLowerCase();
const TEAM_ID = 1916320;
const PROD_ID = 6674985;
const PROD_HOOK = 3436358;
const BASE = 'https://eu1.make.com/api/v2';

if (!TOKEN) { console.error('MAKE_API_TOKEN missing'); process.exit(1); }

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

function find(list, id) {
  for (const m of list || []) {
    if (m.id === id) return m;
    if (Array.isArray(m.routes)) { for (const rt of m.routes) { const f = find(rt.flow, id); if (f) return f; } }
    if (Array.isArray(m.onerror)) { const f = find(m.onerror, id); if (f) return f; }
  }
  return null;
}

async function prodContext() {
  const r = await api(`/scenarios/${PROD_ID}/blueprint`);
  if (r.status !== 200) throw new Error(`prod blueprint HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  const resp = r.json.response || r.json;
  let bp = resp.blueprint;
  if (typeof bp === 'string') bp = JSON.parse(bp);
  const ig = find(bp.flow, 13);
  if (!ig) throw new Error('IG module 13 not found');
  const conn = ig.parameters && ig.parameters.__IMTCONN__;
  const accountId = ig.mapper && ig.mapper.accountId;
  if (!conn || !accountId) throw new Error(`missing conn/account: ${JSON.stringify({ conn: !!conn, accountId })}`);
  return { conn, accountId };
}

async function hookInfo(id) {
  const r = await api(`/hooks/${id}`);
  if (r.status !== 200) throw new Error(`hook ${id} HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  return r.json.hook;
}

async function main() {
  const prod = await prodContext();
  console.log('PROD_CTX', JSON.stringify({ conn: prod.conn, accountId: prod.accountId }));

  const ph = await hookInfo(PROD_HOOK);
  console.log('PROD_HOOK', JSON.stringify({ id: ph.id, typeName: ph.typeName, enabled: ph.enabled, url: ph.url, data: ph.data }));

  if (MODE === 'probe') {
    console.log('PROBE OK');
    return;
  }

  const ch = await api('/hooks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'CEMFORM IG media probe (temporary)',
      teamId: String(TEAM_ID),
      typeName: ph.typeName,
      method: false,
      headers: false,
      stringify: false,
    }),
  });
  if (ch.status !== 200) throw new Error(`create hook HTTP ${ch.status}: ${ch.text.slice(0, 600)}`);
  const hook = ch.json.hook;
  console.log('HOOK_CREATED', JSON.stringify({ id: hook.id, url: hook.url }));

  const trigger = {
    id: 1,
    module: 'gateway:CustomWebHook',
    version: 1,
    parameters: { hook: hook.id, maxResults: 1 },
    mapper: {},
    metadata: { designer: { x: 0, y: 0 } },
  };

  const getUserMedia = {
    id: 2,
    module: 'instagram-business:GetUserMedia',
    version: 1,
    parameters: { __IMTCONN__: prod.conn },
    mapper: { accountId: prod.accountId, limit: 10 },
    metadata: {
      expect: [
        { name: 'accountId', type: 'select', label: 'Page', required: true },
        { name: 'limit', type: 'uinteger', label: 'Limit', required: true },
      ],
      restore: {},
      designer: { x: 300, y: 0 },
      parameters: [{ name: '__IMTCONN__', type: 'account', label: 'Connection', required: true }],
    },
  };

  const respond = {
    id: 3,
    module: 'gateway:WebhookRespond',
    version: 1,
    parameters: {},
    mapper: { status: '200', body: '{{2.array}}', headers: [] },
    metadata: {
      expect: [
        { name: 'status', type: 'uinteger', label: 'Status', required: true, validate: { min: 100 } },
        { name: 'body', type: 'any', label: 'Body' },
        { name: 'headers', spec: [
          { name: 'key', type: 'text', label: 'Key', required: true, validate: { max: 256 } },
          { name: 'value', type: 'text', label: 'Value', required: true, validate: { max: 4096 } },
        ], type: 'array', label: 'Custom headers', validate: { maxItems: 16 } },
      ],
      restore: { expect: { headers: { mode: 'chose' } } },
      designer: { x: 600, y: 0 },
    },
  };

  if (MODE === 'hello') {
    respond.mapper.body = 'hello-from-make';
    respond.mapper.headers = [];
    const bpHello = {
      name: 'CEMFORM hello probe (temporary)',
      flow: [trigger, { ...respond, id: 2, mapper: { ...respond.mapper } }],
      metadata: { version: 1, scenario: { dlq: true } },
    };
    let sid = null;
    try {
      const cs = await api('/scenarios?confirmed=true', {
        method: 'POST',
        body: JSON.stringify({ blueprint: JSON.stringify(bpHello), teamId: TEAM_ID, scheduling: JSON.stringify({ type: 'on-demand' }) }),
      });
      if (cs.status !== 200) throw new Error(`create hello HTTP ${cs.status}: ${cs.text.slice(0, 800)}`);
      sid = cs.json.scenario.id;
      console.log('HELLO_SCENARIO', sid, 'isinvalid', cs.json.scenario.isinvalid);
      const act = await api(`/scenarios/${sid}/start`, { method: 'POST' });
      console.log('HELLO_ACTIVATE', act.status);
      const res = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hello: true }) });
      console.log('HELLO_HTTP', res.status);
      console.log('HELLO_BODY_START');
      console.log((await res.text()).slice(0, 5000));
      console.log('HELLO_BODY_END');
    } finally {
      if (sid) { await api(`/scenarios/${sid}/stop`, { method: 'POST' }); const d = await api(`/scenarios/${sid}`, { method: 'DELETE' }); console.log('HELLO_DELETE', d.status); }
      const dh = await api(`/hooks/${hook.id}?confirmed=true`, { method: 'DELETE' });
      console.log('HOOK_DELETE', dh.status, dh.text.slice(0, 200));
    }
    return;
  }

  const bp = {
    name: 'CEMFORM IG media probe (temporary)',
    flow: [trigger, getUserMedia, respond],
    metadata: { version: 1, scenario: { dlq: true } },
  };

  let scenarioId = null;
  try {
    const cs = await api('/scenarios?confirmed=true', {
      method: 'POST',
      body: JSON.stringify({
        blueprint: JSON.stringify(bp),
        teamId: TEAM_ID,
        scheduling: JSON.stringify({ type: 'on-demand' }),
      }),
    });
    if (cs.status !== 200) throw new Error(`create scenario HTTP ${cs.status}: ${cs.text.slice(0, 800)}`);
    scenarioId = cs.json.scenario.id;
    console.log('SCENARIO_CREATED', JSON.stringify({ id: scenarioId, isinvalid: cs.json.scenario.isinvalid }));

    const act = await api(`/scenarios/${scenarioId}/start`, { method: 'POST' });
    console.log('ACTIVATE HTTP', act.status);
    if (act.status !== 200) throw new Error(`activate HTTP ${act.status}: ${act.text.slice(0, 300)}`);

    const res = await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: 'cemform-ig-media' }),
    });
    const text = await res.text();
    console.log('HOOK_HTTP', res.status);
    console.log('HOOK_BODY_START');
    console.log(text.slice(0, 20000));
    console.log('HOOK_BODY_END');
  } finally {
    if (scenarioId) {
      const st = await api(`/scenarios/${scenarioId}/stop`, { method: 'POST' });
      console.log('STOP HTTP', st.status);
      const dl = await api(`/scenarios/${scenarioId}`, { method: 'DELETE' });
      console.log('SCENARIO_DELETE HTTP', dl.status);
    }
    const dh = await api(`/hooks/${hook.id}?confirmed=true`, { method: 'DELETE' });
    console.log('HOOK_DELETE HTTP', dh.status);
  }
}

main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
