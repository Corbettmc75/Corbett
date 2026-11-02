// Login, jobs list, new job, upload + analyze, extraction review.
import { h, mount, toast, field, when, basisBadge, feetIn, num, QTYPE } from './h.js';
import * as api from './api.js';
import { app, go, topBar, logout, installHint, canEdit } from './app.js';
import { planSvg, toPoints } from './plan.js';

// ---------------- Login ----------------
export function loginScreen() {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'formerr', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const r = await api.post('/api/login', { username: user.value.trim(), password: pass.value });
      app.me = r.user || r; api.setCsrf(r.csrf); pass.value = '';
      go('#/jobs');
    } catch (ex) { err.textContent = ex.status === 401 ? 'Wrong username or password.' : ex.message; }
    btn.disabled = false; btn.textContent = 'Sign in';
  } }, field('Username', user), field('Password', pass), err, btn);
  return h('main', { class: 'page login' },
    h('div', { class: 'logo' }, h('img', { src: '/icon.svg', alt: '', width: 72, height: 72 }), h('h1', null, 'The Corbett Method'), h('p', { class: 'hint' }, 'Garden build estimating')),
    form);
}

// ---------------- Jobs ----------------
const JOB_STATUS = { draft: 'Draft', estimating: 'Estimating', approved: 'Approved', building: 'Building', done: 'Done' };
export async function jobsScreen() {
  const list = await api.get('/api/jobs');
  const jobs = Array.isArray(list) ? list : (list.jobs || []);
  return h('div', null,
    topBar('Jobs'),
    h('main', { class: 'page' },
      installHint(),
      canEdit() ? h('a', { class: 'btn primary block big', href: '#/new' }, '+ New job') : null,
      jobs.length ? h('ul', { class: 'joblist' }, jobs.map(j => h('li', null,
        h('a', { class: 'card jobcard', href: `#/job/${encodeURIComponent(j.id)}/summary` },
          h('div', { class: 'row' }, h('strong', null, j.name), h('span', { class: `chip js-${j.status}` }, JOB_STATUS[j.status] || j.status || '')),
          j.customer ? h('div', { class: 'muted' }, j.customer) : null,
          h('div', { class: 'muted small' }, `Updated ${when(j.updatedAt)}${j.updatedBy ? ' by ' + j.updatedBy : ''}`))))) :
        h('div', { class: 'empty' }, 'No jobs yet. Tap “New job” and upload a drawing.'),
      h('div', { class: 'footer-actions' },
        h('span', { class: 'muted small' }, `Signed in as ${app.me?.name || app.me?.username || ''} (${app.me?.role || ''})`),
        h('button', { class: 'linkbtn', onclick: logout }, 'Sign out'))));
}

// ---------------- New job ----------------
export function newJobScreen() {
  const name = h('input', { type: 'text', required: true, placeholder: 'e.g. Smith — backyard garden' });
  const customer = h('input', { type: 'text', placeholder: 'Customer name' });
  const address = h('input', { type: 'text', placeholder: 'Street, city' });
  const err = h('div', { class: 'formerr', role: 'alert' });
  const btn = h('button', { class: 'btn primary block big', type: 'submit' }, 'Create job & add drawing');
  return h('div', null, topBar('New job', { back: '#/jobs' }),
    h('main', { class: 'page' }, h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      try {
        const r = await api.post('/api/jobs', { name: name.value.trim(), customer: customer.value.trim(), address: address.value.trim() });
        const id = r.id || r.job?.id;
        go(`#/job/${encodeURIComponent(id)}/upload`);
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } }, field('Job name', name), field('Customer', customer), field('Address', address), err, btn)));
}

