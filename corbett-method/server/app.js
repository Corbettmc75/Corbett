// HTTP application: static PWA + JSON API (CONTRACT §6). Zero dependencies.
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, authenticate, logout, csrfOk, can, RateLimiter } from './auth.js';
import { validateEntry, importCsv } from './catalog.js';
import { applyProposal, protectServerFields, validateJobDoc, newJobDoc, applyCorrections } from './merge.js';
import { sniffMime, pdfInfo, renderPage, isPdf } from './extract/pdf.js';
import { AnalysisQueue } from './extract/pipeline.js';
import { redact } from './extract/anthropic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MAX_JSON = 6 * 1024 * 1024;
const MAX_UPLOAD = 40 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const CSP_PRINT = "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
}

function sendJson(res, status, body, headers = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(s);
}

function readBody(req, limit) {
  return new Promise((resolveP, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) { reject(new HttpError(413, `Upload is too large (limit ${Math.round(limit / 1048576)} MB).`)); req.resume(); return; }
    const chunks = []; let size = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(new HttpError(413, `Upload is too large (limit ${Math.round(limit / 1048576)} MB).`)); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolveP(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

async function readJson(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
}

const slug = (s) => String(s || 'job').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
const safeName = (s) => String(s || 'file').replace(/[^A-Za-z0-9._ \-]/g, '_').slice(0, 120);

export function createServer({ dataDir = process.env.DATA_DIR || join(ROOT, 'var'), dbPath = null, fetchImpl = globalThis.fetch,
  log = (m) => console.log(m), cookieSecure = process.env.COOKIE_SECURE === '1', loginLimit = { max: 8, windowMs: 15 * 60 * 1000 } } = {}) {
  const store = openDb(dataDir, dbPath);
  const filesDir = join(dataDir, 'files'); mkdirSync(filesDir, { recursive: true });
  const pagesDir = join(dataDir, 'pages');
  const queue = new AnalysisQueue(store, { fetchImpl, log: (m) => log(redact(m)) });
  const limiter = new RateLimiter(loginLimit);
  const routes = [];
  const route = (method, pattern, opts, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, opts, handler });
  };
  let enginePromise = null, exportsPromise = null;
  const loadEngine = () => (enginePromise ||= import('../engine/estimate.js'));
  const loadExports = () => (exportsPromise ||= import('../engine/exports.js'));

  // ---------- helpers ----------
  const userView = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });
  const requireJob = (id) => { const j = store.getJob(id); if (!j) throw new HttpError(404, 'Job not found.'); return j; };
  const ifMatch = (req, body) => {
    const h = req.headers['if-match'];
    const v = h != null ? Number(String(h).replace(/^W\//, '').replace(/"/g, '')) : Number(body?.version);
    if (!Number.isInteger(v) || v < 1) throw new HttpError(428, 'Send the version you edited in the If-Match header so newer changes are not overwritten.');
    return v;
  };
  const conflict = (cur) => new HttpError(409, `This job was changed by ${cur.updatedBy || 'someone else'} at ${cur.updatedAt}. Reload to see the newer version before saving.`,
    { version: cur.version, updatedBy: cur.updatedBy, updatedAt: cur.updatedAt });

  async function runEstimate(jobRec, scenarioId) {
    let mod;
    try { mod = await loadEngine(); }
    catch (e) { enginePromise = null; throw new HttpError(503, `The estimating engine is not available on this server (${e.code === 'ERR_MODULE_NOT_FOUND' ? 'engine/estimate.js missing' : e.message}). Install the full app and restart.`); }
    if (typeof mod.estimateJob !== 'function') throw new HttpError(503, 'The estimating engine is incomplete (estimateJob not exported).');
    const job = { ...jobRec.job, version: jobRec.version };
    try {
      return await mod.estimateJob(job, { catalog: store.listCatalog(), standards: store.getStandards().settings, scenarioId: scenarioId || null });
    } catch (e) { throw new HttpError(500, `Estimate could not be calculated: ${e.message}`); }
  }

  // ---------- auth ----------
  route('POST', '/api/login', { public: true }, async (req, res, { ip }) => {
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase().slice(0, 64);
    const keys = [`ip:${ip}`, `u:${username}`];
    if (limiter.blocked(...keys)) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const user = username ? store.userByUsername(username) : null;
    const ok = verifyPassword(String(body.password || ''), user?.pw_hash);
    if (!user || !ok) { limiter.fail(...keys); throw new HttpError(401, 'Username or password is incorrect.'); }
    limiter.reset(`u:${username}`);
    const { sid, csrf } = createSession(store, user);
    store.audit(user, 'login');
    sendJson(res, 200, { user: userView(user), csrf }, { 'Set-Cookie': sessionCookie(sid, { secure: cookieSecure }) });
  });
  route('POST', '/api/logout', {}, async (req, res, { user }) => {
    logout(store, req); store.audit(user, 'logout');
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie({ secure: cookieSecure }) });
  });
  route('GET', '/api/me', {}, async (req, res, { user, auth }) => sendJson(res, 200, { user, csrf: auth.csrf }));
  route('POST', '/api/me/password', {}, async (req, res, { user }) => {
    const body = await readJson(req);
    const row = store.userById(user.id);
    if (!verifyPassword(String(body.current || ''), row.pw_hash)) throw new HttpError(403, 'Current password is incorrect.');
    let h; try { h = hashPassword(String(body.next || '')); } catch (e) { throw new HttpError(400, e.message); }
    store.setPassword(user.username, h); store.audit(user, 'password-change');
    sendJson(res, 200, { ok: true });
  });
  route('GET', '/api/users', { role: 'admin' }, async (req, res) => sendJson(res, 200, { users: store.listUsers() }));

  // ---------- jobs ----------
  route('GET', '/api/jobs', {}, async (req, res) => sendJson(res, 200, { jobs: store.listJobs() }));
  route('POST', '/api/jobs', { role: 'editor' }, async (req, res, { user }) => {
    const body = await readJson(req);
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) throw new HttpError(400, 'Give the job a name.');
    let projectKey = body.projectKey ? slug(body.projectKey) : `${slug(name)}-${randomUUID().slice(0, 6)}`;
    if (store.listJobs().some(j => j.projectKey === projectKey)) throw new HttpError(409, `Project key "${projectKey}" is already used by another job. Projects never share data; choose a different key.`);
    const doc = newJobDoc({ id: `job-${randomUUID()}`, name, customer: String(body.customer || '').slice(0, 160), address: String(body.address || '').slice(0, 300), projectKey });
    const version = store.insertJob(doc, user.username);
    store.audit(user, 'job-create', doc.id, { name });
    sendJson(res, 201, { job: doc, version });
  });
  route('GET', '/api/jobs/:id', {}, async (req, res, { params }) => {
    const j = requireJob(params.id);
    sendJson(res, 200, { ...j, files: store.listFiles(params.id) }, { ETag: `"${j.version}"` });
  });
  route('PUT', '/api/jobs/:id', { role: 'editor' }, async (req, res, { params, user }) => {
    const body = await readJson(req);
    const expected = ifMatch(req, body);
    const cur = requireJob(params.id);
    const incoming = body.job;
    const err = validateJobDoc(incoming);
    if (err) throw new HttpError(400, err);
    if (incoming.projectKey != null && incoming.projectKey !== cur.projectKey) throw new HttpError(400, 'projectKey cannot be changed after a job is created (projects never share data).');
    if (incoming.id != null && incoming.id !== cur.job.id) throw new HttpError(400, 'Job id cannot be changed.');
    const doc = applyCorrections(protectServerFields(incoming, cur.job));
    const r = store.saveJob(params.id, doc, expected, user.username, String(body.summary || 'edited').slice(0, 200));
    if (!r.ok) throw conflict(r.current);
    store.audit(user, 'job-save', params.id, { version: r.version, summary: body.summary || null });
    sendJson(res, 200, { version: r.version, updatedAt: r.updatedAt, updatedBy: user.username }, { ETag: `"${r.version}"` });
  });
  route('GET', '/api/jobs/:id/revisions', {}, async (req, res, { params }) => { requireJob(params.id); sendJson(res, 200, { revisions: store.listRevisions(params.id) }); });
  route('GET', '/api/jobs/:id/revisions/:v', {}, async (req, res, { params }) => {
    const r = store.getRevision(params.id, Number(params.v));
    if (!r) throw new HttpError(404, 'Revision not found.');
    sendJson(res, 200, r);
  });
  route('GET', '/api/jobs/:id/audit', {}, async (req, res, { params }) => {
    requireJob(params.id);
    sendJson(res, 200, { revisions: store.listRevisions(params.id), log: store.auditFor(params.id) });
  });

  // ---------- files ----------
  route('GET', '/api/jobs/:id/files', {}, async (req, res, { params }) => { requireJob(params.id); sendJson(res, 200, { files: store.listFiles(params.id) }); });
  route('POST', '/api/jobs/:id/files', { role: 'editor' }, async (req, res, { params, user }) => {
    requireJob(params.id);
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, 'The upload was empty. Choose the drawing file again.');
    const mime = sniffMime(buf);
    if (!mime) throw new HttpError(415, 'Only PDF, PNG and JPEG drawings are supported. Export the plan as PDF or take a photo (JPEG).');
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const path = join(filesDir, sha256);
    if (!existsSync(path)) { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, buf, { mode: 0o600 }); renameSync(tmp, path); }
    let pages = 1, rotation = [];
    if (isPdf(mime)) { try { ({ pages, rotation } = await pdfInfo(path)); } catch { pages = null; } }
    let name = req.headers['x-filename'] ? String(req.headers['x-filename']) : 'drawing';
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    const f = store.insertFile({ id: `file-${randomUUID()}`, jobId: params.id, name: safeName(name), mime, sha256, path, size: buf.length, pages, createdBy: user.username });
    store.audit(user, 'file-upload', params.id, { fileId: f.id, name: f.name, size: f.size });
    sendJson(res, 201, { fileId: f.id, name: f.name, pages, rotation, kind: isPdf(mime) ? 'pdf' : 'image', mime });
  });
  route('GET', '/api/files/:id', {}, async (req, res, { params }) => {
    const f = store.getFile(params.id);
    if (!f || !existsSync(f.path)) throw new HttpError(404, 'File not found.');
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.size, 'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="${safeName(f.name)}"`, 'Content-Security-Policy': "default-src 'none'; sandbox" });
    createReadStream(f.path).pipe(res);
  });
  route('GET', '/api/files/:id/pages/:n', {}, async (req, res, { params }) => {
    const f = store.getFile(params.id);
    if (!f) throw new HttpError(404, 'File not found.');
    const n = Number(String(params.n).replace(/\.png$/, ''));
    if (!Number.isInteger(n) || n < 1 || (f.pages && n > f.pages)) throw new HttpError(404, 'Page not found.');
    let p, type = 'image/png';
    if (isPdf(f.mime)) {
      try { p = await renderPage(f.path, f.sha256, n, pagesDir); }
      catch (e) { throw new HttpError(e.code === 'NO_POPPLER' ? 503 : 500, e.code === 'NO_POPPLER' ? 'Page previews need poppler-utils (pdftoppm) on the server.' : 'This page could not be rendered.'); }
    } else { if (n !== 1) throw new HttpError(404, 'Page not found.'); p = f.path; type = f.mime; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(p).size, 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    createReadStream(p).pipe(res);
  });

  // ---------- analysis ----------
  route('POST', '/api/jobs/:id/analyze', { role: 'editor' }, async (req, res, { params, user }) => {
    const body = await readJson(req);
    requireJob(params.id);
    const f = store.getFile(String(body.fileId || ''));
    if (!f || f.job_id !== params.id) throw new HttpError(404, 'That file is not attached to this job. Upload it first.');
    const id = `ext-${randomUUID()}`;
    store.insertExtraction({ id, jobId: params.id, fileId: f.id, createdBy: user.username });
    store.audit(user, 'analyze', params.id, { extractionId: id, fileId: f.id });
    queue.enqueue(id);
    sendJson(res, 202, { extractionId: id, aiConfigured: !!process.env.ANTHROPIC_API_KEY });
  });
  route('GET', '/api/extractions/:id', {}, async (req, res, { params }) => {
    const e = store.getExtraction(params.id);
    if (!e) throw new HttpError(404, 'Analysis not found.');
    sendJson(res, 200, e);
  });
  route('POST', '/api/jobs/:id/extractions/:eid/apply', { role: 'editor' }, async (req, res, { params, user }) => {
    const body = await readJson(req);
    const expected = ifMatch(req, body);
    const cur = requireJob(params.id);
    const ex = store.getExtraction(params.eid);
    if (!ex || ex.jobId !== params.id) throw new HttpError(404, 'Analysis not found for this job.');
    if (ex.status !== 'done') throw new HttpError(409, `Analysis is ${ex.status}${ex.error ? `: ${ex.error}` : ''}; it cannot be applied yet.`);
    const accept = Array.isArray(body.accept) ? body.accept.filter(x => typeof x === 'string').slice(0, 1000) : [];
    const edits = body.edits && typeof body.edits === 'object' && !Array.isArray(body.edits) ? body.edits : {};
    const file = store.getFile(ex.fileId);
    const doc = applyProposal(cur.job, { extraction: ex, file: { id: file.id, name: file.name, pages: file.pages }, accept, edits });
    doc.extractions = [...(cur.job.extractions || []), { id: ex.id, fileId: ex.fileId, at: new Date().toISOString(), model: ex.model,
      status: 'applied', summary: { accepted: accept.length, source: ex.proposal?.summary?.source || null } }];
    const r = store.saveJob(params.id, doc, expected, user.username, `applied drawing analysis (${accept.length} items)`);
    if (!r.ok) throw conflict(r.current);
    store.updateExtraction(ex.id, { appliedVersion: r.version });
    store.audit(user, 'analysis-apply', params.id, { extractionId: ex.id, accepted: accept.length, version: r.version });
    sendJson(res, 200, { version: r.version, job: doc });
  });

  // ---------- estimate & exports ----------
  const scenarioOf = (url) => (url.searchParams.get('scenario') || '').slice(0, 80) || null;
  route('GET', '/api/jobs/:id/estimate', {}, async (req, res, { params, url }) => {
    const j = requireJob(params.id);
    sendJson(res, 200, await runEstimate(j, scenarioOf(url)));
  });
  route('GET', '/api/jobs/:id/export/:file', {}, async (req, res, { params, url }) => {
    const j = requireJob(params.id);
    const est = await runEstimate(j, scenarioOf(url));
    let ex;
    try { ex = await loadExports(); } catch (e) { exportsPromise = null; throw new HttpError(503, 'Exports are not available on this server (engine/exports.js missing).'); }
    const base = slug(j.job.name);
    if (params.file === 'shopping.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${base}-shopping.csv"` });
      return res.end(ex.shoppingCsv(est));
    }
    if (params.file === 'cutlist.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${base}-cutlist.csv"` });
      return res.end(ex.cutListCsv(est));
    }
    if (params.file === 'jobpack.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP_PRINT, 'X-Frame-Options': 'SAMEORIGIN' });
      return res.end(ex.jobPackHtml(est, j.job));
    }
    throw new HttpError(404, 'Unknown export. Use shopping.csv, cutlist.csv or jobpack.html.');
  });

  // ---------- catalog & standards ----------
  route('GET', '/api/catalog', {}, async (req, res) => sendJson(res, 200, { entries: store.listCatalog() }));
  route('POST', '/api/catalog', { role: 'editor' }, async (req, res, { user }) => {
    const { entry, error } = validateEntry(await readJson(req));
    if (error) throw new HttpError(400, error);
    store.upsertCatalog(entry, user.username);
    store.audit(user, 'catalog-upsert', null, { id: entry.id, productKey: entry.productKey });
    sendJson(res, 200, { entry });
  });
  route('DELETE', '/api/catalog/:id', { role: 'editor' }, async (req, res, { params, user }) => {
    if (!store.deleteCatalog(params.id)) throw new HttpError(404, 'Catalog entry not found.');
    store.audit(user, 'catalog-delete', null, { id: params.id });
    sendJson(res, 200, { ok: true });
  });
  route('POST', '/api/catalog/import', { role: 'editor' }, async (req, res, { user }) => {
    const ct = String(req.headers['content-type'] || '');
    let text, defaults = {};
    if (ct.startsWith('application/json')) { const b = await readJson(req); text = String(b.csv || ''); defaults = b.defaults && typeof b.defaults === 'object' ? b.defaults : {}; }
    else if (ct.startsWith('text/csv') || ct.startsWith('text/plain')) text = (await readBody(req, MAX_JSON)).toString('utf8');
    else throw new HttpError(415, 'Send the CSV as text/csv, or JSON {csv, defaults}.');
    const { entries, errors } = importCsv(text, defaults);
    if (entries.length) store.upsertCatalogMany(entries, user.username);
    store.audit(user, 'catalog-import', null, { added: entries.length, errors: errors.length });
    sendJson(res, 200, { imported: entries.length, errors, entries });
  });
  route('GET', '/api/standards', {}, async (req, res) => sendJson(res, 200, store.getStandards()));
  route('PUT', '/api/standards', { role: 'admin' }, async (req, res, { user }) => {
    const body = await readJson(req);
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw new HttpError(400, 'Send {settings: {...}}.');
    const cur = store.getStandards();
    if (body.version != null && Number(body.version) !== cur.version) throw new HttpError(409, 'Standards were changed by someone else. Reload first.', { version: cur.version });
    const s = store.saveStandards(body.settings, user.username);
    store.audit(user, 'standards-save', null, { version: s.version });
    sendJson(res, 200, s);
  });

  // ---------- static ----------
  function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad path.'); }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad path.');
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = resolve(PUBLIC, '.' + rel);
    if (target !== PUBLIC && !target.startsWith(PUBLIC + sep)) throw new HttpError(404, 'Not found.');
    let file = target;
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(rel)) throw new HttpError(404, 'Not found.');
      file = join(PUBLIC, 'index.html'); // SPA route
      if (!existsSync(file)) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('The Corbett Method server is running. The app UI (public/) is not installed.'); }
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Content-Length': statSync(file).size,
      'Cache-Control': /\.(html|webmanifest)$/.test(file) || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP_APP;
    if (file.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  // ---------- dispatcher ----------
  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    baseHeaders(res);
    const url = new URL(req.url, 'http://local');
    const ip = req.socket.remoteAddress || 'unknown';
    res.on('finish', () => log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`));
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
        return serveStatic(req, res, url);
      }
      let match = null, methodMismatch = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        if (r.method !== req.method) { methodMismatch = true; continue; }
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
        match = { r, params }; break;
      }
      if (!match) throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'Method not allowed.' : 'Unknown API endpoint.');
      const ctx = { params: match.params, url, ip };
      if (!match.r.opts.public) {
        const auth = authenticate(store, req);
        if (!auth) throw new HttpError(401, 'Please sign in.');
        ctx.auth = auth; ctx.user = auth.user;
        if (req.method !== 'GET' && req.method !== 'HEAD' && !csrfOk(auth, req)) throw new HttpError(403, 'Security token missing or expired. Reload the app and try again.');
        if (match.r.opts.role && !can(auth.user, match.r.opts.role)) throw new HttpError(403, `Your account (${auth.user.role}) cannot do this.`);
      }
      await match.r.handler(req, res, ctx);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : 'Something went wrong on the server. Try again; if it repeats, check the server log.';
      if (status === 500) log(`error ${req.method} ${url.pathname}: ${redact(e.stack || e.message)}`);
      if (!res.headersSent) sendJson(res, status, { error: message, ...(e.extra || {}) });
      else res.destroy();
    }
  });

  server.store = store;
  server.queue = queue;
  server.on('close', () => { try { store.close(); } catch { /* already closed */ } });
  setInterval(() => { try { store.purgeSessions(); } catch { /* closed */ } }, 3600 * 1000).unref();
  return server;
}
