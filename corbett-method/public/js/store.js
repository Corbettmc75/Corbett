// Job state + autosave with optimistic concurrency (If-Match version).
// Edits are recorded as patch functions so they can be re-applied on top of a newer revision.
import * as api from './api.js';

const listeners = new Set();
export const store = {
  jobId: null, job: null, version: null, updatedBy: null, updatedAt: null,
  pending: [],          // patch functions not yet confirmed by the server
  inflight: [],         // patch functions in the current PUT
  status: 'idle',       // idle | dirty | saving | saved | offline | conflict | error
  savedAt: null, conflict: null, error: null,
  estimate: null, estimateError: null, estimateLoading: false, scenarioId: null,
};
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) try { fn(what); } catch (e) { console.error(e); } }

let saveTimer = null, retryTimer = null, estTimer = null;

export async function loadJob(id) {
  clearTimeout(saveTimer); clearTimeout(retryTimer);
  const r = await api.get(`/api/jobs/${encodeURIComponent(id)}`);
  Object.assign(store, { jobId: id, job: r.job, version: r.version, updatedBy: r.updatedBy, updatedAt: r.updatedAt,
    pending: [], inflight: [], status: 'idle', conflict: null, error: null, estimate: null });
  const sel = (r.job.scenarios || []).find(s => s.selected);
  store.scenarioId = sel ? sel.id : null;
  emit('job');
  refreshEstimate(true);
  return r;
}

/** Apply an edit locally and schedule an autosave. fn(job) mutates the job. */
export function edit(fn, { immediate = false } = {}) {
  if (!store.job) return;
  fn(store.job);
  store.pending.push(fn);
  if (store.status !== 'conflict') setStatus('dirty');
  emit('edit');
  clearTimeout(saveTimer);
  if (store.status !== 'conflict') saveTimer = setTimeout(save, immediate ? 0 : 800);
}

function setStatus(s) { store.status = s; emit('status'); }

export async function save() {
  clearTimeout(saveTimer);
  if (!store.job || store.status === 'saving' || store.status === 'conflict') return;
  if (!store.pending.length) return;
  store.inflight = store.pending; store.pending = [];
  setStatus('saving');
  try {
    const r = await api.put(`/api/jobs/${encodeURIComponent(store.jobId)}`, { job: store.job }, { 'If-Match': String(store.version) });
    store.version = r.version; store.updatedAt = r.updatedAt || new Date().toISOString(); store.updatedBy = r.updatedBy || store.updatedBy;
    store.inflight = []; store.savedAt = new Date(); store.error = null;
    setStatus(store.pending.length ? 'dirty' : 'saved');
    if (store.pending.length) saveTimer = setTimeout(save, 800);
    refreshEstimate();
  } catch (e) {
    store.pending = store.inflight.concat(store.pending); store.inflight = [];
    if (e.status === 409) {
      store.conflict = e.body || {};
      setStatus('conflict'); emit('conflict');
    } else if (e.status === 0) {
      setStatus('offline');
      clearTimeout(retryTimer); retryTimer = setTimeout(() => { store.status = 'dirty'; save(); }, 8000);
    } else if (e.status === 401) {
      store.error = e.message; setStatus('error'); emit('auth');
    } else {
      store.error = e.message; setStatus('error');
      clearTimeout(retryTimer); retryTimer = setTimeout(() => { store.status = 'dirty'; save(); }, 15000);
    }
  }
}
window.addEventListener('online', () => { if (store.status === 'offline') { store.status = 'dirty'; save(); } });

/** Conflict resolution: discard my unsaved edits and load the newer revision. */
export async function reloadTheirs() {
  store.pending = []; store.status = 'idle'; store.conflict = null;
  await loadJob(store.jobId);
}
/** Conflict resolution: fetch the newer revision and re-apply my edits on top of it. */
export async function reapplyMine() {
  const mine = store.pending.slice();
  const r = await api.get(`/api/jobs/${encodeURIComponent(store.jobId)}`);
  const job = r.job;
  for (const fn of mine) { try { fn(job); } catch (e) { console.warn('patch failed', e); } }
  Object.assign(store, { job, version: r.version, updatedBy: r.updatedBy, updatedAt: r.updatedAt, pending: mine, conflict: null, status: 'dirty' });
  emit('job');
  await save();
}

export function refreshEstimate(now = false) {
  clearTimeout(estTimer);
  estTimer = setTimeout(async () => {
    if (!store.jobId) return;
    store.estimateLoading = true; emit('estimate-loading');
    try {
      const q = store.scenarioId ? `?scenario=${encodeURIComponent(store.scenarioId)}` : '';
      store.estimate = await api.get(`/api/jobs/${encodeURIComponent(store.jobId)}/estimate${q}`);
      store.estimateError = null;
    } catch (e) { store.estimateError = e.message; }
    store.estimateLoading = false;
    emit('estimate');
  }, now ? 0 : 400);
}

export function setScenario(id) { store.scenarioId = id; refreshEstimate(true); emit('scenario'); }

export function statusText() {
  switch (store.status) {
    case 'dirty': return 'Unsaved…';
    case 'saving': return 'Saving…';
    case 'saved': return `Saved ${store.savedAt ? store.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`;
    case 'offline': return 'Offline – will retry';
    case 'conflict': return 'Conflict';
    case 'error': return 'Not saved';
    default: return store.version != null ? 'Up to date' : '';
  }
}