// ---------------- Upload + analyze ----------------
export async function uploadScreen(jobId) {
  const { job } = await api.get(`/api/jobs/${encodeURIComponent(jobId)}`);
  const status = h('div', { class: 'progress-wrap', role: 'status', 'aria-live': 'polite' });
  const bar = h('progress', { max: 1, value: 0, hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'visually-hidden', id: 'file-any' });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: 'file-cam' });
  const kind = h('select', null, h('option', { value: 'drawing' }, 'Drawing / plan'), h('option', { value: 'proposal' }, 'Signed proposal'), h('option', { value: 'other' }, 'Other'));
  const actions = h('div', { class: 'stack' });
  let uploaded = null;

  function setStatus(text, cls = '') { status.className = `progress-wrap ${cls}`; status.textContent = text; }

  async function doUpload(file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { setStatus('That file is over 40 MB. Export the PDF at a lower resolution or take a photo instead.', 'error'); return; }
    bar.hidden = false; bar.value = 0; setStatus(`Uploading ${file.name}…`);
    try {
      uploaded = await api.upload(`/api/jobs/${encodeURIComponent(jobId)}/files?kind=${kind.value}`, file, p => { bar.value = p; setStatus(`Uploading ${file.name}… ${Math.round(p * 100)}%`); });
      bar.value = 1;
      setStatus(`Uploaded ${file.name}${uploaded.pages ? ` — ${uploaded.pages} page${uploaded.pages > 1 ? 's' : ''}` : ''}.`, 'ok');
      mount(actions, h('button', { class: 'btn primary block big', onclick: analyze }, 'Analyze drawing'),
        h('a', { class: 'btn block', href: `#/job/${encodeURIComponent(jobId)}/summary` }, 'Skip — enter details by hand'));
    } catch (e) { setStatus(e.message, 'error'); bar.hidden = true; }
  }
  async function analyze() {
    mount(actions);
    bar.hidden = false; bar.value = 0; setStatus('Starting analysis…');
    let ext;
    try { ext = await api.post(`/api/jobs/${encodeURIComponent(jobId)}/analyze`, { fileId: uploaded.fileId }); }
    catch (e) { return analysisFailed(e.message); }
    const eid = ext.extractionId;
    const STAGES = { queued: 'Waiting to start', rendering: 'Reading pages', reading: 'Reading pages', extracting: 'Reading dimensions & notes', analyzing: 'Reading dimensions & notes', normalizing: 'Checking geometry', validating: 'Checking geometry' };
    const started = Date.now();
    const poll = async () => {
      if (!document.body.contains(status)) return;
      let r;
      try { r = await api.get(`/api/extractions/${encodeURIComponent(eid)}`); }
      catch (e) { if (e.status === 0) { setStatus('Connection dropped — still waiting for analysis…', 'warn'); return setTimeout(poll, 4000); } return analysisFailed(e.message); }
      if (r.status === 'done') { bar.value = 1; setStatus('Analysis complete.', 'ok'); return go(`#/job/${encodeURIComponent(jobId)}/review/${encodeURIComponent(eid)}`); }
      if (r.status === 'error') return analysisFailed(r.error || 'The analysis failed.');
      if (typeof r.progress === 'number') bar.value = Math.max(0, Math.min(1, r.progress));
      const secs = Math.round((Date.now() - started) / 1000);
      setStatus(`${STAGES[r.stage] || r.stage || 'Working'}… (${secs}s)`);
      setTimeout(poll, 1500);
    };
    poll();
  }
  function analysisFailed(msg) {
    bar.hidden = true; setStatus(msg, 'error');
    mount(actions,
      h('button', { class: 'btn primary block', onclick: analyze }, 'Try analysis again'),
      h('a', { class: 'btn block', href: `#/job/${encodeURIComponent(jobId)}/summary` }, 'Continue without analysis'));
  }
  fileInput.addEventListener('change', () => doUpload(fileInput.files[0]));
  camInput.addEventListener('change', () => doUpload(camInput.files[0]));

  return h('div', null, topBar('Add drawing', { back: `#/job/${encodeURIComponent(jobId)}/summary` }),
    h('main', { class: 'page' },
      h('div', { class: 'card' },
        h('h2', null, job.name),
        h('p', { class: 'hint' }, 'PDF (any number of pages, any rotation), PNG or JPEG. Measurements legible on the drawing are read for you.'),
        field('This file is a', kind),
        h('div', { class: 'stack' },
          h('label', { for: 'file-cam', class: 'btn primary block big' }, '📷  Take photo of plan'),
          h('label', { for: 'file-any', class: 'btn block big' }, '📄  Choose PDF or image')),
        fileInput, camInput, bar, status, actions)));
}

