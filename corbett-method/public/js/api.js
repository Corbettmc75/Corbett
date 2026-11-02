// API client: same-origin cookies, X-CSRF on mutations, typed errors.
const MOCK = new URLSearchParams(location.search).has('mock');
let csrf = null;
let mockMod = null;
async function mock() { if (!mockMod) mockMod = await import('./mock.js'); return mockMod; }

export class ApiError extends Error {
  constructor(status, body, message) { super(message); this.status = status; this.body = body; }
}
export function setCsrf(t) { if (t) csrf = t; }
export const isMock = MOCK;

function friendly(status, body) {
  if (body && typeof body.error === 'string') return body.error;
  if (status === 401) return 'Your session ended — please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'Not found — it may have been deleted.';
  if (status === 409) return 'Someone saved a newer version.';
  if (status === 413) return 'That file is too large.';
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  return `Request failed (${status}).`;
}

export async function request(method, path, body, headers = {}) {
  if (MOCK) return (await mock()).handle(method, path, body, headers);
  const opts = { method, credentials: 'same-origin', headers: { ...headers } };
  if (method !== 'GET' && method !== 'HEAD' && csrf) opts.headers['X-CSRF'] = csrf;
  if (body !== undefined && !(body instanceof Blob) && typeof body !== 'string') {
    opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body);
  } else if (body !== undefined) opts.body = body;
  let res;
  try { res = await fetch(path, opts); }
  catch (e) { throw new ApiError(0, null, 'Offline — check your connection.'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (data && data.csrf) setCsrf(data.csrf);
  if (!res.ok) throw new ApiError(res.status, data, friendly(res.status, data));
  return data;
}
export const get = (p) => request('GET', p);
export const post = (p, b) => request('POST', p, b ?? {});
export const put = (p, b, h) => request('PUT', p, b, h);
export const del = (p) => request('DELETE', p);

/** Upload with progress (XHR gives upload progress; fetch does not). */
export function upload(path, file, onProgress) {
  if (MOCK) return mock().then(m => m.upload(path, file, onProgress));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'drawing'));
    if (csrf) xhr.setRequestHeader('X-CSRF', csrf);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError(0, null, 'Upload failed — check your connection and try again.'));
    xhr.onload = () => {
      let data = null; try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data, friendly(xhr.status, data)));
    };
    xhr.send(file);
  });
}
