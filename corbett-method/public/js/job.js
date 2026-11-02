// Job screen: tabs Summary · Questions · Shop · Cuts · Costs · Build · More
import { h, mount, clear, toast, field, money, num, qtyUnit, unitLabel, inches, feetIn, lumberLabel, when,
         basisBadge, statusChip, QTYPE, BASIS } from './h.js';
import * as api from './api.js';
import { store, subscribe, loadJob, edit, refreshEstimate, setScenario } from './store.js';
import { app, topBar, canEdit, go } from './app.js';
import { planSvg, boardBar } from './plan.js';

const TABS = [
  ['summary', 'Plan', '▦'], ['questions', 'Ask', '?'], ['shop', 'Shop', '🛒'], ['cuts', 'Cuts', '✂'],
  ['costs', 'Costs', '$'], ['build', 'Build', '🔨'], ['more', 'More', '⋯'],
];
const enc = encodeURIComponent;
let unsub = null;

export async function jobScreen(id, tab) {
  if (store.jobId !== id || !store.job) await loadJob(id);
  else if (!store.estimate && !store.estimateLoading) refreshEstimate(true);
  if (!TABS.some(t => t[0] === tab)) tab = 'summary';
  const content = h('main', { class: 'page tabpage', id: 'tabcontent' });
  const openQ = () => openQuestions().length;
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Job sections' });
  const drawNav = () => mount(nav, TABS.map(([k, label, icon]) => h('a', { href: `#/job/${enc(id)}/${k}`, class: k === tab ? 'on' : '', 'aria-current': k === tab ? 'page' : null },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, icon), h('span', null, label),
    k === 'questions' && openQ() ? h('span', { class: 'dot', 'aria-label': `${openQ()} open` }, String(openQ())) : null)));
  drawNav();

  let deferred = false;
  const render = () => {
    const ae = document.activeElement;
    if (ae && content.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox') {
      if (!deferred) { deferred = true; ae.addEventListener('blur', () => { deferred = false; setTimeout(render, 50); }, { once: true }); }
      return;
    }
    const y = window.scrollY;
    mount(content, TAB_RENDER[tab](id));
    window.scrollTo(0, y);
  };
  unsub?.();
  unsub = subscribe(w => {
    if (!document.body.contains(content)) { unsub?.(); unsub = null; return; }
    if (w === 'estimate' || w === 'job' || w === 'scenario') { drawNav(); render(); }
    if (w === 'estimate-loading') { const el = document.getElementById('estbusy'); if (el) el.hidden = false; }
  });
  mount(content, TAB_RENDER[tab](id));
  return h('div', { class: 'jobshell' }, topBar(store.job.name, { back: '#/jobs', showSave: true }), content, nav);
}