// ---------------- Review ----------------
function normalizeProposal(p) {
  if (!p) return { items: [], questions: [], notes: [] };
  let items = p.items;
  if (!items) {
    items = [];
    for (const c of p.components || []) items.push({ id: c.id, kind: 'component', component: c, basis: c.provenance?.geometry?.basis || 'drawing', ref: c.provenance?.geometry?.ref });
    for (const s of p.scope || []) items.push({ id: s.id, kind: 'scope', label: s.label || s.text, value: s.value, basis: 'drawing', ref: s.ref });
    for (const n of p.notes || []) if (typeof n === 'object' && n.id) items.push({ id: n.id, kind: 'note', label: n.text || n.label, basis: 'drawing', ref: n.ref });
  }
  return { items, questions: p.questions || [], notes: (p.notes || []).filter(n => typeof n === 'string'), project: p.project || {}, warnings: p.warnings || [] };
}

function geomSummary(g) {
  if (!g) return 'No dimensions found';
  if (g.kind === 'rect') return `${feetIn(g.lengthFt)} × ${feetIn(g.widthFt)}`;
  if (g.kind === 'line') return g.lengthFt != null ? `${feetIn(g.lengthFt)} long` : 'length not found';
  if (g.kind === 'area') return `${num(g.areaSqFt)} sq ft`;
  if (g.kind === 'polygon') return `${g.points.length}-corner outline`;
  return '';
}
const TYPE_LABEL = { bed: 'Bed', trellis: 'Trellis', path: 'Path', patio: 'Patio', stoop: 'Stoop', screen: 'Screen', fence: 'Fence', planting: 'Planting', mulch: 'Mulch', rock: 'Rock', demolition: 'Demolition', edging: 'Edging', drain: 'Drain', irrigation: 'Irrigation', lighting: 'Lighting' };

