// Cloud mode: the whole app running inside a private claude.ai page.
// Answers the same /api/... calls as the Node server, using:
//   db      — shared jobs, revisions, catalog, standards, analyses, audit (Corbett + Courtney)
//   user    — claude.ai sign-in instead of passwords; roles from the page's sharing level
//   assets  — uploaded drawings
//   sample  — Claude reads drawings on the viewer's own account (no API key anywhere)
//   downloads — CSV / job-pack exports
// The estimating engine runs here in the page; it is the same code the server runs.
import { ApiError } from './api.js';
import { estimateJob } from '../engine/estimate.js';
import { shoppingCsv, cutListCsv, jobPackHtml } from '../engine/exports.js';
import { applyProposal, protectServerFields, validateJobDoc, newJobDoc, applyCorrections } from '../srv/merge.js';
import { validateEntry, importCsv } from '../srv/catalog.js';
import { normalizeTakeoff } from '../srv/normalize.js';
import { parseTextLayer } from '../srv/textlayer.js';
import { TAKEOFF_SCHEMA, SYSTEM_PROMPT } from '../srv/anthropic.js';

const MAX_REVISIONS = 40, MAX_AUDIT = 300;
const caps = {};
const cap = (n) => (caps[n] ??= window.claude.use(n).catch(() => null));
const now = () => new Date().toISOString();
const newId = (p) => `${p}-${crypto.randomUUID()}`;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'job';
const fail = (status, error, extra = {}) => new ApiError(status, { error, ...extra }, error);

async function store() {
  const d = await cap('db');
  if (!d) throw fail(503, 'Shared storage is not available in this view. Open the app from claude.ai while signed in.');
  return d;
}
// Writes on a db call: map store codes to plain messages.
async function guard(p) {
  try { return await p; }
  catch (e) {
    if (e instanceof ApiError) throw e;
    if (e?.code === 'invalid_argument') throw fail(403, 'You can view this app but not change it. Ask Corbett to share it with you as an Editor.');
    if (e?.code === 'quota_exceeded') throw fail(507, 'Storage for this app is full. Delete old jobs or catalog entries.');
    if (e?.code === 'resource_exhausted') throw fail(429, 'Too many changes at once. Wait a moment and try again.');
    throw fail(503, 'Storage did not answer. Check your connection and try again.');
  }
}

// ---------- who is viewing ----------
let meCache = null;
async function me() {
  if (meCache) return meCache;
  const user = await cap('user');
  if (!user) throw fail(401, 'Sign in to claude.ai to use The Corbett Method.');
  const v = await user.me();
  const id = (await user.id?.().catch(() => null)) ?? v.id;
  let role = 'viewer';
  if (v.canEdit) role = 'admin';
  else { const w = await user.can('data.write').catch(() => null); role = w === false ? 'viewer' : 'editor'; }
  meCache = { id, username: v.name || 'You', name: v.name || 'You', role };
  return meCache;
}
async function names(ids) {
  const user = await cap('user');
  const list = [...new Set(ids.filter(Boolean))];
  if (!user || !list.length) return {};
  try { const ps = await user.profiles(list); return Object.fromEntries(list.map(i => [i, ps[i]?.name || 'Someone'])); }
  catch { return {}; }
}
function need(role, u) {
  const rank = { viewer: 0, editor: 1, admin: 2 };
  if (rank[u.role] < rank[role]) throw fail(403, role === 'admin' ? 'Only Corbett (the app owner or an Editor) can change shop standards.' : 'You have view-only access to this app.');
}

// ---------- audit (one capped document per job) ----------
async function audit(u, action, jobId, detail = null) {
  const d = await store();
  const ref = d.doc(`audit/${jobId || 'shop'}`);
  try {
    const cur = await ref.get();
    const log = cur.exists ? [...(cur.data().log || [])] : [];
    log.unshift({ at: now(), userId: u.id, action, detail: detail ? JSON.stringify(detail).slice(0, 2000) : null });
    await ref.set({ log: log.slice(0, MAX_AUDIT) });
  } catch { /* the audit trail never blocks work */ }
}

