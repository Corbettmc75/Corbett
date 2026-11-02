// Tiny DOM helper. All text goes through textContent — never innerHTML with data.
const SVGNS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg','g','path','polygon','polyline','line','rect','text','circle','title','tspan']);

export function h(tag, attrs, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && !isSvg) el.value = v;
    else if (k === 'checked' && !isSvg) el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); append(el, children); return el; }

// ---------- formatting ----------
export function money(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return 'unknown';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
export function num(n, max = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'unknown';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
}
const UNIT = { cy: 'cu yd', cf: 'cu ft', sqft: 'sq ft', lf: 'lin ft', ea: 'ea', bag: 'bags', roll: 'rolls', board: 'boards', box: 'boxes', load: 'loads', stick: 'sticks', panel: 'panels', pallet: 'pallets' };
export function unitLabel(u, qty) {
  if (!u) return '';
  const l = UNIT[u] || u;
  if (qty === 1 && /s$/.test(l) && !['cu yd','cu ft','sq ft','lin ft'].includes(l)) return l.slice(0, -1);
  return l;
}
export function qtyUnit(qty, unit) { return `${num(qty)} ${unitLabel(unit, qty)}`.trim(); }
export function inches(n) {
  if (n === null || n === undefined) return 'unknown';
  const r = Math.round(n * 16) / 16; const whole = Math.trunc(r); const frac = Math.round((r - whole) * 16);
  if (!frac) return `${whole}"`;
  let a = frac, b = 16; while (a % 2 === 0) { a /= 2; b /= 2; }
  return `${whole ? whole + ' ' : ''}${a}/${b}"`;
}
export function feetIn(ft) {
  if (ft === null || ft === undefined) return 'unknown';
  const totalIn = Math.round(ft * 12 * 8) / 8; const f = Math.floor(totalIn / 12); const i = totalIn - f * 12;
  return i ? `${f}' ${inches(i)}` : `${f}'`;
}
// "7 × 6×6×12'" for lumber product keys
export function lumberLabel(key) {
  const m = /^lumber:([^:]+):(\d+x\d+):(\d+)$/.exec(key || '');
  if (!m) return null;
  return `${m[2].replace('x', '×')}×${m[3]}'`;
}
export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(+d)) return String(iso);
  const today = new Date(); const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                 : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
export const BASIS = { drawing: 'Drawing', calculation: 'Calculated', default: 'Default', proposal: 'Proposal', manual: 'Manual' };
export function basisBadge(basis) {
  if (!basis) return null;
  return h('span', { class: `badge basis-${basis}` }, BASIS[basis] || basis);
}
export const QTYPE = {
  missing_dimension: 'Missing dimension', construction_detail: 'Construction detail',
  product_spec: 'Product spec', missing_price: 'Missing price', scope_conflict: 'Scope conflict',
};
export const STATUS = { ok: 'OK', provisional: 'Provisional', unresolved: 'Unresolved', missing_price: 'No price' };
export function statusChip(s) { return h('span', { class: `chip st-${s || 'ok'}` }, STATUS[s] || s || 'OK'); }

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
export function field(label, input, hint) {
  const id = input.id || ('f' + Math.random().toString(36).slice(2, 8));
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
