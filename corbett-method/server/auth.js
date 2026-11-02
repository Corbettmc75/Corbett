// Password hashing (scrypt), cookie sessions, CSRF tokens, roles and login rate limiting.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const SESSION_COOKIE = 'cm_sid';
const SESSION_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Password must be at least 8 characters.');
  const salt = randomBytes(16);
  const dk = scryptSync(pw.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

// A fixed hash used to equalize timing when the username does not exist.
const DUMMY = hashPassword('dummy-password-not-used');

export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB64, dkB64] = String(stored || DUMMY).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(dkB64, 'base64');
    const dk = scryptSync(String(pw).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(dk, expected) && !!stored;
  } catch { return false; }
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(store, user) {
  const sid = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  store.createSession(sha(sid), user.id, csrf, Date.now() + SESSION_MS);
  return { sid, csrf };
}

export function sessionCookie(sid, { secure }) {
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
}
export function clearCookie({ secure }) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Returns {user, csrf, idHash} or null. Sliding expiry. */
export function authenticate(store, req) {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sid || sid.length > 100) return null;
  const h = sha(sid);
  const s = store.sessionByHash(h);
  if (!s || s.disabled) return null;
  if (s.expires_at < Date.now()) { store.deleteSession(h); return null; }
  if (s.expires_at - Date.now() < SESSION_MS - 3600 * 1000) store.touchSession(h, Date.now() + SESSION_MS);
  return { user: { id: s.user_id, username: s.username, name: s.name, role: s.role }, csrf: s.csrf, idHash: h };
}

export function logout(store, req) {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sid) store.deleteSession(sha(sid));
}

export function csrfOk(auth, req) {
  const got = req.headers['x-csrf'];
  if (!auth || typeof got !== 'string') return false;
  const a = Buffer.from(got), b = Buffer.from(auth.csrf);
  return a.length === b.length && timingSafeEqual(a, b);
}

const RANK = { viewer: 0, editor: 1, admin: 2 };
export const can = (user, role) => !!user && RANK[user.role] >= RANK[role];

/** Sliding-window login limiter: max attempts per key per window. */
export class RateLimiter {
  constructor({ max = 8, windowMs = 15 * 60 * 1000 } = {}) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  _list(key) {
    const t = Date.now();
    const l = (this.hits.get(key) || []).filter(x => t - x < this.windowMs);
    this.hits.set(key, l);
    return l;
  }
  blocked(...keys) { return keys.some(k => this._list(k).length >= this.max); }
  fail(...keys) { for (const k of keys) this._list(k).push(Date.now()); }
  reset(...keys) { for (const k of keys) this.hits.delete(k); }
}