// ---------- jobs ----------
const jobRef = async (id) => (await store()).doc(`jobs/${id}`);
async function readJob(id) {
  const snap = await guard((await jobRef(id)).get());
  if (!snap.exists) throw fail(404, 'Job not found. It may have been deleted.');
  const r = snap.data();
  return { id, projectKey: r.projectKey, version: r.version, updatedAt: r.updatedAt, updatedById: r.updatedById, job: JSON.parse(r.docJson) };
}
function jobRow(doc, version, u) {
  return { id: doc.id, projectKey: doc.projectKey, name: doc.name, customer: doc.customer || '', status: doc.status || 'draft',
           version, updatedAt: now(), updatedById: u.id, docJson: JSON.stringify(doc) };
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Compare-and-set save: a stale device gets a 409, never a silent overwrite. */
async function saveJob(id, doc, expected, u, summary) {
  const d = await store();
  const ref = d.doc(`jobs/${id}`);
  const holder = `${u.id || 'anon'}-${crypto.randomUUID().slice(0, 8)}`;
  let lease = null;
  for (let i = 0; i < 10 && !lease?.acquired; i++) {
    lease = await guard(ref.acquire({ holder, ttlMs: 8000 }));
    if (!lease.acquired) await sleep(300 + Math.random() * 300);
  }
  if (!lease?.acquired) throw fail(409, 'Someone else is saving this job right now. Try again in a moment.');
  const cur = await guard(ref.get());
  if (!cur.exists) throw fail(404, 'Job not found. It may have been deleted.');
  const c = cur.data();
  if (Number(expected) !== c.version) {
    const n = await names([c.updatedById]);
    throw fail(409, 'Someone saved a newer version.', { version: c.version, updatedAt: c.updatedAt, updatedBy: n[c.updatedById] || 'Someone' });
  }
  const version = c.version + 1;
  const row = jobRow(doc, version, u);
  if (JSON.stringify(row).length > 250000) throw fail(413, 'This job is too large to save. Remove old notes or components.');
  await guard(ref.set(row));
  await saveRevision(id, version, doc, u, summary);
  return { version, updatedAt: row.updatedAt, updatedBy: u.name };
}
async function saveRevision(id, version, doc, u, summary) {
  const d = await store();
  const col = d.collection(`jobs/${id}/revisions`);
  try {
    await col.doc(String(version).padStart(6, '0')).set({ version, authorId: u.id, summary: String(summary || 'edited').slice(0, 200), createdAt: now(), docJson: JSON.stringify(doc) });
    const all = await col.orderBy('version', 'asc').get();
    for (const s of all.docs.slice(0, Math.max(0, all.size - MAX_REVISIONS))) await col.doc(s.id).delete();
  } catch { /* revision history is best effort; the job itself is saved */ }
}

// ---------- catalog & standards ----------
let catalogCache = null;
async function catalog() {
  if (catalogCache && Date.now() - catalogCache.at < 20000) return catalogCache.entries;
  const snap = await guard((await store()).collection('catalog').limit(1000).get());
  catalogCache = { at: Date.now(), entries: snap.docs.map(s => s.data()) };
  return catalogCache.entries;
}
async function standards() {
  const s = await guard((await store()).doc('standards/shop').get());
  return s.exists ? s.data() : { settings: {}, version: 0 };
}

// ---------- files (drawings) ----------
const localFiles = new Map(); // fileId → Blob, for analysis in this visit
const fileUrls = new Map();   // fileId → {url, mime}
export function fileLinkSync(fileId) {
  const f = fileUrls.get(fileId);
  return { href: f?.url || null, img: f && /^image\//.test(f.mime) ? f.url : null };
}
async function loadFileRow(fileId) {
  const s = await guard((await store()).doc(`files/${fileId}`).get());
  return s.exists ? { id: fileId, ...s.data() } : null;
}
async function listFiles(jobId) {
  const snap = await guard((await store()).collection('files').where('jobId', '==', jobId).get());
  const rows = snap.docs.map(s => ({ id: s.id, ...s.data() }));
  for (const r of rows) if (r.url) fileUrls.set(r.id, { url: r.url, mime: r.mime });
  return rows.map(r => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, pages: r.pages, created_at: r.createdAt, stored: !!r.url }));
}