// ---------- helpers ----------
const est = () => store.estimate;
const rowKey = (r) => r.rowId || r.productKey;
/** Open questions: engine's unresolved list + questions recorded from drawing analysis (not yet answered). */
function openQuestions() {
  const answers = store.job?.answers || {};
  const seen = new Set(); const out = [];
  for (const q of [...(store.estimate?.unresolved || []), ...(store.job?.drawingQuestions || [])]) {
    if (!q || seen.has(q.id) || answers[q.id] || q.status === 'answered') continue;
    seen.add(q.id); out.push(q);
  }
  return out;
}
function estimateGate(fn) {
  if (store.estimateError) return h('div', { class: 'card error' }, h('strong', null, 'Could not calculate this job. '), store.estimateError,
    h('div', null, h('button', { class: 'btn', onclick: () => refreshEstimate(true) }, 'Retry')));
  if (!est()) return h('div', { class: 'card loading', role: 'status' }, 'Calculating…');
  return fn(est());
}
function busy() { return h('div', { id: 'estbusy', class: 'busy', hidden: !store.estimateLoading, role: 'status' }, 'Updating…'); }
function sheet(title, body, actions) {
  const dlg = h('dialog', { class: 'sheet', 'aria-label': title }, h('h2', null, title), body,
    h('div', { class: 'stack' }, ...actions(() => dlg.close()), h('button', { class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
  document.body.appendChild(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal();
  return dlg;
}
function guardEdit(fn) { if (!canEdit()) { toast('View-only access.', 'error'); return; } fn(); }
const by = () => app.me?.name || app.me?.username || 'unknown';
const compName = (cid) => (store.job.components || []).find(c => c.id === cid)?.name || cid || '';
function productLabel(row) {
  const ll = lumberLabel(row.productKey);
  return row.name || ll || row.productKey;
}
function qtyText(row, qty = row.totalQty) {
  const ll = lumberLabel(row.productKey);
  if (ll) return `${num(qty)} × ${ll}`;
  return qtyUnit(qty, row.unit);
}
function dollarsIn(cents) { return h('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: cents == null ? '' : (cents / 100).toFixed(2) }); }
const toCents = (v) => v === '' || v == null ? null : Math.round(Number(v) * 100);
const toNum = (v) => v === '' || v == null ? null : Number(v);

// ================= SUMMARY =================
function geomText(g) {
  if (!g) return 'Not dimensioned';
  if (g.kind === 'rect') return `${feetIn(g.lengthFt)} × ${feetIn(g.widthFt)}`;
  if (g.kind === 'line') return g.lengthFt != null ? `${feetIn(g.lengthFt)}` : 'Length not dimensioned';
  if (g.kind === 'area') return g.areaSqFt != null ? `${num(g.areaSqFt)} sq ft` : 'Area not dimensioned';
  if (g.kind === 'polygon') return `${g.points.length}-corner outline`;
  return '';
}
function summaryTab(id) {
  const job = store.job;
  const e = est();
  const beds = job.components.filter(c => c.type === 'bed' && !c.excluded);
  const trellises = job.components.filter(c => c.type === 'trellis' && !c.excluded);
  const m = e?.metrics || {};
  const sum = (k) => beds.reduce((a, b) => a + (m[b.id]?.[k] ?? 0), 0);
  const unpriced = (e?.shopping || []).filter(r => r.unitPriceCents == null).length;
  const openQ = openQuestions().length;
  const scen = job.scenarios || [];
  const scenSel = scen.length ? h('select', { onchange: (ev) => setScenario(ev.target.value || null) },
    scen.map(s => h('option', { value: s.id, selected: s.id === store.scenarioId }, `${s.name}${s.selected ? ' ✓' : ''}`))) : null;
  const scope = job.scope || {};
  return h('div', null, busy(),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', null, job.customer || job.name), h('span', { class: 'muted small' }, `rev ${store.version ?? ''}`)),
      job.address ? h('div', { class: 'muted' }, job.address) : null,
      h('div', { class: 'planhost' }, planSvg(job.components)),
      h('div', { class: 'chips' },
        h('span', { class: `chip ${scope.irrigation ? '' : 'excl'}` }, scope.irrigation ? 'Irrigation included' : 'No irrigation'),
        h('span', { class: `chip ${scope.lighting ? '' : 'excl'}` }, scope.lighting ? 'Lighting included' : 'No lighting'),
        scope.liner ? h('span', { class: 'chip' }, 'Liner + trim') : null)),
    scenSel ? h('div', { class: 'card' }, field('Showing scenario', scenSel,
      store.scenarioId && !scen.find(s => s.id === store.scenarioId)?.selected ? 'Alternative — not the selected scenario. Purchases follow the selected one.' : 'This is the selected scenario.')) : null,
    h('div', { class: 'stats' },
      stat('Beds', `${beds.length}`, `${num(sum('outsideAreaSqFt'), 1)} sq ft outside`),
      stat('Soil area', `${num(sum('insideAreaSqFt'), 1)}`, 'sq ft inside walls'),
      stat('Trellises', `${trellises.length}`, `${trellises.reduce((a, t) => a + (t.props?.posts || 0), 0)} posts`),
      stat('Materials', e ? money(e.costs?.materialsKnownCents ?? null) : '…', e ? (unpriced ? `${unpriced} item${unpriced > 1 ? 's' : ''} unpriced` : 'all priced') : ''),
    ),
    openQ ? h('a', { class: 'card callout', href: `#/job/${enc(id)}/questions` },
      h('strong', null, `${openQ} open question${openQ > 1 ? 's' : ''}`), h('div', { class: 'muted' }, 'The estimate is not complete until these are answered. Tap to review.')) : null,
    (e?.reconciliations || []).length ? h('div', { class: 'card' }, h('h3', null, 'Proposal vs. calculated'),
      h('p', { class: 'hint' }, 'Confirmed proposal quantities are what we buy. The geometric calculation is shown only for comparison.'),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', null, 'Proposal'), h('th', null, 'Calculated'))),
        h('tbody', null, e.reconciliations.map(r => h('tr', null, h('td', null, r.label, r.note ? h('div', { class: 'small muted' }, r.note) : null),
          h('td', null, r.confirmedQty == null ? '—' : qtyUnit(r.confirmedQty, r.unit)), h('td', null, r.calculatedQty == null ? 'unknown' : qtyUnit(r.calculatedQty, r.unit))))))) : null,
    h('h3', { class: 'sechead' }, 'Components'),
    job.components.map(c => componentCard(c)),
    canEdit() ? h('button', { class: 'btn block', onclick: () => addComponentSheet() }, '+ Add component by hand') : null,
    h('a', { class: 'btn block', href: `#/job/${enc(id)}/upload` }, 'Upload new drawing / revision'));
}
function stat(label, big, small) { return h('div', { class: 'stat' }, h('div', { class: 'stat-l' }, label), h('div', { class: 'stat-b' }, big), h('div', { class: 'stat-s' }, small)); }

function componentCard(c) {
  const m = est()?.metrics?.[c.id] || {};
  const prov = c.provenance?.geometry;
  const locked = (store.job.corrections || []).some(x => x.componentId === c.id);
  return h('div', { class: `card comp ${c.excluded ? 'dim' : ''}`, tabindex: 0, role: 'button', 'aria-label': `Edit ${c.name}`,
    onclick: () => guardEdit(() => editComponentSheet(c)), onkeydown: (ev) => { if (ev.key === 'Enter') guardEdit(() => editComponentSheet(c)); } },
    h('div', { class: 'row' }, h('strong', null, c.name), h('span', null, prov ? basisBadge(prov.basis) : null, locked ? h('span', { class: 'badge basis-manual' }, 'Corrected') : null)),
    h('div', { class: 'muted' }, `${c.type} · ${geomText(c.geometry)}${m.outsideAreaSqFt != null ? ` · ${num(m.outsideAreaSqFt, 1)} sq ft` : ''}${m.perimeterFt != null ? ` · ${num(m.perimeterFt, 1)} ft walls` : ''}`),
    c.excluded ? h('div', { class: 'small warnline' }, 'Excluded from this estimate') : null,
    c.notes ? h('div', { class: 'small muted' }, c.notes) : null);
}
function editComponentSheet(c) {
  const g = c.geometry || {};
  const name = h('input', { type: 'text', value: c.name });
  const notes = h('textarea', { rows: 2 }, c.notes || '');
  const excluded = h('input', { type: 'checkbox', checked: !!c.excluded });
  const inputs = {};
  const n = (v) => h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v ?? '' });
  if (g.kind === 'rect') { inputs.lengthFt = n(g.lengthFt); inputs.widthFt = n(g.widthFt); }
  else if (g.kind === 'line') inputs.lengthFt = n(g.lengthFt);
  else if (g.kind === 'area' || !c.geometry) inputs.areaSqFt = n(g.areaSqFt);
  let pts = null;
  if (g.kind === 'polygon') pts = g.points.map(p => [n(p[0]), n(p[1])]);
  const LBL = { lengthFt: 'Length (ft)', widthFt: 'Width (ft)', areaSqFt: 'Area (sq ft)' };
  const body = h('div', null,
    field('Name', name),
    Object.entries(inputs).map(([k, el]) => field(LBL[k], el)),
    pts ? h('div', { class: 'field' }, h('label', null, 'Outline corners (ft, outside face)'),
      h('div', { class: 'ptgrid' }, pts.map((p, i) => h('div', { class: 'ptrow' }, h('span', { class: 'muted small' }, `${i + 1}`), p[0], p[1])))) : null,
    h('label', { class: 'check' }, excluded, ' Exclude from estimate'),
    field('Notes', notes),
    h('p', { class: 'hint' }, 'Saved changes are recorded as manual corrections and are kept when the drawing is re-analyzed.'));
  sheet(`Edit ${c.name}`, body, (close) => [h('button', { class: 'btn primary', onclick: () => {
    const before = JSON.stringify(c.geometry);
    edit(job => {
      const t = job.components.find(x => x.id === c.id); if (!t) return;
      t.name = name.value.trim() || t.name; t.notes = notes.value; t.excluded = excluded.checked;
      if (Object.keys(inputs).length) {
        const kind = t.geometry?.kind || 'area';
        t.geometry = { ...(t.geometry || { kind }) };
        for (const [k, el] of Object.entries(inputs)) t.geometry[k] = toNum(el.value);
      }
      if (pts) t.geometry = { kind: 'polygon', points: pts.map(([a, b]) => [Number(a.value), Number(b.value)]) };
      if (JSON.stringify(t.geometry) !== before) {
        t.provenance = { ...(t.provenance || {}), geometry: { basis: 'manual', ref: `Corrected by ${by()}`, confirmed: true } };
        job.corrections = job.corrections || [];
        job.corrections.push({ id: 'cor-' + Date.now().toString(36), componentId: t.id, path: 'geometry', value: t.geometry, by: by(), at: new Date().toISOString(), note: '', locked: true });
      }
    });
    close();
  } }, 'Save')]);
}
function addComponentSheet() {
  const TYPES = ['bed', 'trellis', 'path', 'patio', 'stoop', 'screen', 'fence', 'planting', 'mulch', 'rock', 'demolition', 'edging', 'drain', 'irrigation', 'lighting'];
  const type = h('select', null, TYPES.map(t => h('option', { value: t }, t)));
  const name = h('input', { type: 'text' });
  const L = h('input', { type: 'number', inputmode: 'decimal', step: 'any' });
  const W = h('input', { type: 'number', inputmode: 'decimal', step: 'any' });
  sheet('Add component', h('div', null, field('Type', type), field('Name', name), field('Length (ft)', L), field('Width (ft) — blank for a line', W)),
    (close) => [h('button', { class: 'btn primary', onclick: () => {
      const lf = toNum(L.value), wf = toNum(W.value);
      const geometry = lf == null ? null : wf == null ? { kind: 'line', lengthFt: lf } : { kind: 'rect', lengthFt: lf, widthFt: wf };
      edit(job => { job.components.push({ id: `${type.value}-${Date.now().toString(36)}`, type: type.value, name: name.value.trim() || type.value, scenarioId: null, excluded: false,
        geometry, props: type.value === 'bed' ? { courses: 5, heightIn: 27.5, liner: true, trim: true } : {},
        provenance: geometry ? { geometry: { basis: 'manual', ref: `Entered by ${by()}`, confirmed: true } } : {}, notes: '' }); });
      close();
    } }, 'Add')]);
}

// ================= QUESTIONS =================
const ANSWER_OPTIONS = {
  'q.corner-rule': [['butt', 'Butt joints (one wall runs through)'], ['interlaced', 'Interlaced — alternate each course'], ['nominal', 'Keep nominal (no deduction)']],
  'q.interlace-start': [['long', 'Long walls run through on the bottom course'], ['short', 'Short walls run through on the bottom course']],
  'q.slat-spacing': [['on-center', '12" on-center'], ['clear', '12" clear gap']],
  'q.compost-area': [['inside', 'Inside soil area'], ['outside', 'Outside footprint']],
};
function questionsTab(id) {
  return h('div', null, busy(), estimateGate(e => {
    const qs = openQuestions();
    const groups = {};
    for (const q of qs) (groups[QTYPE[q.type] ? q.type : 'construction_detail'] ||= []).push(q);
    const answered = Object.entries(store.job.answers || {});
    return h('div', null,
      qs.length ? h('p', { class: 'hint' }, 'Only things the drawing and standards cannot settle. Each answer is saved to this job and kept on re-analysis.')
        : h('div', { class: 'card ok' }, 'Nothing to answer. Every size was read or measured from the drawing, and your standards cover the rest.'),
      (e.assumptions || []).length ? h('section', null,
        h('h3', { class: 'sechead' }, `Standards used (${e.assumptions.length})`),
        h('p', { class: 'hint' }, 'Applied automatically. Change one only if this job is built differently.'),
        h('ul', { class: 'card assumptions' }, e.assumptions.map(a => h('li', null, a.text)))) : null,
      (e.priceGaps || []).length ? h('p', { class: 'hint' }, `${e.priceGaps.length} items have no supplier price yet — they show as "price unknown" on the Shop tab. Import a price sheet under More → Price catalog.`) : null,
      Object.keys(QTYPE).filter(t => groups[t]).map(t => h('section', null,
        h('h3', { class: 'sechead' }, `${QTYPE[t]} (${groups[t].length})`),
        collapseFamilies(groups[t]).map(g => g.items ? h('details', { class: 'card qfamily' },
          h('summary', null, h('strong', null, g.title), h('span', { class: 'muted' }, ` (${g.items.length})`)),
          g.items.map(q => questionCard(q, id))) : questionCard(g, id)))),
      answered.length ? h('section', null, h('h3', { class: 'sechead' }, 'Answered'),
        answered.map(([qid, a]) => h('div', { class: 'card small' },
          h('div', { class: 'row' }, h('span', null, h('strong', null, String(a.value)), a.note ? ` — ${a.note}` : ''),
            canEdit() ? h('button', { class: 'linkbtn', onclick: () => edit(job => { delete job.answers[qid]; }) }, 'Reopen') : null),
          h('div', { class: 'muted' }, `${qid} · ${a.by || ''} ${when(a.at)}`)))) : null);
  }));
}
// Families of near-identical questions (one per product / per bed) collapse into one heading.
const FAMILY_TITLES = { 'q.price': 'Supplier prices needed', 'q.pkg': 'Package sizes needed', 'q.package': 'Products to choose',
  'q.support-layout': 'Bed support layouts to confirm', 'q.path-outline': 'Path outlines to dimension' };
function collapseFamilies(qs) {
  const fam = (q) => q.id.replace(/-L$/, '').split(':')[0];
  const byFam = new Map();
  for (const q of qs) { const f = fam(q); if (!byFam.has(f)) byFam.set(f, []); byFam.get(f).push(q); }
  const out = [];
  for (const [f, items] of byFam) {
    if (items.length >= 3) out.push({ title: FAMILY_TITLES[f] || items[0].text.split(':')[0], items });
    else out.push(...items);
  }
  return out;
}
function questionCard(q, id) {
  const opts = ANSWER_OPTIONS[q.id];
  const input = opts ? h('select', null, h('option', { value: '' }, 'Choose…'), opts.map(([v, l]) => h('option', { value: v }, l)))
                     : h('input', { type: 'text', inputmode: /length|lap|spacing|depth|thickness|trim|in$/i.test(q.id) ? 'decimal' : 'text', placeholder: 'Answer' });
  const note = h('input', { type: 'text', placeholder: 'Note (optional)' });
  return h('div', { class: 'card q' },
    h('div', { class: 'qtext' }, q.text),
    q.provisional ? h('div', { class: 'small muted' }, `Meanwhile: ${q.provisional}`) : null,
    q.extractionId ? h('div', { class: 'small muted' }, 'Raised while reading the drawing') : null,
    (q.componentIds || []).length ? h('div', { class: 'small muted' }, `Affects: ${q.componentIds.map(compName).join(', ')}`) : null,
    q.type === 'missing_price' ? h('div', { class: 'stack' },
      canEdit() ? h('button', { class: 'btn', onclick: () => catalogEntrySheet({ productKey: (q.productKeys || [])[0] || '' }, () => refreshEstimate(true)) }, 'Add supplier price') : null)
    : canEdit() ? h('details', { class: 'answerwrap' }, h('summary', { class: 'linkbtn' }, 'Answer'), h('div', { class: 'answer' }, input, note, h('button', { class: 'btn primary', onclick: () => {
        let v = input.value.trim(); if (!v) { toast('Enter an answer first.'); return; }
        const asNum = Number(v); const value = v !== '' && !Number.isNaN(asNum) && /^[\d.\s]+$/.test(v) ? asNum : v;
        edit(job => { job.answers = job.answers || {}; job.answers[q.id] = { value, note: note.value.trim(), by: by(), at: new Date().toISOString() }; }, { immediate: true });
        toast('Answer saved — recalculating.');
      } }, 'Save'))) : null);
}

// ================= SHOP =================
function shopTab(id) {
  return h('div', null, busy(), estimateGate(e => {
    const rows = e.shopping || [];
    const ready = rows.filter(r => r.status !== 'unresolved');
    const unresolved = rows.filter(r => r.status === 'unresolved');
    const known = rows.reduce((a, r) => a + (r.extendedCents ?? 0), 0);
    const unpriced = rows.filter(r => r.unitPriceCents == null).length;
    const qmap = Object.fromEntries(openQuestions().map(q => [q.id, q]));
    const cats = {};
    for (const r of ready) (cats[r.category || 'other'] ||= []).push(r);
    return h('div', null,
      h('div', { class: 'card totals' },
        h('div', { class: 'row' }, h('span', null, 'Known materials subtotal'), h('strong', { class: 'big' }, money(known))),
        unpriced ? h('div', { class: 'warnline' }, `${unpriced} item${unpriced > 1 ? 's have' : ' has'} no supplier price yet — total is incomplete.`) : h('div', { class: 'okline' }, 'Every item is priced.'),
        h('div', { class: 'small muted' }, 'Prices are from saved price sheets (dated). They are not live quotes.'),
        h('div', { class: 'row gap' }, h('a', { class: 'btn', href: `/api/jobs/${enc(id)}/export/shopping.csv${store.scenarioId ? '?scenario=' + enc(store.scenarioId) : ''}` }, 'Download CSV'),
          h('a', { class: 'btn', href: `/api/jobs/${enc(id)}/export/jobpack.html${store.scenarioId ? '?scenario=' + enc(store.scenarioId) : ''}`, target: '_blank', rel: 'noopener' }, api.isCloud ? 'Save job pack' : 'Print job pack'))),
      Object.entries(cats).map(([cat, rs]) => h('section', null, h('h3', { class: 'sechead' }, cat), rs.map(r => shopCard(r, e, qmap)))),
      unresolved.length ? h('section', null, h('h3', { class: 'sechead warnhead' }, `Not ready to buy (${unresolved.length})`),
        h('p', { class: 'hint' }, 'These depend on an open question. They are not counted as complete.'),
        unresolved.map(r => shopCard(r, e, qmap))) : null);
  }));
}
function shopCard(r, e, qmap) {
  // Compact one-line row: product · qty · extended. Everything else is one tap away.
  const audit = (e.audit || []).find(a => (a.rowId || a.productKey) === rowKey(r));
  const pkg = r.packageSize && r.packageSize !== 1 ? ` (${num(r.packageSize)} ${unitLabel(r.packageUnit, r.packageSize)} each)` : '';
  const chip = r.provisionalOnly ? h('span', { class: 'chip st-provisional' }, 'Provisional') : (r.status === 'ok' ? null : statusChip(r.status));
  return h('details', { class: `shoprow st-${r.status}`, 'data-row': rowKey(r) },
    h('summary', null,
      h('span', { class: 'sr-name' }, productLabel(r), chip ? ' ' : null, chip),
      h('span', { class: 'sr-qty' }, r.totalQty == null ? '—' : qtyText(r)),
      h('span', { class: 'sr-ext' }, r.extendedCents == null ? h('span', { class: 'unknown' }, '?') : money(r.extendedCents))),
    h('div', { class: 'sr-body' },
      r.provisionalOnly ? h('div', { class: 'small muted' }, 'Separate from the confirmed boards — buy only once the question is answered.') : null,
      h('div', { class: 'small' }, r.allowanceQty ? `Base ${qtyText(r, r.baseQty)} + ${num(r.allowanceQty)} extra allowance` : `Base ${r.baseQty == null ? 'unknown' : qtyText(r, r.baseQty)} · no extra allowance`, pkg),
      h('div', { class: 'small' }, r.unitPriceCents == null ? h('span', { class: 'unknown' }, 'Price unknown — not counted as $0') : `${money(r.unitPriceCents)} / ${unitLabel(r.packageUnit || r.unit, 1)}`,
        r.supplier ? h('span', { class: 'muted' }, ` · ${r.supplier}${r.priceDate ? `, price sheet ${r.priceDate}` : ''}`) : null),
      (r.notes || []).map(n => h('div', { class: 'small muted' }, n)),
      (r.issues || []).map(qid => h('div', { class: 'small warnline' }, qmap[qid]?.text || qid)),
      audit ? h('div', { class: 'why' }, h('div', { class: 'small' }, h('strong', null, 'Why this quantity')),
        h('ul', null, (audit.from || []).map(f => h('li', null,
          f.componentId ? h('strong', null, compName(f.componentId) + ': ') : null,
          f.formula || f.ref || (f.cuts ? f.cuts.map(c => `${num(c.lengthIn)}" ${c.label}`).join(' + ') : ''), ' ', f.basis ? basisBadge(f.basis) : null,
          f.boardId ? h('span', { class: 'muted' }, ` [${f.boardId}]`) : null)))) : null));
}

// ================= CUTS =================
let cutMode = 'reviewed';
function cutsTab(id) {
  return h('div', null, busy(), estimateGate(e => {
    const plans = Object.entries(e.cutPlans || {});
    if (!plans.length) return h('div', { class: 'empty' }, 'No lumber pieces yet.');
    const toggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'Plan type' },
      h('button', { class: cutMode === 'reviewed' ? 'on' : '', 'aria-pressed': String(cutMode === 'reviewed'), onclick: () => { cutMode = 'reviewed'; mount(document.getElementById('tabcontent'), cutsTab(id)); } }, 'Cutting plan (with saw kerf)'),
      h('button', { class: cutMode === 'nominal' ? 'on' : '', 'aria-pressed': String(cutMode === 'nominal'), onclick: () => { cutMode = 'nominal'; mount(document.getElementById('tabcontent'), cutsTab(id)); } }, 'Nominal order'));
    return h('div', null, toggle,
      cutMode === 'nominal' ? h('div', { class: 'card warn small' }, 'Nominal: outside dimensions and no saw kerf. For comparing orders only — do not cut from this.') : null,
      h('div', { class: 'row gap' }, h('a', { class: 'btn', href: `/api/jobs/${enc(id)}/export/cutlist.csv${store.scenarioId ? '?scenario=' + enc(store.scenarioId) : ''}` }, 'Download cut list')),
      plans.map(([gk, p]) => cutGroup(gk, p[cutMode] || p.reviewed)));
  }));
}
function groupLabel(gk) { const m = /^lumber:([^:]+):(.+)$/.exec(gk); if (!m) return gk; const L = { cedartone: 'CedarTone', pt: 'Pressure-treated', 'smooth-cedar': 'Smooth cedar', 'rough-cedar': 'Rough-sawn cedar' }; return `${L[m[1]] || m[1]} ${m[2].replace('x', '×')}`; }
function cutGroup(gk, plan) {
  if (!plan) return null;
  const st = plan.stats || {};
  const wastePct = st.purchasedIn ? 100 * (1 - st.requiredIn / st.purchasedIn) : null;
  const counts = {};
  for (const b of plan.boards || []) counts[b.stockLengthFt] = (counts[b.stockLengthFt] || 0) + 1;
  return h('details', { class: 'card cutgroup', open: true },
    h('summary', null, h('span', { class: 'row' }, h('strong', null, groupLabel(gk)),
      h('span', { class: `badge ${plan.proof === 'optimal' ? 'proof-opt' : 'proof-best'}` }, plan.proof === 'optimal' ? 'Proven minimum' : 'Best plan found'))),
    h('div', { class: 'small' }, Object.entries(counts).sort((a, b) => b[0] - a[0]).map(([ft, n]) => `${n} × ${ft}'`).join(' + ') || 'No boards',
      st.purchasedIn ? ` · ${num(st.purchasedIn / 12, 1)} ft bought for ${num(st.requiredIn / 12, 1)} ft of pieces${wastePct != null ? ` (${num(wastePct, 0)}% offcut/waste)` : ''}` : ''),
    h('div', { class: 'small muted' }, `Saw kerf ${inches(plan.kerfIn)}${plan.endTrimIn ? ` · end trim ${inches(plan.endTrimIn)}` : ''}`),
    (plan.conflicts || []).map(c => h('div', { class: 'card warn small' }, h('strong', null, 'Fit conflict: '), c.text, c.suggestion ? h('div', null, `Option: ${c.suggestion}`) : null)),
    (plan.infeasible || []).map(c => h('div', { class: 'card error small' }, h('strong', null, `${c.label}: `), c.reason)),
    (plan.boards || []).map(b => h('div', { class: 'board' },
      h('div', { class: 'row' }, h('strong', null, b.id), h('span', null, `${groupLabel(gk)} × ${b.stockLengthFt}'`, b.specialOrder ? h('span', { class: 'chip so' }, 'Special order') : null)),
      b.reason ? h('div', { class: 'small muted' }, b.reason) : null,
      boardBar(b),
      h('ol', { class: 'cuts' }, b.cuts.map(c => h('li', null, h('strong', null, inches(c.lengthIn)), ' ', c.label))),
      h('div', { class: 'small muted' }, `Saw loss ${inches(b.sawLossIn)} · usable offcut ${inches(b.usableOffcutIn)} · waste ${inches(b.wasteIn)}`),
      (b.notes || []).map(n => h('div', { class: 'small warnline' }, n)))));
}

// ================= COSTS =================
function costsTab(id) {
  const ci = store.job.costInputs || {};
  const setCI = (k, v) => edit(job => { job.costInputs = job.costInputs || {}; job.costInputs[k] = v; });
  const pct = (k) => { const el = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: ci[k] ?? '' }); el.addEventListener('change', () => setCI(k, toNum(el.value))); return el; };
  const dol = (k) => { const el = dollarsIn(ci[k]); el.addEventListener('change', () => setCI(k, toCents(el.value))); return el; };
  const hrs = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: ci.laborHours ?? '' }); hrs.addEventListener('change', () => setCI('laborHours', toNum(hrs.value)));
  if (!canEdit()) for (const el of [hrs]) el.disabled = true;
  const sel = store.job.selling;
  const actualSpend = [...(store.job.actuals?.purchases || []), ...(store.job.actuals?.costs || [])].reduce((a, p) => a + (p.totalCents || 0), 0);
  return h('div', null, busy(),
    estimateGate(e => {
      const c = e.costs || {};
      const line = (l, v, note) => h('tr', null, h('td', null, l, note ? h('div', { class: 'small muted' }, note) : null), h('td', { class: 'num' }, v === null || v === undefined ? h('span', { class: 'unknown' }, 'unknown') : money(v)));
      return h('div', { class: 'card' }, h('h2', null, 'Internal job cost'),
        h('table', { class: 'tbl costs' }, h('tbody', null,
          line('Materials', c.materialsCents, c.missingPriceCount ? `Known so far ${money(c.materialsKnownCents)} · ${c.missingPriceCount} unpriced` : null),
          line('Tax', c.taxCents), line('Delivery', c.deliveryCents), line('Disposal', c.disposalCents),
          line('Internal labor', c.laborCents), line('Contractor / service charges', c.serviceChargesCents), line('Contingency', c.contingencyCents),
          h('tr', { class: 'total' }, h('td', null, 'Internal total'), h('td', { class: 'num' }, c.internalTotalCents == null ? h('span', { class: 'unknown' }, 'incomplete') : money(c.internalTotalCents))))),
        (c.notes || []).map(n => h('div', { class: 'small muted' }, n)));
    }),
    h('div', { class: 'card' }, h('h3', null, 'Cost inputs'),
      field('Sales tax on materials (%)', pct('taxRatePct')), field('Delivery ($)', dol('deliveryCents')), field('Disposal / hauling ($)', dol('disposalCents')),
      field('Internal labor hours', hrs), field('Labor rate ($/hr)', dol('laborRateCents')), field('Contingency (%)', pct('contingencyPct')),
      h('h4', null, 'Contractor / service charges'),
      (ci.serviceCharges || []).map((s, i) => h('div', { class: 'row' }, h('span', null, s.label, s.source ? h('span', { class: 'small muted' }, ` · ${s.source}`) : null), h('span', null, money(s.cents),
        canEdit() ? h('button', { class: 'linkbtn', onclick: () => edit(job => job.costInputs.serviceCharges.splice(i, 1)) }, 'Remove') : null))),
      canEdit() ? h('button', { class: 'btn', onclick: () => {
        const l = h('input', { type: 'text' }), a = dollarsIn(null), s = h('input', { type: 'text', placeholder: 'e.g. Greenworks 2025 rate sheet' });
        sheet('Add service charge', h('div', null, field('What', l), field('Amount ($)', a), field('Source', s)), (close) => [h('button', { class: 'btn primary', onclick: () => {
          edit(job => { job.costInputs = job.costInputs || {}; (job.costInputs.serviceCharges ||= []).push({ label: l.value.trim(), cents: toCents(a.value), source: s.value.trim() }); }); close(); } }, 'Add')]);
      } }, '+ Service charge') : null),
    h('div', { class: 'card selling' }, h('h3', null, 'Customer selling price'),
      h('p', { class: 'hint' }, 'What the customer pays. Shown for comparison only — never counted as material cost.'),
      sel ? h('div', null, h('div', { class: 'small muted' }, sel.source || ''),
        h('table', { class: 'tbl' }, h('tbody', null, (sel.lines || []).map(l => h('tr', null, h('td', null, l.activity, h('div', { class: 'small muted' }, l.description)), h('td', { class: 'num' }, money(l.cents)))),
          h('tr', { class: 'total' }, h('td', null, 'Selling total'), h('td', { class: 'num' }, money(sel.totalCents)))))) : h('div', { class: 'muted' }, 'No proposal recorded.')),
    h('div', { class: 'card' }, h('h3', null, 'Actual spend so far'), h('div', { class: 'row' }, h('span', null, 'Recorded purchases & costs'), h('strong', null, money(actualSpend))),
      h('a', { class: 'linkbtn', href: `#/job/${enc(id)}/more` }, 'Record purchases in More →')));
}

