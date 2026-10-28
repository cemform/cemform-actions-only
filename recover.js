'use strict';

const TOKEN = process.env.MAKE_API_TOKEN;
const MODE = (process.env.MODE || 'probe').toLowerCase();
const TEAM_ID = 1916320;
const PROD_ID = 6674985;
const BASE = 'https://eu1.make.com/api/v2';
const IMAGES = [1, 2, 3, 4].map(i => `https://www.cemform.it/social/carousel/2026-10-28/agg-f6df0f9e-slide-${i}.png`);
const CAPTION = Buffer.from('UG9saXRpY2EgaW4gY2xhc3NlLCBsYSByaWZsZXNzaW9uZSBkaSBFbnJpY28gR2FsaWFubyBzdWwgcnVvbG8gZGVsIGRvY2VudGUKCklsIGRpYmF0dGl0byBzdWxsJ29wcG9ydHVuaXTDoCBwZXIgZ2xpIGluc2VnbmFudGkgZGkgdHJhdHRhcmUgdGVtaSBwb2xpdGljaSBhbGwnaW50ZXJubyBkZWxsZSBhdWxlIHNjb2xhc3RpY2hlIGNoaWFtYSBpbiBjYXVzYSBpbCBjb25maW5lIGRlbGljYXRvIHRyYSBsYSB0cmFzbWlzc2lvbmUgZGkgdmFsb3JpIGNpdmljaSBlIGlsIHJpc2NoaW8gZGkgc2NvbmZpbmFyZSBuZWxsYSBwcm9wYWdhbmRhIHBhcnRpdGljYS4gU3VsIHRlbWEgw6ggaW50ZXJ2ZW51dG8gbG8gc2NyaXR0b3JlIGUgaW5zZWduYW50ZSBFbnJpY28gR2FsaWFubywgb2ZmcmVuZG8gdW5hIHJpZmxlc3Npb25lIHN1bCBydW9sbyBlZHVjYXRpdm8gZGVsIGRvY2VudGUgZSBzdWwgc2lnbmlmaWNhdG8gYXV0ZW50aWNvIGRlbCB0ZXJtaW5lICJwb2xpdGljYSIuCgojRG9jZW50aUl0YWxpYW5pICNTdXBwbGVuemVEb2NlbnRpICNOb3RpemllU2N1b2xh', 'base64').toString('utf8');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

const handler = (id) => ({
  id,
  module: 'builtin:Break',
  version: 1,
  parameters: {},
  mapper: { count: '3', retry: true, interval: '1' },
  metadata: {
    designer: { x: 300, y: 150 },
    restore: { expect: { retry: { mode: 'chose' } } },
    expect: [
      { name: 'retry', type: 'boolean', label: 'Automatically complete execution', required: true },
      { name: 'count', type: 'uinteger', label: 'Number of attempts', required: true, validate: { max: 10000, min: 1 } },
      { name: 'interval', type: 'uinteger', label: 'Interval between attempts', required: true, validate: { max: 44640, min: 1 } },
    ],
  },
});

function find(list, id) {
  for (const m of list || []) {
    if (m.id === id) return m;
    if (Array.isArray(m.routes)) {
      for (const rt of m.routes) {
        const f = find(rt.flow, id);
        if (f) return f;
      }
    }
    if (Array.isArray(m.onerror)) {
      const f = find(m.onerror, id);
      if (f) return f;
    }
  }
  return null;
}

async function createScenario() {
  const r = await api(`/scenarios/${PROD_ID}/blueprint`);
  if (r.status !== 200) throw new Error(`prod blueprint HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  const resp = r.json.response || r.json;
  let bp = resp.blueprint;
  if (typeof bp === 'string') bp = JSON.parse(bp);
  const prodIg = find(bp.flow, 13);
  if (!prodIg) throw new Error('IG module 13 not found in production blueprint');

  const ig = JSON.parse(JSON.stringify(prodIg));
  ig.id = 1;
  delete ig.onerror;
  ig.mapper = { ...(ig.mapper || {}) };
  ig.mapper.files = IMAGES.map(u => ({ image_url: u, media_type: 'IMAGE' }));
  ig.mapper.caption = CAPTION;
  ig.metadata = ig.metadata || {};
  ig.metadata.designer = { x: 0, y: 0 };
  ig.onerror = [handler(2)];

  const recovery = {
    name: 'CEMFORM IG recovery 2026-10-28 (temporary)',
    flow: [ig],
    metadata: { version: 1, scenario: { dlq: true } },
  };

  const c = await api('/scenarios?confirmed=true', {
    method: 'POST',
    body: JSON.stringify({
      blueprint: JSON.stringify(recovery),
      teamId: TEAM_ID,
      scheduling: JSON.stringify({ type: 'on-demand' }),
    }),
  });
  if (c.status !== 200) throw new Error(`create HTTP ${c.status}: ${c.text.slice(0, 600)}`);
  const sc = c.json.scenario;
  console.log('CREATED', JSON.stringify({ id: sc.id, name: sc.name, isActive: sc.isActive, isinvalid: sc.isinvalid, concept: sc.concept }));
  return sc.id;
}

async function activate(id) {
  const a = await api(`/scenarios/${id}/start`, { method: 'POST' });
  console.log('ACTIVATE HTTP', a.status, a.text.slice(0, 200));
  return a.status === 200;
}

async function deactivate(id) {
  const a = await api(`/scenarios/${id}/stop`, { method: 'POST' });
  console.log('DEACTIVATE HTTP', a.status);
}

async function remove(id) {
  const d = await api(`/scenarios/${id}`, { method: 'DELETE' });
  console.log('DELETE HTTP', d.status);
}

async function run(id) {
  const r = await api(`/scenarios/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ responsive: false }),
  });
  console.log('RUN HTTP', r.status, r.text.slice(0, 300));
  if (r.status !== 200) return null;
  return r.json.executionId || null;
}

