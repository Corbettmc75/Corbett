// Test harness: start the app on an ephemeral port with a temporary DATA_DIR.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../server/app.js';
import { hashPassword } from '../../server/auth.js';

export async function startServer(opts = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'corbett-test-'));
  const logs = [];
  const server = createServer({ dataDir, log: (m) => logs.push(String(m)), ...opts });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = {
    corbett: { pw: 'corbett-pass-1', role: 'admin' },
    courtney: { pw: 'courtney-pass-1', role: 'editor' },
    visitor: { pw: 'visitor-pass-1', role: 'viewer' },
  };
  for (const [u, { pw, role }] of Object.entries(users)) server.store.createUser({ username: u, name: u, role, pwHash: hashPassword(pw) });
  return {
    server, base, logs, dataDir, users,
    async close() { await new Promise(r => server.close(r)); rmSync(dataDir, { recursive: true, force: true }); },
    client() { return new Client(base); },
    async login(username) { const c = new Client(base); const r = await c.post('/api/login', { username, password: users[username].pw }); if (r.status !== 200) throw new Error(`login failed ${r.status}`); return c; },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = null; }
  async req(method, path, { json, body, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf && this.csrf && method !== 'GET') h['x-csrf'] = this.csrf;
    let payload = body;
    if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json); }
    const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, data, text, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, json, o = {}) { return this.req('POST', p, { json, ...o }); }
  put(p, json, o = {}) { return this.req('PUT', p, { json, ...o }); }
  del(p, o) { return this.req('DELETE', p, o); }
}

/** Minimal valid one-page PDF with a text layer. */
export function tinyPdf(text = "12' 7.5'") {
  const esc = text.replace(/[\\()]/g, (c) => '\\' + c);
  const stream = `BT /F1 24 Tf 72 700 Td (${esc}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const waitFor = async (fn, ms = 15000) => {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); }
};