// ================= BUILD =================
function buildTab(id) {
  return h('div', null, busy(), estimateGate(e => {
    const pk = store.job.buildPlan?.packages || {};
    const setPk = (wp, fn) => edit(job => { job.buildPlan = job.buildPlan || { packages: {} }; job.buildPlan.packages = job.buildPlan.packages || {}; const p = (job.buildPlan.packages[wp] ||= { day: '', crew: '', notes: '', checklist: {} }); p.checklist ||= {}; fn(p); });
    return h('div', null,
      h('p', { class: 'hint' }, 'Work packages, not fixed one-day jobs. Supplies come from the single consolidated order — they are not ordered again per day.'),
      (e.guides || []).map(g => {
        const st = pk[g.id] || {};
        const cl = st.checklist || {};
        const steps = g.steps || [];
        const doneN = steps.filter(s => cl[s.id]).length;
        const day = h('input', { type: 'text', value: st.day || g.day || '', placeholder: 'e.g. Day 2 / Mon Oct 12', disabled: !canEdit() });
        day.addEventListener('change', () => setPk(g.id, p => { p.day = day.value; }));
        const crew = h('input', { type: 'text', value: st.crew || g.crew || '', placeholder: 'Who', disabled: !canEdit() });
        crew.addEventListener('change', () => setPk(g.id, p => { p.crew = crew.value; }));
        const notes = h('textarea', { rows: 3, placeholder: 'Crew notes', disabled: !canEdit() }, st.notes || g.notes || '');
        notes.addEventListener('change', () => setPk(g.id, p => { p.notes = notes.value; }));
        const box = (key, text) => { const cb = h('input', { type: 'checkbox', checked: !!cl[key], disabled: !canEdit() }); cb.addEventListener('change', () => setPk(g.id, p => { p.checklist[key] = cb.checked; })); return h('label', { class: 'check' }, cb, ' ', text); };
        return h('details', { class: 'card wp' },
          h('summary', null, h('span', { class: 'row' }, h('strong', null, g.title), h('span', { class: 'chip' }, `${doneN}/${steps.length}`)),
            (st.day || g.day) ? h('div', { class: 'small muted' }, st.day || g.day) : null),
          h('div', { class: 'grid2' }, field('Day', day), field('Crew', crew)),
          h('h4', null, 'Steps'), h('div', { class: 'checklist' }, steps.map(s => box(s.id, s.text))),
          (g.supplies || []).length ? h('div', null, h('h4', null, 'Supplies for this package'),
            h('ul', { class: 'plain' }, g.supplies.map(s => h('li', null, h('strong', null, lumberLabel(s.productKey) ? `${num(s.qty)} × ${lumberLabel(s.productKey)}` : qtyUnit(s.qty, s.unit)), ' ', s.name || '', s.note ? h('span', { class: 'small muted' }, ` — ${s.note}`) : null)))) : null,
          (g.boards || []).length ? h('div', null, h('h4', null, 'Boards to cut'), h('div', { class: 'chips' }, g.boards.map(b => h('a', { class: 'chip', href: `#/job/${enc(id)}/cuts` }, b)))) : null,
          (g.tools || []).length ? h('div', null, h('h4', null, 'Tools'), h('div', { class: 'small' }, g.tools.join(' · '))) : null,
          (g.checks || []).length ? h('div', null, h('h4', null, 'Check before moving on'), h('div', { class: 'checklist' }, g.checks.map((c, i) => box(`check-${i}`, c)))) : null,
          field('Notes', notes));
      }));
  }));
}