async function getLogs(id) {
  const r = await api(`/scenarios/${id}/logs?teamId=${TEAM_ID}&pg%5Blimit%5D=20`);
  if (r.status !== 200) {
    console.log('LOGS HTTP', r.status, r.text.slice(0, 200));
    return [];
  }
  return r.json.scenarioLogs || [];
}

async function main() {
  if (!TOKEN) throw new Error('MAKE_API_TOKEN missing');

  if (MODE === 'check') {
    const id = Number(process.env.SCENARIO_ID);
    const exec = process.env.EXEC_ID;
    if (!id || !exec) throw new Error('SCENARIO_ID and EXEC_ID required');
    const d = await api(`/scenarios/${id}/executions/${exec}`);
    console.log('EXEC HTTP', d.status);
    console.log('EXEC BODY', d.text.slice(0, 5000));
    const l = await api(`/scenarios/${id}/logs?teamId=${TEAM_ID}&pg%5Blimit%5D=20`);
    console.log('LOGS HTTP', l.status);
    console.log('LOGS BODY', l.text.slice(0, 4000));
    return;
  }

  if (MODE === 'scenario') {
    const id = Number(process.env.SCENARIO_ID);
    if (!id) throw new Error('SCENARIO_ID required');
    const d = await api(`/scenarios/${id}`);
    console.log('SCENARIO HTTP', d.status);
    console.log('SCENARIO BODY', d.text.slice(0, 3000));
    const q = await api(`/dlqs?teamId=${TEAM_ID}&scenarioId=${id}`);
    console.log('DLQ HTTP', q.status);
    console.log('DLQ BODY', q.text.slice(0, 3000));
    return;
  }

  if (MODE === 'cleanup') {
    const id = Number(process.env.SCENARIO_ID);
    if (!id) throw new Error('SCENARIO_ID missing');
    await deactivate(id);
    await remove(id);
    return;
  }

  const id = await createScenario();
  if (MODE === 'probe') {
    console.log('PROBE OK — deleting test scenario, no post created');
    await remove(id);
    return;
  }

  let success = false;
  let deleteOnExit = false;
  try {
    if (!(await activate(id))) {
      console.log('ACTIVATION FAILED — deleting, no post created');
      deleteOnExit = true;
      return;
    }
    const execId = await run(id);
    if (!execId) {
      console.log('RUN DID NOT START — deleting, no post created');
      deleteOnExit = true;
      return;
    }
    console.log('EXECUTION_ID', execId);

    let terminal = null;
    for (let i = 0; i < 24; i++) {
      await sleep(15000);
      const rows = await getLogs(id);
      const end = rows.find(x => x.eventType === 'EXECUTION_END' && String(x.id) === String(execId))
        || rows.find(x => x.eventType === 'EXECUTION_END');
      if (end) { terminal = end; break; }
      const paused = rows.find(x => x.eventType === 'EXECUTION_PAUSED' && String(x.id) === String(execId));
      if (paused) console.log('PAUSED', JSON.stringify({ id: paused.id, resumeAt: paused.resumeAt, reason: paused.interruptReason, module: paused.interruptModuleName }));
      else console.log('WAIT', i + 1, '/24');
    }

    if (!terminal) {
      console.log('TIMEOUT — no terminal log yet; scenario kept for inspection:', id);
      return;
    }

    console.log('TERMINAL', JSON.stringify({
      id: terminal.id, status: terminal.status, eventType: terminal.eventType,
      timestamp: terminal.timestamp, duration: terminal.duration, operations: terminal.operations,
    }));

    if (terminal.status === 1 || terminal.status === 2) {
      success = true;
      const d = await api(`/scenarios/${id}/executions/${terminal.id}`);
      if (d.status === 200) {
        const ex = d.json.execution || d.json;
        const summary = {
          status: ex.status,
          started: ex.started,
          finished: ex.finished,
          operations: ex.operations,
          error: ex.error ? String(ex.error).slice(0, 300) : null,
        };
        console.log('EXECUTION', JSON.stringify(summary));
      } else {
        console.log('EXECUTION DETAILS HTTP', d.status);
      }
    } else {
      console.log('FAILED — scenario kept for inspection:', id);
      const d = await api(`/scenarios/${id}/executions/${terminal.id}`);
      if (d.status === 200) {
        const s = JSON.stringify(d.json);
        console.log('FAILURE_DETAIL', s.slice(0, 2500));
      }
    }
  } finally {
    if (success || deleteOnExit) {
      await deactivate(id);
      await remove(id);
    }
  }
}

main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
