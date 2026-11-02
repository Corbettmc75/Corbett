// Planar geometry for bed outlines. Feet, outside faces. Pure functions.
const EPS = 1e-9;

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Normalize a component geometry into a CCW polygon ([[x,y],...]) or null. */
export function toPolygon(geom) {
  if (!geom) return null;
  let pts;
  if (geom.kind === 'rect') {
    const L = Number(geom.lengthFt), W = Number(geom.widthFt);
    if (!(L > 0) || !(W > 0)) return null;
    pts = [[0, 0], [L, 0], [L, W], [0, W]];
  } else if (geom.kind === 'polygon' && Array.isArray(geom.points) && geom.points.length >= 3) {
    pts = geom.points.map(([x, y]) => [Number(x), Number(y)]);
    // drop duplicate closing point
    const a = pts[0], b = pts.at(-1);
    if (pts.length > 3 && Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) pts.pop();
  } else return null;
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

export function area(poly) { return poly ? Math.abs(signedArea(poly)) : 0; }

export function edges(poly) {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return { index: i, a: p, b: q, lengthFt: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
}

export function perimeter(poly) { return edges(poly).reduce((s, e) => s + e.lengthFt, 0); }

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

/** Corners: vertex i joins edge i-1 (ending at it) and edge i (starting at it). */
export function corners(poly) {
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const c = cross(p[0] - prev[0], p[1] - prev[1], next[0] - p[0], next[1] - p[1]);
    return { index: i, point: p, prevEdge: (i - 1 + n) % n, nextEdge: i, convex: c > 0, reflex: c < 0 };
  });
}

function inwardNormal(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  return [-dy / L, dx / L]; // left normal of a CCW polygon points inside
}

function lineIntersect(p, d, q, e) {
  const den = cross(d[0], d[1], e[0], e[1]);
  if (Math.abs(den) < EPS) return null;
  const t = cross(q[0] - p[0], q[1] - p[1], e[0], e[1]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** Offset every edge inward by t (feet) and intersect adjacent offset lines. */
export function insetPolygon(poly, t) {
  const n = poly.length;
  const lines = edges(poly).map(e => {
    const nrm = inwardNormal(e.a, e.b);
    return { p: [e.a[0] + nrm[0] * t, e.a[1] + nrm[1] * t], d: [e.b[0] - e.a[0], e.b[1] - e.a[1]] };
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const x = lineIntersect(L1.p, L1.d, L2.p, L2.d);
    out.push(x ?? L2.p); // collinear edges: keep the offset point
  }
  return out;
}

/** Ray from a point along dir; nearest hit on any other edge parallel to `src`. */
function rayHit(poly, srcIdx, origin, dir) {
  const es = edges(poly), src = es[srcIdx];
  const sd = [src.b[0] - src.a[0], src.b[1] - src.a[1]];
  let best = null;
  for (const e of es) {
    if (e.index === srcIdx) continue;
    const ed = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
    if (Math.abs(cross(sd[0], sd[1], ed[0], ed[1])) > 1e-6 * e.lengthFt * src.lengthFt) continue; // not parallel
    const den = cross(dir[0], dir[1], ed[0], ed[1]);
    if (Math.abs(den) < EPS) continue;
    const w = [e.a[0] - origin[0], e.a[1] - origin[1]];
    const t = cross(w[0], w[1], ed[0], ed[1]) / den;      // distance along ray
    const u = cross(w[0], w[1], dir[0], dir[1]) / den;    // param along edge
    if (t > EPS && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) best = { edge: e.index, t };
  }
  return best;
}

/**
 * Opposing wall pairs. For each edge longer than minLenFt, cast a ray from its midpoint
 * into the interior and take the nearest parallel edge. A pair is reported once,
 * keyed on the longer (source) edge.
 */
export function opposingPairs(poly, minLenFt = 0) {
  const es = edges(poly);
  const seen = new Map();
  for (const e of [...es].sort((a, b) => b.lengthFt - a.lengthFt || a.index - b.index)) {
    if (!(e.lengthFt > minLenFt + 1e-9)) continue;
    const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    const hit = rayHit(poly, e.index, mid, inwardNormal(e.a, e.b));
    if (!hit) continue;
    const key = [e.index, hit.edge].sort((a, b) => a - b).join('-');
    if (seen.has(key)) continue;
    seen.set(key, { edgeA: e.index, edgeB: hit.edge, lengthAFt: e.lengthFt, lengthBFt: es[hit.edge].lengthFt, distanceFt: hit.t });
  }
  return [...seen.values()];
}

export function bbox(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
