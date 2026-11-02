// SQLite storage (node:sqlite). Every job save is a new revision; catalog and
// standards live in their own tables so drawing uploads/analysis can never touch them.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  pw_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_key TEXT NOT NULL, doc TEXT NOT NULL, version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
CREATE TABLE IF NOT EXISTS job_revisions (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  doc TEXT NOT NULL, author TEXT, summary TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, version));
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, path TEXT NOT NULL,
  size INTEGER NOT NULL, pages INTEGER, created_at TEXT NOT NULL, created_by TEXT);
CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT, progress INTEGER NOT NULL DEFAULT 0,
  error TEXT, raw_json TEXT, proposal_json TEXT, model TEXT, created_at TEXT NOT NULL,
  created_by TEXT, applied_version INTEGER);
CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL, entry TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
CREATE INDEX IF NOT EXISTS catalog_product ON catalog(product_key);
CREATE TABLE IF NOT EXISTS standards (
  id INTEGER PRIMARY KEY CHECK (id = 1), settings TEXT NOT NULL, version INTEGER NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, username TEXT,
  action TEXT NOT NULL, job_id TEXT, detail TEXT);
`;

export const now = () => new Date().toISOString();

export function openDb(dataDir = process.env.DATA_DIR || join(ROOT, 'var'), dbPath = null) {
  mkdirSync(dataDir, { recursive: true });
  const path = dbPath || join(dataDir, 'corbett.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const store = new Store(db, dataDir);
  store.seedCatalogIfEmpty();
  return store;
}

const parse = (s) => (s == null ? null : JSON.parse(s));

export class Store {
  constructor(db, dataDir) { this.db = db; this.dataDir = dataDir; }
  close() { this.db.close(); }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---------- users / sessions ----------
  createUser({ username, name, role, pwHash }) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id, username, name, role, pw_hash, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, username.toLowerCase(), name, role, pwHash, now());
    return this.userById(id);
  }
  setPassword(username, pwHash) {
    return this.db.prepare('UPDATE users SET pw_hash = ? WHERE username = ?').run(pwHash, username.toLowerCase()).changes;
  }
  userByUsername(u) { return this.db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(String(u).toLowerCase()); }
  userById(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  listUsers() { return this.db.prepare('SELECT id, username, name, role, disabled, created_at FROM users ORDER BY username').all(); }

  createSession(idHash, userId, csrf, expiresAt) {
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)')
      .run(idHash, userId, csrf, now(), expiresAt);
  }
  sessionByHash(h) {
    return this.db.prepare(`SELECT s.*, u.username, u.name, u.role, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?`).get(h);
  }
  touchSession(h, expiresAt) { this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(expiresAt, h); }
  deleteSession(h) { this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(h); }
  purgeSessions() { this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

  // ---------- jobs ----------
  listJobs() {
    return this.db.prepare('SELECT id, project_key, doc, version, updated_at, updated_by FROM jobs ORDER BY updated_at DESC').all()
      .map(r => { const d = JSON.parse(r.doc);
        return { id: r.id, projectKey: r.project_key, name: d.name, customer: d.customer, status: d.status,
                 version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by }; });
  }
  getJob(id) {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!r) return null;
    return { job: JSON.parse(r.doc), version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by, projectKey: r.project_key };
  }
  insertJob(doc, author, summary = 'created') {
    const t = now();
    return this.tx(() => {
      this.db.prepare('INSERT INTO jobs (id, project_key, doc, version, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)')
        .run(doc.id, doc.projectKey, JSON.stringify(doc), 1, t, t, author);
      this.db.prepare('INSERT INTO job_revisions (job_id, version, doc, author, summary, created_at) VALUES (?,?,?,?,?,?)')
        .run(doc.id, 1, JSON.stringify(doc), author, summary, t);
      return 1;
    });
  }
  /** Compare-and-swap save. Returns {ok:true, version} or {ok:false, current}. */
  saveJob(id, doc, expectedVersion, author, summary = 'edited') {
    return this.tx(() => {
      const cur = this.db.prepare('SELECT version, updated_at, updated_by FROM jobs WHERE id = ?').get(id);
      if (!cur) return { ok: false, notFound: true };
      if (cur.version !== expectedVersion) return { ok: false, current: { version: cur.version, updatedAt: cur.updated_at, updatedBy: cur.updated_by } };
      const v = cur.version + 1, t = now();
      this.db.prepare('UPDATE jobs SET doc = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .run(JSON.stringify(doc), v, t, author, id);
      this.db.prepare('INSERT INTO job_revisions (job_id, version, doc, author, summary, created_at) VALUES (?,?,?,?,?,?)')
        .run(id, v, JSON.stringify(doc), author, summary, t);
      return { ok: true, version: v, updatedAt: t };
    });
  }
  listRevisions(jobId) {
    return this.db.prepare('SELECT version, author, summary, created_at FROM job_revisions WHERE job_id = ? ORDER BY version DESC').all(jobId);
  }
  getRevision(jobId, v) {
    const r = this.db.prepare('SELECT * FROM job_revisions WHERE job_id = ? AND version = ?').get(jobId, v);
    return r ? { version: r.version, author: r.author, summary: r.summary, createdAt: r.created_at, job: JSON.parse(r.doc) } : null;
  }

  // ---------- files ----------
  insertFile(f) {
    this.db.prepare(`INSERT INTO files (id, job_id, name, mime, sha256, path, size, pages, created_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(f.id, f.jobId, f.name, f.mime, f.sha256, f.path, f.size, f.pages ?? null, now(), f.createdBy ?? null);
    return this.getFile(f.id);
  }
  getFile(id) { return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id); }
  listFiles(jobId) { return this.db.prepare('SELECT id, name, mime, size, pages, created_at FROM files WHERE job_id = ? ORDER BY created_at').all(jobId); }

  // ---------- extractions ----------
  insertExtraction(e) {
    this.db.prepare(`INSERT INTO extractions (id, job_id, file_id, status, stage, progress, created_at, created_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(e.id, e.jobId, e.fileId, 'queued', 'queued', 0, now(), e.createdBy ?? null);
  }
  updateExtraction(id, patch) {
    const cols = { status: 'status', stage: 'stage', progress: 'progress', error: 'error', raw: 'raw_json', proposal: 'proposal_json', model: 'model', appliedVersion: 'applied_version' };
    const sets = [], vals = [];
    for (const [k, col] of Object.entries(cols)) if (k in patch) {
      sets.push(`${col} = ?`);
      vals.push((k === 'raw' || k === 'proposal') && patch[k] != null ? JSON.stringify(patch[k]) : patch[k]);
    }
    if (sets.length) this.db.prepare(`UPDATE extractions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  getExtraction(id) {
    const r = this.db.prepare('SELECT * FROM extractions WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, jobId: r.job_id, fileId: r.file_id, status: r.status, stage: r.stage, progress: r.progress,
             error: r.error, model: r.model, createdAt: r.created_at, appliedVersion: r.applied_version,
             proposal: parse(r.proposal_json) };
  }

  // ---------- catalog ----------
  seedCatalogIfEmpty() {
    const n = this.db.prepare('SELECT COUNT(*) n FROM catalog').get().n;
    if (n > 0) return 0;
    const p = join(ROOT, 'data', 'catalog.seed.json');
    if (!existsSync(p)) return 0;
    const entries = JSON.parse(readFileSync(p, 'utf8'));
    this.tx(() => { for (const e of entries) this._upsertCatalog(e, 'seed'); });
    return entries.length;
  }
  _upsertCatalog(e, by) {
    this.db.prepare(`INSERT INTO catalog (id, product_key, entry, updated_at, updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_key = excluded.product_key, entry = excluded.entry,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(e.id, e.productKey, JSON.stringify(e), now(), by);
  }
  upsertCatalog(e, by) { this._upsertCatalog(e, by); return e; }
  upsertCatalogMany(entries, by) { return this.tx(() => { for (const e of entries) this._upsertCatalog(e, by); return entries.length; }); }
  deleteCatalog(id) { return this.db.prepare('DELETE FROM catalog WHERE id = ?').run(id).changes; }
  listCatalog() { return this.db.prepare('SELECT entry FROM catalog ORDER BY product_key, id').all().map(r => JSON.parse(r.entry)); }
  catalogCount() { return this.db.prepare('SELECT COUNT(*) n FROM catalog').get().n; }

  // ---------- standards ----------
  getStandards() {
    const r = this.db.prepare('SELECT * FROM standards WHERE id = 1').get();
    return r ? { settings: JSON.parse(r.settings), version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by }
             : { settings: {}, version: 0, updatedAt: null, updatedBy: null };
  }
  saveStandards(settings, by) {
    const cur = this.getStandards();
    const v = cur.version + 1;
    this.db.prepare(`INSERT INTO standards (id, settings, version, updated_at, updated_by) VALUES (1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, version = excluded.version,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(JSON.stringify(settings), v, now(), by);
    return this.getStandards();
  }

  // ---------- audit ----------
  audit(user, action, jobId = null, detail = null) {
    this.db.prepare('INSERT INTO audit_log (at, user_id, username, action, job_id, detail) VALUES (?,?,?,?,?,?)')
      .run(now(), user?.id ?? null, user?.username ?? null, action, jobId, detail == null ? null : JSON.stringify(detail));
  }
  auditFor(jobId) {
    return this.db.prepare('SELECT at, username, action, detail FROM audit_log WHERE job_id = ? ORDER BY id DESC LIMIT 500').all(jobId)
      .map(r => ({ ...r, detail: parse(r.detail) }));
  }
}
