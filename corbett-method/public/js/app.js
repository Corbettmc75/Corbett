// App shell, auth and hash router.
import { h, mount, toast } from './h.js';
import * as api from './api.js';
import { store, subscribe, statusText, reloadTheirs, reapplyMine } from './store.js';
import { loginScreen, jobsScreen, newJobScreen, uploadScreen, reviewScreen } from './screens.js';
import { jobScreen } from './job.js';

export const app = { me: null };
const root = document.getElementById('app');

export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
export function canEdit() { return app.me && app.me.role !== 'viewer'; }

async function ensureMe() {
  if (app.me) return app.me;
  try {
    const r = await api.get('/api/me');
    app.me = r.user || r; api.setCsrf(r.csrf);
    return app.me;
  } catch (e) { if (e.status === 401 || e.status === 0 || e.status === 404) return null; throw e; }
}
export async function logout() {
  try { await api.post('/api/logout'); } catch {}
  app.me = null; store.jobId = null; store.job = null;
  go('#/login');
}

/** Top bar: back button, title, save status pill. */
export function topBar(title, { back, showSave } = {}) {
  const pill = h('span', { class: 'savepill', id: 'savepill', role: 'status', 'aria-live': 'polite' });
  const updatePill = () => { pill.textContent = statusText(); pill.className = `savepill s-${store.status}`; pill.hidden = !showSave || !pill.textContent; };
  updatePill();
  if (showSave) { const un = subscribe(w => { if (!document.body.contains(pill)) return un(); if (w === 'status' || w === 'job') updatePill(); }); }
  return h('header', { class: 'topbar' },
    back ? h('a', { href: back, class: 'iconbtn', 'aria-label': 'Back' }, '‹') : h('span', { class: 'brandmark', 'aria-hidden': 'true' }, 'C'),
    h('h1', null, title),
    pill);
}

// ---------- conflict sheet ----------
function conflictSheet() {
  const c = store.conflict || {};
  const who = c.updatedBy || 'Someone';
  const at = c.updatedAt ? new Date(c.updatedAt).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : 'just now';
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'conf-title' },
    h('h2', { id: 'conf-title' }, 'Newer version saved'),
    h('p', null, `${who} saved a newer version at ${at}. Your last ${store.pending.length} change(s) are not saved yet.`),
    h('p', { class: 'hint' }, 'Nothing has been overwritten. Choose how to continue.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: async () => { dlg.close(); try { await reapplyMine(); toast('Your changes were re-applied on top of the newer version.'); } catch (e) { toast(e.message, 'error'); } } }, 'Re-apply my changes on top'),
      h('button', { class: 'btn', onclick: async () => { dlg.close(); await reloadTheirs(); toast('Loaded the newer version. Your unsaved changes were discarded.'); } }, 'Reload theirs (discard mine)')));
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
subscribe(w => {
  if (w === 'conflict') conflictSheet();
  if (w === 'auth') { app.me = null; toast('Session ended — sign in again. Unsaved changes are kept on this screen until you do.', 'error'); go('#/login'); }
});

// ---------- router ----------
export async function route() {
  const parts = (location.hash || '#/jobs').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const me = await ensureMe().catch(e => { toast(e.message, 'error'); return null; });
  if (!me && parts[0] !== 'login') return go('#/login');
  try {
    switch (parts[0]) {
      case 'login': return mount(root, loginScreen());
      case '': case 'jobs': return mount(root, await jobsScreen());
      case 'new': return mount(root, newJobScreen());
      case 'job': {
        const [, id, sub, arg] = parts;
        if (sub === 'upload') return mount(root, await uploadScreen(id));
        if (sub === 'review') return mount(root, await reviewScreen(id, arg));
        return mount(root, await jobScreen(id, sub || 'summary'));
      }
      default: return go('#/jobs');
    }
  } catch (e) {
    console.error(e);
    if (e.status === 401) return go('#/login');
    mount(root, topBar('Problem', { back: '#/jobs' }),
      h('main', { class: 'page' }, h('div', { class: 'card error' }, h('h2', null, 'Could not open this screen'), h('p', null, e.message || String(e)),
        h('button', { class: 'btn', onclick: () => route() }, 'Try again'))));
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (store.pending.length || store.status === 'saving') { e.preventDefault(); e.returnValue = ''; } });

// ---------- PWA ----------
if ('serviceWorker' in navigator && !api.isMock) navigator.serviceWorker.register('/sw.js').catch(() => {});
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
export function installHint() {
  let dismissed = false; try { dismissed = localStorage.getItem('installHintDismissed') === '1'; } catch {}
  if (!isIOS || standalone || dismissed) return null;
  const el = h('div', { class: 'card hintcard' },
    h('strong', null, 'Install on your iPhone: '), 'tap Share ', h('span', { 'aria-hidden': 'true' }, '⎋'), ' then “Add to Home Screen”.',
    h('button', { class: 'linkbtn', onclick: () => { try { localStorage.setItem('installHintDismissed', '1'); } catch {} el.remove(); } }, 'Dismiss'));
  return el;
}

route();