export async function reviewScreen(jobId, eid) {
  const r = await api.get(`/api/extractions/${encodeURIComponent(eid)}`);
  if (r.status !== 'done') throw new Error(r.status === 'error' ? (r.error || 'Analysis failed') : 'Analysis is still running — go back and wait for it to finish.');
  const prop = normalizeProposal(r.proposal);
  const decisions = new Map(prop.items.map(it => [it.id, it.locked ? 'keep' : 'accept'])); // accept | reject
  const edits = {};
  const planHost = h('div', { class: 'planhost' });
  const comps = () => prop.items.filter(i => i.kind === 'component' && decisions.get(i.id) === 'accept').map(i => applyEdit(i.component, edits[i.id]));
  const redraw = () => mount(planHost, planSvg(comps()));
  redraw();

  function applyEdit(c, e) {
    if (!e) return c;
    const out = structuredClone(c);
    if (e.name) out.name = e.name;
    if (e.geometry) out.geometry = { ...out.geometry, ...e.geometry };
    return out;
  }
  function itemCard(it) {
    const c = it.component;
    const card = h('div', { class: 'card item' });
    const render = () => {
      const d = decisions.get(it.id);
      const cur = c ? applyEdit(c, edits[it.id]) : null;
      mount(card,
        h('div', { class: 'row' },
          h('div', null,
            c ? h('span', { class: 'chip type' }, TYPE_LABEL[c.type] || c.type) : h('span', { class: 'chip type' }, it.kind === 'scope' ? 'Scope' : 'Note'),
            ' ', h('strong', null, cur ? cur.name : it.label)),
          basisBadge(it.basis)),
        c ? h('div', { class: 'muted' }, geomSummary(cur.geometry)) : (it.value !== undefined ? h('div', { class: 'muted' }, String(it.value)) : null),
        it.ref ? h('div', { class: 'small muted' }, `From: “${it.ref}”`) : null,
        it.locked ? h('div', { class: 'small warnline' }, 'You confirmed this earlier — your correction is kept.') : null,
        it.confidence === 'low' ? h('div', { class: 'small warnline' }, 'Hard to read on the drawing — please check.') : null,
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Decision' },
          h('button', { class: d !== 'reject' ? 'on' : '', 'aria-pressed': String(d !== 'reject'), onclick: () => { decisions.set(it.id, it.locked ? 'keep' : 'accept'); render(); redraw(); } }, 'Use'),
          c && !it.locked ? h('button', { onclick: () => editSheet(it, render) }, 'Edit') : null,
          h('button', { class: d === 'reject' ? 'on danger' : '', 'aria-pressed': String(d === 'reject'), onclick: () => { decisions.set(it.id, 'reject'); render(); redraw(); } }, 'Reject')));
    };
    render();
    return card;
  }
  function editSheet(it, done) {
    const c = applyEdit(it.component, edits[it.id]);
    const nameIn = h('input', { type: 'text', value: c.name });
    const g = c.geometry || {};
    const inputs = {};
    const numIn = (v) => h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v ?? '' });
    if (g.kind === 'rect') { inputs.lengthFt = numIn(g.lengthFt); inputs.widthFt = numIn(g.widthFt); }
    else if (g.kind === 'line') inputs.lengthFt = numIn(g.lengthFt);
    else if (g.kind === 'area') inputs.areaSqFt = numIn(g.areaSqFt);
    const LBL = { lengthFt: 'Length (ft)', widthFt: 'Width (ft)', areaSqFt: 'Area (sq ft)' };
    const dlg = h('dialog', { class: 'sheet' },
      h('h2', null, 'Correct this item'),
      field('Name', nameIn),
      Object.entries(inputs).map(([k, el]) => field(LBL[k], el)),
      g.kind === 'polygon' ? h('p', { class: 'hint' }, 'Outline shapes are edited after applying (Summary → bed → dimensions).') : null,
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => {
          const ge = {}; for (const [k, el] of Object.entries(inputs)) ge[k] = el.value === '' ? null : Number(el.value);
          edits[it.id] = { name: nameIn.value.trim() || c.name, ...(Object.keys(ge).length ? { geometry: ge } : {}) };
          dlg.close(); done(); redraw();
        } }, 'Save correction'),
        h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
    document.body.appendChild(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal();
  }

  const applyBtn = h('button', { class: 'btn primary block big', onclick: async () => {
    applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
    try {
      const accept = [...decisions].filter(([, d]) => d !== 'reject').map(([id]) => id);
      await api.post(`/api/jobs/${encodeURIComponent(jobId)}/extractions/${encodeURIComponent(eid)}/apply`, { accept, edits });
      toast('Drawing applied. Confirmed corrections were kept.');
      go(`#/job/${encodeURIComponent(jobId)}/summary`);
    } catch (e) { toast(e.message, 'error'); applyBtn.disabled = false; applyBtn.textContent = 'Apply to job'; }
  } }, 'Apply to job');

  const groups = {};
  for (const it of prop.items) { const t = it.component ? (TYPE_LABEL[it.component.type] || it.component.type) : (it.kind === 'scope' ? 'Scope' : 'Notes'); (groups[t] ||= []).push(it); }

  return h('div', null, topBar('Review drawing', { back: `#/job/${encodeURIComponent(jobId)}/summary` }),
    h('main', { class: 'page' },
      h('div', { class: 'card' },
        h('h2', null, prop.project.name || 'What we read'),
        prop.project.revision ? h('div', { class: 'muted' }, `Revision: ${prop.project.revision}`) : null,
        planHost,
        h('p', { class: 'hint' }, `${prop.items.length} items found. Tap Reject on anything wrong, Edit to correct a number.`)),
      prop.warnings.length ? h('div', { class: 'card warn' }, prop.warnings.map(w => h('p', null, w))) : null,
      Object.entries(groups).map(([t, its]) => h('section', null, h('h3', { class: 'sechead' }, t), its.map(itemCard))),
      prop.questions.length ? h('section', null, h('h3', { class: 'sechead' }, 'Needs your answer later'),
        h('div', { class: 'card' }, h('ul', { class: 'qlist' }, prop.questions.map(q => h('li', null, h('span', { class: 'chip qtype' }, QTYPE[q.type] || q.type), ' ', q.text))))) : null,
      h('div', { class: 'sticky-actions' }, applyBtn)));
}

export { toPoints };
