import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, tinyPdf, waitFor } from './helpers/server-harness.js';

let h;
before(async () => { delete process.env.ANTHROPIC_API_KEY; h = await startServer(); });
after(async () => { await h.close(); });

async function newJob(c, name = 'Test job', extra = {}) {
  const r = await c.post('/api/jobs', { name, customer: 'X', ...extra });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

test('login, me, logout; wrong password rejected', async () => {
  const c = h.client();
  assert.equal((await c.get('/api/me')).status, 401);
  const bad = await c.post('/api/login', { username: 'corbett', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  assert.equal((await c.post('/api/login', { username: 'nobody', password: 'whatever1' })).status, 401);
  const ok = await c.post('/api/login', { username: 'Corbett', password: h.users.corbett.pw });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'admin');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Strict/);
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'corbett');
  assert.equal((await c.post('/api/logout', {})).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
});

test('login rate limit', async () => {
  const s = await startServer({ loginLimit: { max: 3, windowMs: 60000 } });
  try {
    const c = s.client();
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/login', { username: 'courtney', password: 'wrong-pass' })).status, 401);
    assert.equal((await c.post('/api/login', { username: 'courtney', password: s.users.courtney.pw })).status, 429);
  } finally { await s.close(); }
});

test('CSRF token required on mutations', async () => {
  const c = await h.login('courtney');
  const r = await c.req('POST', '/api/jobs', { json: { name: 'No csrf' }, csrf: false });
  assert.equal(r.status, 403);
  const ok = await c.post('/api/jobs', { name: 'With csrf' });
  assert.equal(ok.status, 201);
});

test('shared access: both users see the same jobs; viewer cannot save', async () => {
  const corbett = await h.login('corbett');
  const { job, version } = await newJob(corbett, 'Shared job');
  const courtney = await h.login('courtney');
  assert.ok((await courtney.get('/api/jobs')).data.jobs.some(j => j.id === job.id));
  const viewer = await h.login('visitor');
  const got = await viewer.get(`/api/jobs/${job.id}`);
  assert.equal(got.status, 200);
  const put = await viewer.put(`/api/jobs/${job.id}`, { job: { ...job, name: 'hijack' } }, { headers: { 'if-match': String(version) } });
  assert.equal(put.status, 403);
  assert.equal((await viewer.post('/api/jobs', { name: 'v' })).status, 403);
});

test('optimistic concurrency: stale If-Match → 409, revisions stored', async () => {
  const a = await h.login('corbett');
  const b = await h.login('courtney');
  const { job } = await newJob(a, 'Concurrency');
  const r1 = await a.put(`/api/jobs/${job.id}`, { job: { ...job, name: 'Edit by A' }, summary: 'rename' }, { headers: { 'if-match': '1' } });
  assert.equal(r1.status, 200); assert.equal(r1.data.version, 2);
  const stale = await b.put(`/api/jobs/${job.id}`, { job: { ...job, name: 'Edit by B (stale)' } }, { headers: { 'if-match': '1' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.version, 2);
  assert.equal(stale.data.updatedBy, 'corbett');
  assert.equal((await b.get(`/api/jobs/${job.id}`)).data.job.name, 'Edit by A');
  const missing = await b.put(`/api/jobs/${job.id}`, { job: { ...job, name: 'no version' } });
  assert.equal(missing.status, 428);
  const revs = await a.get(`/api/jobs/${job.id}/revisions`);
  assert.deepEqual(revs.data.revisions.map(r => r.version), [2, 1]);
  const r1doc = await a.get(`/api/jobs/${job.id}/revisions/1`);
  assert.equal(r1doc.data.job.name, 'Concurrency');
  const audit = await a.get(`/api/jobs/${job.id}/audit`);
  assert.ok(audit.data.log.some(l => l.action === 'job-save'));
});

test('projectKey and id are immutable; projectKey must be unique', async () => {
  const c = await h.login('corbett');
  const { job } = await newJob(c, 'Rodenbostel', { projectKey: 'rodenbostel' });
  assert.equal(job.projectKey, 'rodenbostel');
  assert.equal((await c.post('/api/jobs', { name: 'Other', projectKey: 'rodenbostel' })).status, 409);
  const r = await c.put(`/api/jobs/${job.id}`, { job: { ...job, projectKey: 'theresa-sue' } }, { headers: { 'if-match': '1' } });
  assert.equal(r.status, 400);
  // server-owned fields cannot be overwritten by the client
  const r2 = await c.put(`/api/jobs/${job.id}`, { job: { ...job, extractions: [{ id: 'fake' }] } }, { headers: { 'if-match': '1' } });
  assert.equal(r2.status, 200);
  assert.deepEqual((await c.get(`/api/jobs/${job.id}`)).data.job.extractions, []);
});

test('upload + analyze without key → text-layer proposal; catalog untouched; apply keeps corrections & answers', async () => {
  const c = await h.login('corbett');
  const catBefore = (await c.get('/api/catalog')).data.entries.length;
  assert.ok(catBefore > 0, 'catalog seeded');
  const { job } = await newJob(c, 'Analysis job');

  const bad = await c.req('POST', `/api/jobs/${job.id}/files`, { body: Buffer.from('not a drawing'), headers: { 'content-type': 'application/octet-stream', 'x-filename': 'x.txt' } });
  assert.equal(bad.status, 415);

  const up = await c.req('POST', `/api/jobs/${job.id}/files`, { body: tinyPdf("12' 7.5' NO irrigation or lighting"), headers: { 'content-type': 'application/pdf', 'x-filename': 'plan.pdf' } });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.data.kind, 'pdf');
  assert.equal(up.data.pages, 1);

  const page = await c.get(`/api/files/${up.data.fileId}/pages/1.png`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'image/png');

  const an = await c.post(`/api/jobs/${job.id}/analyze`, { fileId: up.data.fileId });
  assert.equal(an.status, 202);
  assert.equal(an.data.aiConfigured, false);
  const ex = await waitFor(async () => { const r = await c.get(`/api/extractions/${an.data.extractionId}`); return ['done', 'error'].includes(r.data.status) && r.data; });
  assert.equal(ex.status, 'done', ex.error);
  assert.equal(ex.proposal.summary.source, 'text-layer');
  assert.match(ex.proposal.summary.message, /AI not configured/);
  const dims = ex.proposal.items.filter(i => i.data.dimension).map(i => i.data.dimension.text);
  assert.ok(dims.includes("12'") && dims.includes("7.5'"), JSON.stringify(dims));
  assert.ok(ex.proposal.items.some(i => i.kind === 'exclusion'));
  assert.equal((await c.get('/api/catalog')).data.entries.length, catBefore, 'catalog unchanged by analysis');

  // Job gets a manual component with a locked correction, plus an answer.
  let cur = (await c.get(`/api/jobs/${job.id}`)).data;
  const doc = cur.job;
  doc.components.push({ id: 'bed-1', type: 'bed', name: 'Bed 1', geometry: { kind: 'rect', lengthFt: 8, widthFt: 5 }, props: { heightIn: 27.5 }, provenance: {} });
  doc.corrections.push({ id: 'cor-1', componentId: 'bed-1', path: 'props.heightIn', value: 22, by: 'corbett', at: 'now', note: 'checked on site', locked: true });
  doc.answers['q.corner-rule'] = { value: 'interlaced', by: 'corbett', at: 'now' };
  const saved = await c.put(`/api/jobs/${job.id}`, { job: doc }, { headers: { 'if-match': String(cur.version) } });
  assert.equal(saved.status, 200);
  assert.equal((await c.get(`/api/jobs/${job.id}`)).data.job.components[0].props.heightIn, 22, 'locked correction applied on save');

  const accept = ex.proposal.items.map(i => i.itemId);
  const stale = await c.post(`/api/jobs/${job.id}/extractions/${ex.id}/apply`, { accept }, { headers: { 'if-match': String(cur.version) } });
  assert.equal(stale.status, 409);
  const applied = await c.post(`/api/jobs/${job.id}/extractions/${ex.id}/apply`, { accept }, { headers: { 'if-match': String(saved.data.version) } });
  assert.equal(applied.status, 200, applied.text);
  cur = (await c.get(`/api/jobs/${job.id}`)).data;
  assert.equal(cur.job.components.find(x => x.id === 'bed-1').props.heightIn, 22);
  assert.equal(cur.job.answers['q.corner-rule'].value, 'interlaced');
  assert.equal(cur.job.scope.irrigation, false);
  assert.ok(cur.job.sources.some(s => s.fileId === up.data.fileId));
  assert.equal(cur.job.extractions.length, 1);
  assert.equal((await c.get('/api/catalog')).data.entries.length, catBefore);
});

test('catalog: CSV import adds entries; bad rows reported; prices never zero-filled', async () => {
  const c = await h.login('courtney');
  const before = (await c.get('/api/catalog')).data.entries.length;
  const csv = [
    'productKey,supplier,store,spec,packageSize,packageUnit,unitPrice,unitBasis,priceDate,priceType,sourceFile',
    'lumber:pt:4x4:8,Menards,Naperville,"PT 4x4x8, ground contact",1,board,$12.97,board,2026-10-01,material,receipt.pdf',
    'concrete:fast-set:50lb,Menards,Naperville,Fast-set 50 lb,1,bag,7.48,bag,2026-10-01,material,receipt.pdf',
    'soil:basic-organic,Supplier,,Basic mix,,cy,,cy,2026-10-01,material,quote.pdf',
    'service:soil-install,Greenworks,,Soil,1,cy,125,cy,2025,bogus,rates.pdf',
  ].join('\n');
  const r = await c.req('POST', '/api/catalog/import', { body: csv, headers: { 'content-type': 'text/csv' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.imported, 2);
  assert.equal(r.data.errors.length, 2);
  const after = (await c.get('/api/catalog')).data.entries;
  assert.equal(after.length, before + 2);
  const pt = after.find(e => e.productKey === 'lumber:pt:4x4:8');
  assert.equal(pt.unitPriceCents, 1297);
  assert.equal(pt.priceType, 'material');
  assert.ok(!after.some(e => e.productKey === 'soil:basic-organic'), 'missing price is not stored as zero');
  const viewer = await h.login('visitor');
  assert.equal((await viewer.req('POST', '/api/catalog/import', { body: csv, headers: { 'content-type': 'text/csv' } })).status, 403);
  // manual upsert + delete
  const up = await c.post('/api/catalog', { productKey: 'compost:cow:1cf', supplier: 'Menards', priceDate: '2026-10-01', unitPrice: '6.98', priceType: 'material', packageSize: 1, packageUnit: 'bag' });
  assert.equal(up.status, 200);
  assert.equal((await c.del(`/api/catalog/${up.data.entry.id}`)).status, 200);
});

test('standards PUT is admin-only and versioned', async () => {
  const ed = await h.login('courtney');
  assert.equal((await ed.put('/api/standards', { settings: { 'lumber.kerfIn': 0.125 } })).status, 403);
  const ad = await h.login('corbett');
  const r = await ad.put('/api/standards', { settings: { 'lumber.kerfIn': 0.125 }, version: 0 });
  assert.equal(r.status, 200); assert.equal(r.data.version, 1);
  assert.equal((await ad.put('/api/standards', { settings: {}, version: 0 })).status, 409);
  assert.equal((await ed.get('/api/standards')).data.settings['lumber.kerfIn'], 0.125);
});

test('path traversal and unknown routes are blocked', async () => {
  const c = await h.login('corbett');
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver%2fapp.js', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/public/../server/db.js']) {
    const r = await fetch(h.base + p);
    const text = await r.text();
    assert.ok(!text.includes('"name": "corbett-method"') && !text.includes('DatabaseSync') && !text.includes('root:'), `leak via ${p}`);
  }
  assert.equal((await c.get('/api/files/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await c.get('/api/files/nope/pages/1.png')).status, 404);
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal((await h.client().get('/api/jobs')).status, 401);
});

test('estimate endpoint returns engine output or an actionable 503', async () => {
  const c = await h.login('corbett');
  const { job } = await newJob(c, 'Estimate job');
  const r = await c.get(`/api/jobs/${job.id}/estimate`);
  assert.ok([200, 500, 503].includes(r.status), r.text);
  if (r.status !== 200) assert.ok(r.data.error.length > 10);
});

test('API key never appears in responses or logs (mocked analysis service)', async () => {
  const KEY = 'sk-ant-api03-TESTSECRET-abcdefghijklmnop';
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (seen.length === 1) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `bad key ${KEY}` } }), { status: 400 });
    }
    const data = {
      projectName: "Theresa's Garden", revision: '9/18/26', drawingDate: '2026-09-18', pageRotationNote: null,
      components: [{ tempId: 'b1', type: 'bed', name: 'Center bed', geometry: { kind: 'rect', lengthFt: 20, widthFt: 2.5, areaSqFt: null, points: [] },
        dimensionLabels: [{ text: "20'", valueFt: 20, describes: 'bed length', page: 1, confidence: 0.9 }], materials: ['CedarTone'], quantityNotes: ['(5) 2x6'], notes: null, confidence: 0.9 },
        { tempId: 'p1', type: 'path', name: 'DG path', geometry: { kind: null, lengthFt: null, widthFt: null, areaSqFt: null, points: [] }, dimensionLabels: [], materials: [], quantityNotes: [], notes: null, confidence: 0.5 },
        { tempId: 'evil', type: 'rm -rf', name: 'x', geometry: null, dimensionLabels: [], materials: [], quantityNotes: [], notes: null, confidence: 1 }],
      exclusions: ['NO irrigation or lighting'], alternatives: ['CedarTone or Rough Sawn Cedar'], notes: [],
      uncertainties: [{ type: 'product_spec', text: 'Mesh panel size not specified', componentTempId: null }],
    };
    return new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(data) }] }), { status: 200 });
  };
  const s = await startServer({ fetchImpl });
  process.env.ANTHROPIC_API_KEY = KEY;
  try {
    const c = await s.login('corbett');
    const { job } = (await c.post('/api/jobs', { name: 'Key job' })).data;
    const up = await c.req('POST', `/api/jobs/${job.id}/files`, { body: tinyPdf('20\''), headers: { 'content-type': 'application/pdf', 'x-filename': 'plan.pdf' } });
    // first run: service error echoing the key → must be redacted
    let an = await c.post(`/api/jobs/${job.id}/analyze`, { fileId: up.data.fileId });
    let ex = await waitFor(async () => { const r = await c.get(`/api/extractions/${an.data.extractionId}`); return ['done', 'error'].includes(r.data.status) && r; });
    assert.equal(ex.data.status, 'error');
    assert.ok(!ex.text.includes(KEY), 'key leaked in error');
    assert.match(ex.data.error, /\[redacted\]/);
    // second run: success
    an = await c.post(`/api/jobs/${job.id}/analyze`, { fileId: up.data.fileId });
    ex = await waitFor(async () => { const r = await c.get(`/api/extractions/${an.data.extractionId}`); return ['done', 'error'].includes(r.data.status) && r; });
    assert.equal(ex.data.status, 'done', ex.data.error);
    const items = ex.data.proposal.items;
    assert.equal(items.filter(i => i.kind === 'component').length, 2, 'unknown component type dropped');
    assert.ok(items.some(i => i.kind === 'question' && i.data.type === 'missing_dimension' && /DG path/.test(i.data.text)));
    assert.ok(items.some(i => i.kind === 'question' && i.data.type === 'product_spec'));
    // request shape sent to the service
    const req = seen[1];
    assert.equal(req.headers['x-api-key'], KEY);
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.equal(req.body.messages[0].content[0].type, 'document');
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.ok(!('tool_choice' in req.body));
    // nothing anywhere leaks the key
    const all = [ex.text, (await c.get(`/api/jobs/${job.id}`)).text, (await c.get(`/api/jobs/${job.id}/audit`)).text, (await c.get('/api/me')).text, s.logs.join('\n')].join('\n');
    assert.ok(!all.includes(KEY), 'key leaked');
  } finally { delete process.env.ANTHROPIC_API_KEY; await s.close(); }
});

test('image upload without key gives an actionable error', async () => {
  const c = await h.login('corbett');
  const { job } = await newJob(c, 'Image job');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const up = await c.req('POST', `/api/jobs/${job.id}/files`, { body: png, headers: { 'content-type': 'image/png', 'x-filename': 'photo.png' } });
  assert.equal(up.status, 201);
  const an = await c.post(`/api/jobs/${job.id}/analyze`, { fileId: up.data.fileId });
  const ex = await waitFor(async () => { const r = await c.get(`/api/extractions/${an.data.extractionId}`); return ['done', 'error'].includes(r.data.status) && r.data; });
  assert.equal(ex.status, 'error');
  assert.match(ex.error, /ANTHROPIC_API_KEY/);
  const raw = await c.get(`/api/files/${up.data.fileId}`);
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
  assert.match(raw.headers.get('content-security-policy'), /sandbox/);
});