// ================= MORE =================
function moreTab(id) {
  const host = h('div');
  const job = store.job;
  const sections = [
    ['Exports', () => h('div', { class: 'stack' },
      h('a', { class: 'btn block', href: `/api/jobs/${enc(id)}/export/shopping.csv` }, 'Shopping list (CSV)'),
      h('a', { class: 'btn block', href: `/api/jobs/${enc(id)}/export/cutlist.csv` }, 'Cut list (CSV)'),
      h('a', { class: 'btn block', href: `/api/jobs/${enc(id)}/export/jobpack.html`, target: '_blank', rel: 'noopener' }, api.isCloud ? 'Job pack (HTML file to print)' : 'Printable job pack (save as PDF)'))],
    ['Scenarios', () => scenariosSection()],
    ['Construction settings for this job', () => settingsSection()],
    ['Drawings & sources', () => sourcesSection(id)],
    ['Price catalog', () => catalogSection()],
    ['Actual purchases & leftovers', () => actualsSection()],
    ['Revision history', () => revisionsSection(id)],
    ['Audit trail', () => auditSection(id)],
  ];
  for (const [title, fn] of sections) {
    const body = h('div');
    const d = h('details', { class: 'card section' }, h('summary', null, h('strong', null, title)), body);
    let loaded = false;
    d.addEventListener('toggle', () => { if (d.open && !loaded) { loaded = true; const r = fn(); if (r instanceof Promise) { mount(body, h('div', { class: 'muted' }, 'Loading…')); r.then(x => mount(body, x)).catch(e => mount(body, h('div', { class: 'error' }, e.message))); } else mount(body, r); } });
    host.appendChild(d);
  }
  return host;
}
function scenariosSection() {
  const sc = store.job.scenarios || [];
  if (!sc.length) return h('div', { class: 'muted' }, 'No alternatives. The job has one design.');
  return h('div', null, h('p', { class: 'hint' }, 'Alternatives stay separate until one is selected. Purchases follow the selected scenario.'),
    sc.map(s => h('div', { class: 'row item' }, h('div', null, h('strong', null, s.name), s.note ? h('div', { class: 'small muted' }, s.note) : null),
      s.selected ? h('span', { class: 'chip ok' }, 'Selected') : canEdit() ? h('button', { class: 'btn small', onclick: () => {
        edit(job => { for (const x of job.scenarios) x.selected = x.id === s.id; }); setScenario(s.id);
      } }, 'Select') : null)));
}
async function settingsSection() {
  let std = {}; try { std = await api.get('/api/standards'); } catch {}
  const raw = std.rules || std.effective || std.defaults || std.settings || {};
  const dget = (o, p) => o?.[p] ?? p.split('.').reduce((a, k) => a?.[k], o);
  const base = raw;
  const cur = (k) => store.job.settings?.[k] ?? dget(store.job.settings || {}, k);
  const set = (k, v) => edit(job => { job.settings = job.settings || {}; if (v === null || v === '') delete job.settings[k]; else job.settings[k] = v; });
  const numSet = (k, label, unit) => {
    const el = h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: cur(k) ?? '', placeholder: dget(base, k) != null ? `standard: ${dget(base, k)}` : 'standard', disabled: !canEdit() });
    el.addEventListener('change', () => set(k, toNum(el.value)));
    return field(`${label}${unit ? ` (${unit})` : ''}`, el);
  };
  const selSet = (k, label, opts) => {
    const el = h('select', { disabled: !canEdit() }, h('option', { value: '' }, `Standard${dget(base, k) ? ` (${dget(base, k)})` : ''}`), opts.map(([v, l]) => h('option', { value: v, selected: cur(k) === v }, l)));
    el.addEventListener('change', () => set(k, el.value || null));
    return field(label, el);
  };
  const scope = store.job.scope || {};
  const tog = (k, label) => { const cb = h('input', { type: 'checkbox', checked: !!scope[k], disabled: !canEdit() }); cb.addEventListener('change', () => edit(job => { job.scope = job.scope || {}; job.scope[k] = cb.checked; })); return h('label', { class: 'check' }, cb, ' ', label); };
  return h('div', null,
    h('p', { class: 'hint' }, 'Blank = shop standard. Changes apply to this job only.'),
    numSet('lumber.kerfIn', 'Saw kerf', 'in'), numSet('lumber.endTrimIn', 'End trim per board', 'in'), numSet('lumber.minUsableOffcutIn', 'Shortest usable offcut', 'in'),
    numSet('lumber.extraAllowancePct', 'Extra lumber allowance', '%'),
    selSet('bed.cornerRule', 'Bed corner joints', [['nominal', 'Nominal (not confirmed)'], ['butt', 'Butt joints'], ['interlaced', 'Interlaced each course']]),
    selSet('bed.wallMaterial', 'Bed wall lumber', [['cedartone', 'CedarTone'], ['smooth-cedar', 'Smooth cedar'], ['rough-cedar', 'Rough-sawn cedar']]),
    selSet('lumber.objective', 'Optimize for', [['waste', 'Least waste'], ['cost', 'Lowest cost (needs all prices)']]),
    h('h4', null, 'Scope'), tog('irrigation', 'Irrigation included'), tog('lighting', 'Lighting included'), tog('liner', 'Plastic liner'), tog('trim', 'Matching 1×4 trim'));
}
function sourcesSection(id) {
  const src = store.job.sources || [];
  return h('div', null,
    src.map(s => h('div', { class: 'item' },
      h('div', { class: 'row' }, h('strong', null, s.title || s.kind), h('span', { class: 'chip' }, s.kind)),
      h('div', { class: 'small muted' }, [s.revision, s.date, s.pages ? `${s.pages} page(s)` : null].filter(Boolean).join(' · ')),
      s.fileId ? (() => { const L = api.fileLinks(s.fileId);
        if (!L.href) return h('div', { class: 'small muted' }, 'Drawing kept with the analysis; open the original from your files.');
        return h('a', { href: L.href, target: '_blank', rel: 'noopener' },
          L.img ? h('img', { class: 'thumb', loading: 'lazy', alt: `Page 1 of ${s.title || 'drawing'}`, src: L.img }) : 'Open drawing'); })()
        : h('div', { class: 'small muted' }, 'File not uploaded to this job.'))),
    (store.job.drawingNotes || []).length ? h('details', { class: 'why' }, h('summary', null, `${store.job.drawingNotes.length} notes read from the drawing`),
      h('ul', null, store.job.drawingNotes.map(n => h('li', null, n.kind === 'exclusion' ? h('strong', null, 'Exclusion: ') : null, n.text)))) : null,
    (store.job.extractions || []).length ? h('div', { class: 'small muted' }, `${store.job.extractions.length} analysis run(s); last ${when(store.job.extractions.at(-1).at)}`) : null,
    h('a', { class: 'btn block', href: `#/job/${enc(id)}/upload` }, 'Upload drawing / re-analyze'),
    h('p', { class: 'hint' }, 'Re-analysis never erases confirmed corrections, answers or the price catalog.'));
}
async function catalogSection() {
  const host = h('div');
  const load = async () => {
    const r = await api.get('/api/catalog');
    const entries = Array.isArray(r) ? r : (r.entries || []);
    const q = h('input', { type: 'search', placeholder: 'Search product, supplier…', 'aria-label': 'Search catalog' });
    const list = h('div');
    const draw = () => {
      const t = q.value.toLowerCase();
      mount(list, entries.filter(x => !t || `${x.spec} ${x.productKey} ${x.supplier}`.toLowerCase().includes(t)).slice(0, 200).map(x => h('div', { class: 'item' },
        h('div', { class: 'row' }, h('strong', null, x.spec || x.productKey), h('span', { class: `chip pt-${x.priceType}` }, x.priceType === 'material' ? 'Material' : x.priceType === 'service' ? 'Service rate' : 'Selling price')),
        h('div', { class: 'row small' }, h('span', null, `${money(x.unitPriceCents)} / ${x.unitBasis || x.packageUnit}`), h('span', { class: 'muted' }, `${x.supplier || ''}${x.store ? ' ' + x.store : ''} · ${x.priceDate || 'no date'}`)),
        h('div', { class: 'small muted' }, x.productKey, x.source?.file ? ` · ${x.source.file}` : ''),
        x.notes ? h('div', { class: 'small' }, x.notes) : null,
        canEdit() ? h('div', { class: 'row gap' }, h('button', { class: 'linkbtn', onclick: () => catalogEntrySheet(x, load) }, 'Edit'),
          h('button', { class: 'linkbtn danger', onclick: async (ev) => { const b = ev.currentTarget; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete'; }, 4000); return; } try { await api.del(`/api/catalog/${enc(x.id)}`); toast('Deleted'); load(); refreshEstimate(); } catch (e) { toast(e.message, 'error'); } } }, 'Delete')) : null)));
    };
    q.addEventListener('input', draw);
    const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'visually-hidden', id: 'csvimp' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try { const text = await f.text(); const r = await api.request('POST', '/api/catalog/import', text, { 'Content-Type': 'text/csv' });
        toast(`Imported ${r.imported ?? r.count ?? '?'} price(s)${r.skipped ? `, skipped ${r.skipped}` : ''}.`); if (r.errors?.length) toast(r.errors.slice(0, 3).join(' · '), 'error'); load(); refreshEstimate(); }
      catch (e) { toast(e.message, 'error'); }
    });
    mount(host,
      h('p', { class: 'hint' }, `${entries.length} saved prices. Only “Material” prices are used for purchase costs; service rates and selling prices are kept separately.`),
      canEdit() ? h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => catalogEntrySheet({}, load) }, '+ Add price'), h('label', { for: 'csvimp', class: 'btn' }, 'Import CSV'), file) : null,
      h('div', { class: 'small muted' }, 'CSV columns: productKey, supplier, store, spec, packageSize, packageUnit, unitPrice, unitBasis, priceDate, priceType, sourceFile, notes'),
      q, list);
    draw();
  };
  await load();
  return host;
}
function catalogEntrySheet(x, after) {
  const f = (v, type = 'text') => h('input', { type, value: v ?? '', ...(type === 'number' ? { step: 'any', inputmode: 'decimal' } : {}) });
  const productKey = f(x.productKey), supplier = f(x.supplier ?? 'Menards'), storeIn = f(x.store), spec = f(x.spec), pkgSize = f(x.packageSize ?? 1, 'number'), pkgUnit = f(x.packageUnit ?? 'ea');
  const price = dollarsIn(x.unitPriceCents), basis = f(x.unitBasis ?? x.packageUnit ?? 'ea'), date = f(x.priceDate ?? '', 'date'), srcFile = f(x.source?.file ?? ''), notes = f(x.notes);
  const ptype = h('select', null, [['material', 'Material (purchase cost)'], ['service', 'Contractor / service rate'], ['selling', 'Customer selling price']].map(([v, l]) => h('option', { value: v, selected: (x.priceType || 'material') === v }, l)));
  sheet(x.id ? 'Edit price' : 'Add price', h('div', null,
    field('Product key', productKey, 'Must match exactly, e.g. lumber:pt:4x4:8'), field('Exact product / spec', spec), field('Supplier', supplier), field('Store', storeIn),
    h('div', { class: 'grid2' }, field('Package size', pkgSize), field('Package unit', pkgUnit)), h('div', { class: 'grid2' }, field('Price ($)', price), field('Per', basis)),
    field('Price date', date), field('Price type', ptype), field('Source (file, page or URL)', srcFile), field('Notes', notes)),
    (close) => [h('button', { class: 'btn primary', onclick: async () => {
      if (!productKey.value.trim() || price.value === '' || !date.value) { toast('Product key, price and date are required.', 'error'); return; }
      try {
        await api.post('/api/catalog', { ...(x.id ? { id: x.id } : {}), productKey: productKey.value.trim(), supplier: supplier.value.trim(), store: storeIn.value.trim() || null, sku: x.sku ?? null,
          spec: spec.value.trim(), packageSize: toNum(pkgSize.value), packageUnit: pkgUnit.value.trim(), unitPriceCents: toCents(price.value), unitBasis: basis.value.trim(),
          priceDate: date.value, priceType: ptype.value, source: { file: srcFile.value.trim() || null, page: null, url: null }, notes: notes.value.trim() });
        toast('Price saved'); close(); after?.(); refreshEstimate(true);
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Save price')]);
}
function actualsSection() {
  const job = store.job; const a = job.actuals || { purchases: [], leftovers: [], costs: [] };
  const rows = store.estimate?.shopping || [];
  const uniq = [...new Map(rows.map(r => [r.productKey, r])).values()];
  const prodSel = () => h('select', null, uniq.map(r => h('option', { value: r.productKey }, productLabel(r))), h('option', { value: 'other' }, 'Other'));
  const addPurchase = () => {
    const p = prodSel(), q = h('input', { type: 'number', step: 'any', inputmode: 'decimal' }), t = dollarsIn(null), s = h('input', { type: 'text', value: 'Menards' }), d = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }), n = h('input', { type: 'text' });
    sheet('Record purchase', h('div', null, field('Product', p), field('Quantity', q), field('Total paid ($)', t), field('Supplier', s), field('Date', d), field('Note', n)), (close) => [h('button', { class: 'btn primary', onclick: () => {
      edit(job => { job.actuals = job.actuals || { purchases: [], leftovers: [], costs: [] }; job.actuals.purchases.push({ id: 'p-' + Date.now().toString(36), productKey: p.value, qty: toNum(q.value), totalCents: toCents(t.value), supplier: s.value, date: d.value, note: n.value }); }); close(); } }, 'Save')]);
  };
  const addLeftover = () => {
    const p = prodSel(), L = h('input', { type: 'number', step: 'any', inputmode: 'decimal' }), q = h('input', { type: 'number', step: '1', value: 1 }), n = h('input', { type: 'text' });
    sheet('Record leftover stock', h('div', null, field('Product', p), field('Length (in) — blank if not lumber', L), field('Quantity', q), field('Note', n)), (close) => [h('button', { class: 'btn primary', onclick: () => {
      edit(job => { job.actuals = job.actuals || { purchases: [], leftovers: [], costs: [] }; (job.actuals.leftovers ||= []).push({ id: 'l-' + Date.now().toString(36), productKey: p.value, lengthIn: toNum(L.value), qty: toNum(q.value), note: n.value }); }); close(); } }, 'Save')]);
  };
  const planned = {};
  for (const r of rows) { const x = planned[r.productKey]; planned[r.productKey] = x ? { ...x, totalQty: (x.totalQty || 0) + (r.totalQty || 0), extendedCents: x.extendedCents == null || r.extendedCents == null ? null : x.extendedCents + r.extendedCents } : r; }
  const byProd = {};
  for (const p of a.purchases || []) { const x = (byProd[p.productKey] ||= { qty: 0, cents: 0 }); x.qty += p.qty || 0; x.cents += p.totalCents || 0; }
  return h('div', null,
    canEdit() ? h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: addPurchase }, '+ Purchase'), h('button', { class: 'btn', onclick: addLeftover }, '+ Leftover')) : null,
    Object.keys(byProd).length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Product'), h('th', null, 'Planned'), h('th', null, 'Actual'))),
      h('tbody', null, Object.entries(byProd).map(([k, x]) => h('tr', null, h('td', null, planned[k] ? productLabel(planned[k]) : k),
        h('td', null, planned[k] ? `${num(planned[k].totalQty)} · ${money(planned[k].extendedCents)}` : '—'), h('td', null, `${num(x.qty)} · ${money(x.cents)}`))))) : h('div', { class: 'muted' }, 'No purchases recorded yet.'),
    (a.purchases || []).map((p, i) => h('div', { class: 'row small item' }, h('span', null, `${p.date || ''} ${planned[p.productKey] ? productLabel(planned[p.productKey]) : p.productKey} × ${num(p.qty)} — ${money(p.totalCents)} ${p.supplier || ''}`),
      canEdit() ? h('button', { class: 'linkbtn', onclick: () => edit(job => job.actuals.purchases.splice(i, 1)) }, 'Remove') : null)),
    h('h4', null, 'Leftover stock'),
    (a.leftovers || []).length ? (a.leftovers).map((l, i) => h('div', { class: 'row small item' }, h('span', null, `${planned[l.productKey] ? productLabel(planned[l.productKey]) : l.productKey}${l.lengthIn ? ` · ${inches(l.lengthIn)}` : ''} × ${num(l.qty)} ${l.note || ''}`),
      canEdit() ? h('button', { class: 'linkbtn', onclick: () => edit(job => job.actuals.leftovers.splice(i, 1)) }, 'Remove') : null)) : h('div', { class: 'muted' }, 'None recorded.'));
}
async function revisionsSection(id) {
  const r = await api.get(`/api/jobs/${enc(id)}/revisions`);
  const revs = Array.isArray(r) ? r : (r.revisions || []);
  return h('ul', { class: 'plain' }, revs.slice().sort((a, b) => b.version - a.version).map(v => h('li', { class: 'item small' }, h('strong', null, `v${v.version}`), ` · ${when(v.created_at || v.createdAt || v.updatedAt)} · ${v.author || v.updatedBy || ''}`, v.summary ? h('div', { class: 'muted' }, v.summary) : null)));
}
function auditName(a, e) {
  const row = (e.shopping || []).find(r => rowKey(r) === (a.rowId || a.productKey)) || (e.shopping || []).find(r => r.productKey === a.productKey);
  return row ? productLabel(row) : (lumberLabel(a.productKey) || a.productKey);
}
function detailText(d) {
  if (typeof d === 'string') return d;
  return Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ');
}
async function auditSection(id) {
  const r = await api.get(`/api/jobs/${enc(id)}/audit`).catch(() => null);
  const entries = r ? (Array.isArray(r) ? r : (r.log || r.entries || r.audit || [])) : [];
  const e = store.estimate;
  return h('div', null,
    entries.length ? h('ul', { class: 'plain' }, entries.slice(0, 100).map(x => h('li', { class: 'item small' }, `${when(x.at)} · ${x.username || x.by || ''} · ${(x.action || '').replace(/-/g, ' ')}`, x.detail ? h('div', { class: 'muted' }, detailText(x.detail)) : null))) : h('div', { class: 'muted' }, 'No activity log yet.'),
    e?.audit?.length ? h('div', null, h('h4', null, 'Shopping quantities → sources'), e.audit.map(a => h('details', { class: 'why' }, h('summary', null, `${auditName(a, e)}${(a.rowId || '').endsWith('|provisional') ? ' (provisional)' : ''}: ${a.rowQty == null ? 'unknown' : num(a.rowQty)}`),
      h('ul', null, (a.from || []).map(f => h('li', null, f.componentId ? `${compName(f.componentId)}: ` : '', f.formula || f.ref || '', ' ', f.basis ? `(${BASIS[f.basis] || f.basis})` : '')))))) : null);
}

const TAB_RENDER = { summary: summaryTab, questions: questionsTab, shop: shopTab, cuts: cutsTab, costs: costsTab, build: buildTab, more: moreTab };