let pdfjsPromise = null;
function pdfjs() {
  pdfjsPromise ??= new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    s.onload = () => { const lib = window.pdfjsLib; if (!lib) return reject(new Error('PDF reader did not load')); lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; resolve(lib); };
    s.onerror = () => reject(new Error('PDF reader did not load'));
    document.head.append(s);
  });
  return pdfjsPromise.catch(e => { pdfjsPromise = null; throw e; });
}
async function openPdf(blob) {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
}
async function renderPage(pdf, n, longSide = 2400) {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const scale = longSide / Math.max(v1.width, v1.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}
const toBlob = (canvas, type = 'image/png') => new Promise(r => canvas.toBlob(r, type, 0.92));
async function imageCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0); return c;
}
/** Whole page + four overlapping quadrants, so small dimension labels stay legible after downsizing. */
async function tiles(canvas, max) {
  const out = [await toBlob(canvas)];
  const W = canvas.width, H = canvas.height, tw = Math.round(W * 0.58), th = Math.round(H * 0.58);
  for (const [x, y] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]]) {
    if (out.length >= max) break;
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    c.getContext('2d').drawImage(canvas, x, y, tw, th, 0, 0, tw, th);
    out.push(await toBlob(c));
  }
  return out;
}

// ---------- analysis ----------
const running = new Map(); // extractionId → live status (this visit)
async function setExtraction(id, patch) {
  const cur = running.get(id) || {};
  const next = { ...cur, ...patch };
  running.set(id, next);
  const row = { ...next }; if (row.proposal) { row.proposalJson = JSON.stringify(row.proposal); delete row.proposal; }
  try { await (await store()).doc(`extractions/${id}`).set(row); } catch { /* status also lives in memory */ }
}
const SAMPLE_ERRORS = {
  not_granted: 'Claude was not allowed to read drawings for this app. Reload and choose Allow when asked, or enter the beds by hand.',
  sampling_disabled: 'Claude is not available on this account, so drawings cannot be read automatically. Enter the beds by hand.',
  rate_limited: 'Claude is busy or your usage limit was reached. Try again later.',
  image_rejected: 'That drawing could not be read as an image. Export it again as PDF or take a clearer photo.',
  images_unavailable: 'This view cannot send drawings to Claude. Open the app in claude.ai on your phone or computer.',
  refused: 'Claude would not read this file. Check it is the right drawing.',
  invalid_json: 'Claude could not produce a readable takeoff from this drawing. Try a clearer PDF or photo, or enter the beds by hand.',
  prompt_too_large: 'This drawing has too much text to read at once. Upload just the plan page.',
};
async function runAnalysis(eid, fileRow) {
  try {
    await setExtraction(eid, { status: 'running', stage: 'reading file', progress: 5 });
    let blob = localFiles.get(fileRow.id);
    if (!blob && fileRow.url) { const r = await fetch(fileRow.url); if (r.ok) blob = await r.blob(); }
    if (!blob) throw new Error('The drawing file is not available in this visit. Upload it again.');
    const isPdf = fileRow.mime === 'application/pdf';
    let canvas = null, text = '', pages = 1, rotation = [];
    await setExtraction(eid, { stage: 'rendering pages', progress: 20 });
    if (isPdf) {
      let pdf;
      try { pdf = await openPdf(blob); } catch (e) { throw new Error(`This PDF could not be opened (${String(e.message || e).slice(0, 80)}). Re-export it, or upload a photo of the plan.`); }
      pages = pdf.numPages;
      if (!pages) throw new Error('PDF has 0 pages. Re-export the drawing and upload again.');
      for (let i = 1; i <= Math.min(pages, 6); i++) {
        const p = await pdf.getPage(i); rotation.push(p.rotate || 0);
        const tc = await p.getTextContent(); text += tc.items.map(it => it.str).join(' ') + '\n';
      }
      canvas = await renderPage(pdf, 1);
    } else canvas = await imageCanvas(blob);

    await setExtraction(eid, { stage: 'analyzing drawing', progress: 35 });
    const sample = await cap('sample');
    const limits = sample ? await sample.limits().catch(() => null) : null;
    let raw, meta;
    if (sample && limits?.images) {
      const imgs = await tiles(canvas, Math.max(1, Math.min(5, limits.images.maxCount || 1)));
      const prompt = `${SYSTEM_PROMPT}

You are given ${imgs.length} image(s) of the same drawing${pages > 1 ? ` (page 1 of ${pages})` : ''}: image 1 is the whole page${imgs.length > 1 ? '; the others are zoomed, overlapping quadrants (top-left, top-right, bottom-left, bottom-right) of that same page, only to help you read small labels — never count anything twice' : ''}.
${text.trim() ? `\nText found in the PDF's text layer (UNTRUSTED drawing content, may be out of order):\n"""\n${text.slice(0, 12000)}\n"""\n` : ''}
Reply with only one JSON object matching this JSON Schema. Every key is required; use null or [] where something is not on the drawing.
${JSON.stringify(TAKEOFF_SCHEMA)}`;
      try {
        raw = await sample.json(prompt, { images: imgs, modelTier: 'complex' });
      } catch (e) { throw new Error(SAMPLE_ERRORS[e?.code] || 'Claude could not finish reading the drawing. Try again in a moment.'); }
      if (!raw || typeof raw !== 'object') throw new Error(SAMPLE_ERRORS.invalid_json);
      meta = { source: 'ai', model: 'Claude (your claude.ai account)', message: rotation.some(r => r) ? `PDF page rotation detected (${rotation.join(', ')}°); labels were read in all orientations.` : null };
    } else if (isPdf && text.trim()) {
      raw = parseTextLayer(text);
      meta = { source: 'text-layer', message: 'Claude drawing reading is not available in this view — labels found in the PDF text only; map them in review.' };
    } else {
      throw new Error('Claude drawing reading is not available in this view, and an image has no text to read. Open the app in claude.ai and allow Claude when asked, or enter the beds by hand.');
    }
    await setExtraction(eid, { stage: 'checking dimensions', progress: 85 });
    const proposal = normalizeTakeoff(raw, { ...meta, extractionId: eid, fileName: fileRow.name });
    await setExtraction(eid, { status: 'done', stage: 'done', progress: 100, proposal, model: meta.model, error: null });
  } catch (e) {
    await setExtraction(eid, { status: 'error', stage: 'failed', error: String(e?.message || e).slice(0, 400) });
  }
}
async function getExtraction(id) {
  if (running.has(id)) return running.get(id);
  const s = await guard((await store()).doc(`extractions/${id}`).get());
  if (!s.exists) throw fail(404, 'Analysis not found.');
  const r = { id, ...s.data() };
  if (r.proposalJson) { r.proposal = JSON.parse(r.proposalJson); delete r.proposalJson; }
  if (r.status === 'running' || r.status === 'queued') { r.status = 'error'; r.error = 'This analysis was interrupted (the page was closed). Run Analyze again.'; }
  return r;
}

// ---------- estimate ----------
async function estimateFor(jobId, scenarioId) {
  const j = await readJob(jobId);
  const [cat, std] = await Promise.all([catalog(), standards()]);
  try { return estimateJob({ ...j.job, version: j.version }, { catalog: cat, standards: std.settings || {}, scenarioId: scenarioId || null }); }
  catch (e) { throw fail(500, `Estimate could not be calculated: ${e.message}`); }
}

// ---------- router ----------
export async function handle(method, path, body, headers = {}) {
  const url = new URL(path, 'https://app.local');
  const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  const u = await me();
  const M = (m, ...segs) => method === m && segs.length === p.length - 1 && segs.every((s, i) => s === '*' || s === p[i + 1]);
  const json = typeof body === 'string' ? null : body;
  const ifMatch = () => { const v = headers['If-Match'] ?? headers['if-match'] ?? json?.version; const n = Number(String(v ?? '').replace(/"/g, '')); if (!Number.isFinite(n)) throw fail(428, 'Missing version (If-Match).'); return n; };

  if (M('GET', 'me') || M('POST', 'login')) return { user: u, csrf: 'cloud' };
  if (M('POST', 'logout')) return { ok: true };

  if (M('GET', 'jobs')) {
    const snap = await guard((await store()).collection('jobs').limit(500).get());
    const rows = snap.docs.map(s => s.data());
    const n = await names(rows.map(r => r.updatedById));
    return { jobs: rows.map(r => ({ id: r.id, projectKey: r.projectKey, name: r.name, customer: r.customer, status: r.status, version: r.version, updatedAt: r.updatedAt, updatedBy: n[r.updatedById] || 'Someone' }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) };
  }
  if (M('POST', 'jobs')) {
    need('editor', u);
    const name = String(json?.name || '').trim().slice(0, 160);
    if (!name) throw fail(400, 'Give the job a name.');
    const projectKey = json?.projectKey ? slug(json.projectKey) : `${slug(name)}-${crypto.randomUUID().slice(0, 6)}`;
    const existing = await guard((await store()).collection('jobs').where('projectKey', '==', projectKey).get());
    if (!existing.empty) throw fail(409, `Project key "${projectKey}" is already used by another job. Projects never share data; choose a different key.`);
    const doc = newJobDoc({ id: newId('job'), name, customer: String(json?.customer || '').slice(0, 160), address: String(json?.address || '').slice(0, 300), projectKey });
    await guard((await jobRef(doc.id)).set(jobRow(doc, 1, u)));
    await saveRevision(doc.id, 1, doc, u, 'created');
    await audit(u, 'job-create', doc.id, { name });
    return { job: doc, version: 1 };
  }
  if (p[1] === 'jobs' && p[2]) {
    const id = p[2];
    if (M('GET', 'jobs', '*')) {
      const j = await readJob(id);
      const n = await names([j.updatedById]);
      return { id: j.id, projectKey: j.projectKey, job: j.job, version: j.version, updatedAt: j.updatedAt, updatedBy: n[j.updatedById] || 'Someone', files: await listFiles(id) };
    }
    if (M('PUT', 'jobs', '*')) {
      need('editor', u);
      const expected = ifMatch();
      const cur = await readJob(id);
      const incoming = json?.job;
      const err = validateJobDoc(incoming);
      if (err) throw fail(400, err);
      if (incoming.projectKey != null && incoming.projectKey !== cur.projectKey) throw fail(400, 'projectKey cannot be changed after a job is created (projects never share data).');
      if (incoming.id != null && incoming.id !== cur.job.id) throw fail(400, 'Job id cannot be changed.');
      const doc = applyCorrections(protectServerFields(incoming, cur.job));
      const r = await saveJob(id, doc, expected, u, json?.summary);
      await audit(u, 'job-save', id, { version: r.version, summary: json?.summary || null });
      return r;
    }
    if (M('GET', 'jobs', '*', 'revisions')) {
      const snap = await guard((await store()).collection(`jobs/${id}/revisions`).orderBy('version', 'desc').limit(MAX_REVISIONS).get());
      const rows = snap.docs.map(s => s.data()); const n = await names(rows.map(r => r.authorId));
      return { revisions: rows.map(r => ({ version: r.version, author: n[r.authorId] || 'Someone', summary: r.summary, created_at: r.createdAt })) };
    }
    if (M('GET', 'jobs', '*', 'revisions', '*')) {
      const s = await guard((await store()).doc(`jobs/${id}/revisions/${String(Number(p[4])).padStart(6, '0')}`).get());
      if (!s.exists) throw fail(404, 'Revision not found.');
      const r = s.data(); return { version: r.version, summary: r.summary, createdAt: r.createdAt, job: JSON.parse(r.docJson) };
    }
    if (M('GET', 'jobs', '*', 'audit')) {
      const [revs, a] = await Promise.all([handle('GET', `/api/jobs/${id}/revisions`), guard((await store()).doc(`audit/${id}`).get())]);
      const log = a.exists ? a.data().log || [] : [];
      const n = await names(log.map(l => l.userId));
      return { revisions: revs.revisions, log: log.map(l => ({ at: l.at, username: n[l.userId] || 'Someone', action: l.action, detail: l.detail ? JSON.parse(l.detail) : null })) };
    }
    if (M('GET', 'jobs', '*', 'files')) return { files: await listFiles(id) };
    if (M('GET', 'jobs', '*', 'estimate')) return estimateFor(id, url.searchParams.get('scenario'));
    if (M('POST', 'jobs', '*', 'analyze')) {
      need('editor', u);
      const f = await loadFileRow(String(json?.fileId || ''));
      if (!f || f.jobId !== id) throw fail(404, 'That file is not attached to this job. Upload it first.');
      const eid = newId('ext');
      await setExtraction(eid, { id: eid, jobId: id, fileId: f.id, status: 'queued', stage: 'queued', progress: 0, createdAt: now(), createdById: u.id });
      await audit(u, 'analyze', id, { extractionId: eid, fileId: f.id });
      runAnalysis(eid, f);
      return { extractionId: eid, aiConfigured: !!(await cap('sample')) };
    }
    if (M('POST', 'jobs', '*', 'extractions', '*', 'apply')) {
      need('editor', u);
      const expected = ifMatch();
      const cur = await readJob(id);
      const ex = await getExtraction(p[4]);
      if (ex.jobId !== id) throw fail(404, 'Analysis not found for this job.');
      if (ex.status !== 'done') throw fail(409, `Analysis is ${ex.status}${ex.error ? `: ${ex.error}` : ''}; it cannot be applied yet.`);
      const accept = Array.isArray(json?.accept) ? json.accept.filter(x => typeof x === 'string').slice(0, 1000) : [];
      const edits = json?.edits && typeof json.edits === 'object' && !Array.isArray(json.edits) ? json.edits : {};
      const file = await loadFileRow(ex.fileId);
      const doc = applyProposal(cur.job, { extraction: ex, file: { id: file?.id || ex.fileId, name: file?.name || 'drawing', pages: file?.pages || null }, accept, edits });
      doc.extractions = [...(cur.job.extractions || []), { id: ex.id, fileId: ex.fileId, at: now(), model: ex.model || null, status: 'applied', summary: { accepted: accept.length, source: ex.proposal?.summary?.source || null } }];
      const r = await saveJob(id, doc, expected, u, `applied drawing analysis (${accept.length} items)`);
      await audit(u, 'analysis-apply', id, { extractionId: ex.id, accepted: accept.length, version: r.version });
      return { version: r.version, job: doc };
    }
  }
  if (M('GET', 'extractions', '*')) return getExtraction(p[2]);

  if (M('GET', 'catalog')) return { entries: await catalog() };
  if (M('POST', 'catalog')) {
    need('editor', u);
    const { entry, error } = validateEntry(json || {});
    if (error) throw fail(400, error);
    await guard((await store()).doc(`catalog/${slug(entry.id)}`).set({ ...entry, id: slug(entry.id) }));
    catalogCache = null; await audit(u, 'catalog-upsert', null, { id: entry.id, productKey: entry.productKey });
    return { entry };
  }
  if (M('DELETE', 'catalog', '*')) {
    need('editor', u);
    await guard((await store()).doc(`catalog/${slug(p[2])}`).delete());
    catalogCache = null; await audit(u, 'catalog-delete', null, { id: p[2] });
    return { ok: true };
  }
  if (M('POST', 'catalog', 'import')) {
    need('editor', u);
    const text = typeof body === 'string' ? body : String(json?.csv || '');
    const { entries, errors } = importCsv(text, json?.defaults || {});
    const d = await store();
    for (const e of entries) await guard(d.doc(`catalog/${slug(e.id)}`).set({ ...e, id: slug(e.id) }));
    catalogCache = null; await audit(u, 'catalog-import', null, { added: entries.length, errors: errors.length });
    return { imported: entries.length, errors, entries };
  }
  if (M('POST', 'catalog', 'lookup')) return { ok: false, error: 'Online price checks are not available in the phone app. Enter the price from the shelf tag or quote.' };
  if (M('GET', 'standards')) return standards();
  if (M('PUT', 'standards')) {
    need('admin', u);
    const cur = await standards();
    const next = { settings: json?.settings && typeof json.settings === 'object' ? json.settings : {}, version: (cur.version || 0) + 1, updatedAt: now(), updatedById: u.id };
    await guard((await store()).doc('standards/shop').set(next));
    await audit(u, 'standards-save', null, { version: next.version });
    return next;
  }
  if (M('GET', 'users')) return { users: [u] };
  throw fail(404, 'Not available in the phone app.');
}

/** Drawing upload into the artifact's asset store (kept in memory too, for analysis right away). */
export async function upload(path, file, onProgress) {
  const u = await me(); need('editor', u);
  const jobId = decodeURIComponent(path.split('/')[3] || '');
  await readJob(jobId);
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
  if (!/^(application\/pdf|image\/(png|jpeg|webp|heic|heif))$/.test(type)) throw fail(415, 'Only PDF, PNG and JPEG drawings are supported. Export the plan as PDF or take a photo.');
  if (file.size > 20 * 1024 * 1024) throw fail(413, 'That file is larger than 20 MB. Export a smaller PDF or upload a photo.');
  onProgress?.(0.1);
  let pages = 1;
  if (type === 'application/pdf') { try { pages = (await openPdf(file)).numPages; } catch { pages = null; } }
  onProgress?.(0.3);
  const assets = await cap('assets');
  let up = null;
  if (assets) { try { up = await assets.upload(file); } catch { up = null; } }
  onProgress?.(1);
  const fileId = newId('file');
  localFiles.set(fileId, file);
  const row = { jobId, name: String(file.name || 'drawing').slice(0, 200), mime: type, size: file.size, pages, assetId: up?.id || null, url: up?.url || null, createdAt: now(), createdById: u.id };
  await guard((await store()).doc(`files/${fileId}`).set(row));
  if (row.url) fileUrls.set(fileId, { url: row.url, mime: type });
  await audit(u, 'file-upload', jobId, { fileId, name: row.name, size: row.size, stored: !!up });
  return { fileId, name: row.name, pages, kind: type === 'application/pdf' ? 'pdf' : 'image', mime: type, stored: !!up };
}

/** Export links (/api/jobs/:id/export/…) become file saves through the viewer. */
export async function saveExport(href) {
  const url = new URL(href, 'https://app.local');
  const m = /^\/api\/jobs\/([^/]+)\/export\/(shopping\.csv|cutlist\.csv|jobpack\.html)$/.exec(url.pathname);
  if (!m) return false;
  const jobId = decodeURIComponent(m[1]);
  const j = await readJob(jobId);
  const est = await estimateFor(jobId, url.searchParams.get('scenario'));
  const base = slug(j.job.name);
  const data = m[2] === 'shopping.csv' ? shoppingCsv(est) : m[2] === 'cutlist.csv' ? cutListCsv(est) : jobPackHtml(est, j.job);
  const filename = `${base}-${m[2].replace('.csv', '').replace('.html', '')}.${m[2].split('.').pop()}`;
  const downloads = await cap('downloads');
  if (!downloads) throw fail(503, 'Saving files is not available in this view.');
  try { await downloads.save({ filename, data }); return true; }
  catch (e) { if (e?.code === 'declined') return true; throw fail(500, 'The file could not be saved. Try again.'); }
}
