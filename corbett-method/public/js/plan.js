// Visual summary: beds drawn from their outside-face geometry with edge dimension labels
// and trellis lines. Beds are laid out side-by-side (the drawing does not give site positions).
import { h, feetIn, inches } from './h.js';

export function toPoints(geom) {
  if (!geom) return null;
  if (geom.kind === 'polygon' && Array.isArray(geom.points)) return geom.points;
  if (geom.kind === 'rect' && geom.lengthFt && geom.widthFt) {
    const L = geom.lengthFt, W = geom.widthFt; return [[0, 0], [W, 0], [W, L], [0, L]];
  }
  return null;
}
function signedArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

/** Plan of all beds + trellises. opts.metrics optional per-component metrics for captions. */
export function planSvg(components, opts = {}) {
  const beds = (components || []).filter(c => c.type === 'bed' && !c.excluded);
  const trellises = (components || []).filter(c => c.type === 'trellis' && !c.excluded);
  if (!beds.length) return h('div', { class: 'empty' }, 'No beds yet — upload and analyze a drawing.');
  const GAP = 3.5, PAD = 2.2;
  let x0 = 0; const placed = [];
  let maxH = 0;
  for (const b of beds) {
    const pts = toPoints(b.geometry);
    if (!pts) { placed.push({ b, pts: null }); continue; }
    const minX = Math.min(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1]));
    const maxX = Math.max(...pts.map(p => p[0])), maxY = Math.max(...pts.map(p => p[1]));
    placed.push({ b, pts, dx: x0 - minX + PAD, dy: -minY + PAD, w: maxX - minX, hgt: maxY - minY });
    x0 += (maxX - minX) + GAP;
    maxH = Math.max(maxH, maxY - minY);
  }
  const W = x0 - GAP + PAD * 2, H = maxH + PAD * 2 + 1.6;
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plan', role: 'img', 'aria-label': 'Bed plan with outside dimensions' });
  for (const p of placed) {
    if (!p.pts) continue;
    const pts = p.pts.map(([x, y]) => [x + p.dx, y + p.dy]);
    const ccw = signedArea(pts) > 0;
    svg.appendChild(h('polygon', { points: pts.map(q => q.join(',')).join(' '), class: 'bed-poly' },
      h('title', null, p.b.name)));
    // edge labels (outward normal)
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1); if (len < 0.01) continue;
      let nx = (y2 - y1) / len, ny = -(x2 - x1) / len; if (!ccw) { nx = -nx; ny = -ny; }
      // In SVG y-down coords with positive signed area, (dy,-dx) points outward; flip handled by ccw
      const mx = (x1 + x2) / 2 + nx * 0.75, my = (y1 + y2) / 2 + ny * 0.75;
      svg.appendChild(h('text', { x: mx, y: my, class: 'dim', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, feetIn(len)));
    }
    // trellis lines on this bed
    for (const t of trellises.filter(t => t.props?.bedId === p.b.id && Array.isArray(t.props?.edge))) {
      const [[a, b], [c, d]] = t.props.edge;
      const X1 = a + p.dx, Y1 = b + p.dy, X2 = c + p.dx, Y2 = d + p.dy;
      svg.appendChild(h('line', { x1: X1, y1: Y1, x2: X2, y2: Y2, class: 'trellis-line' }, h('title', null, t.name)));
      const n = t.props.posts || 0; const L = Math.hypot(X2 - X1, Y2 - Y1);
      const inset = Math.min(15 / 12, L / 4);
      for (let k = 0; k < n; k++) {
        const s = n === 1 ? 0.5 : (inset + (L - 2 * inset) * k / (n - 1)) / L;
        const px = X1 + (X2 - X1) * s, py = Y1 + (Y2 - Y1) * s;
        svg.appendChild(h('rect', { x: px - 0.25, y: py - 0.25, width: 0.5, height: 0.5, class: 'trellis-post' }));
      }
    }
    svg.appendChild(h('text', { x: p.dx + Math.min(...p.pts.map(q => q[0])) + p.w / 2, y: H - 0.6, class: 'bed-name', 'text-anchor': 'middle' }, p.b.name));
  }
  return svg;
}

/** Horizontal bar of one purchased board: pieces, saw loss, usable offcut, waste. */
export function boardBar(board) {
  const total = board.stockLengthFt * 12;
  const svg = h('svg', { viewBox: `0 0 ${total} 18`, preserveAspectRatio: 'none', class: 'boardbar', role: 'img',
    'aria-label': `${board.id}: ${board.cuts.length} pieces, ${inches(board.usableOffcutIn || 0)} usable offcut` });
  let x = 0;
  const kerfEach = board.cuts.length ? (board.sawLossIn || 0) / board.cuts.length : 0;
  board.cuts.forEach((c, i) => {
    svg.appendChild(h('rect', { x, y: 0, width: Math.max(c.lengthIn, 0.5), height: 18, class: `piece p${i % 4}` }, h('title', null, `${c.label} — ${inches(c.lengthIn)}`)));
    x += c.lengthIn;
    if (kerfEach > 0) { svg.appendChild(h('rect', { x, y: 0, width: Math.max(kerfEach, 0.6), height: 18, class: 'kerf' })); x += kerfEach; }
  });
  if (board.usableOffcutIn > 0) { svg.appendChild(h('rect', { x, y: 0, width: board.usableOffcutIn, height: 18, class: 'offcut' }, h('title', null, `Usable offcut ${inches(board.usableOffcutIn)}`))); x += board.usableOffcutIn; }
  const waste = Math.max(0, total - x);
  if (waste > 0.01) svg.appendChild(h('rect', { x, y: 0, width: waste, height: 18, class: 'waste' }, h('title', null, `Waste ${inches(waste)}`)));
  return svg;
}
