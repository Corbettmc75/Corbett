// Raised bed takeoff: walls, PT posts, middle supports, screws, liner strips, trim.
import { toPolygon, area, perimeter, edges, corners, insetPolygon, opposingPairs } from '../geometry.js';
import { collector, finish, round, ftIn, wallMaterial } from './util.js';

const WALL_T_IN = 1.5;
const TOL_FT = 0.5;

/** Trellis post points that sit on this bed (shared with trellis.js). */
export function trellisPostsForBed(bed, poly, ctx) {
  const es = edges(poly);
  const out = [];
  for (const tr of ctx.components.filter(c => c.type === 'trellis' && c.props?.bedId === bed.id)) {
    const n = Number(tr.props.posts) || 0;
    const edge = tr.props.edge;
    let e = null, reversed = false;
    if (Array.isArray(edge) && edge.length === 2) {
      const close = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
      for (const cand of es) {
        if (close(cand.a, edge[0]) && close(cand.b, edge[1])) { e = cand; break; }
        if (close(cand.a, edge[1]) && close(cand.b, edge[0])) { e = cand; reversed = true; break; }
      }
    }
    if (!e) { out.push({ trellisId: tr.id, edgeIndex: null, posts: [] }); continue; }
    const inset = ctx.rules.trellis.postInsetFromBoxEdgeIn / 12;
    const L = e.lengthFt, dir = [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L];
    const params = n <= 0 ? [] : n === 1 ? [L / 2] : Array.from({ length: n }, (_, k) => inset + k * (L - 2 * inset) / (n - 1));
    const posts = params.map((s, k) => ({
      s, point: [e.a[0] + dir[0] * s, e.a[1] + dir[1] * s],
      end: n >= 2 && (k === 0 || k === n - 1),
      // the end post replaces the corner 4x4 at the nearest end of the edge
      replacesVertex: n >= 2 && k === 0 ? e.index : n >= 2 && k === n - 1 ? (e.index + 1) % poly.length : null,
    }));
    out.push({ trellisId: tr.id, edgeIndex: e.index, reversed, posts });
  }
  return out;
}

export function takeoff(bed, ctx) {
  const { rules, job } = ctx;
  const c = collector(bed);
  const poly = toPolygon(bed.geometry);
  const courses = Number(bed.props?.courses ?? rules.bed.courses);
  const heightIn = Number(bed.props?.heightIn ?? rules.bed.heightIn);
  const mat = wallMaterial(bed, rules);
  const wallGroup = `lumber:${mat}:2x6`;
  if (!poly) {
    c.q({ id: `q.bed-dims:${bed.id}`, type: 'missing_dimension', text: `${bed.name}: outside dimensions are not legible — what are they?` });
    return finish(c);
  }
  const t = WALL_T_IN / 12;
  const es = edges(poly), cs = corners(poly);
  const inside = insetPolygon(poly, t);
  const isRect = poly.length === 4;
  c.metrics = {
    outsideAreaSqFt: round(area(poly), 4), insideAreaSqFt: round(area(inside), 4),
    perimeterFt: round(perimeter(poly), 4), insidePerimeterFt: round(perimeter(inside), 4),
    corners: cs.length, convexCorners: cs.filter(x => x.convex).length, reflexCorners: cs.filter(x => x.reflex).length,
    courses, heightIn, wallMaterial: mat,
  };
  if (Math.abs(courses * rules.bed.courseHeightIn - heightIn) > 0.01) c.metrics.heightNote = `${courses} courses × ${rules.bed.courseHeightIn}" = ${courses * rules.bed.courseHeightIn}" vs drawn ${heightIn}" (drawing governs)`;

  // ---- walls -------------------------------------------------------------
  const rule = rules.bed.cornerRule;
  const cornerQ = rule === 'nominal' || !['butt', 'interlaced'].includes(rule)
    ? c.q({ id: 'q.corner-rule', type: 'construction_detail',
        text: 'Corner joint rule for 2×6 walls: butt (longer wall runs through) or interlaced (alternate each course)? Sets finished cut lengths.',
        provisional: 'Nominal outside lengths used for wall pieces until confirmed.' })
    : null;
  const throughEdgeAt = (v, course) => {
    const { prevEdge, nextEdge } = cs[v];
    const lp = es[prevEdge].lengthFt, ln = es[nextEdge].lengthFt;
    let through = lp > ln + 1e-9 ? prevEdge : ln > lp + 1e-9 ? nextEdge : Math.min(prevEdge, nextEdge);
    if (rule === 'interlaced' && course % 2 === 1) through = through === prevEdge ? nextEdge : prevEdge;
    return through;
  };
  const endAdj = (edgeIdx, v, course) => {
    if (cornerQ) return 0;
    const through = throughEdgeAt(v, course) === edgeIdx;
    return cs[v].convex ? (through ? 0 : -WALL_T_IN) : (through ? WALL_T_IN : 0);
  };
  let wallPieces = 0;
  for (const e of es) {
    const nominal = e.lengthFt * 12;
    for (let k = 0; k < courses; k++) {
      const len = nominal + endAdj(e.index, e.index, k) + endAdj(e.index, (e.index + 1) % es.length, k);
      c.piece({ id: `${bed.id}:wall:e${e.index}:c${k + 1}`, groupKey: wallGroup, lengthIn: len, nominalLengthIn: nominal,
        label: `${bed.name} — wall ${e.index + 1} (${ftIn(nominal)} outside), course ${k + 1}`, role: 'wall',
        allowanceEligible: true, workPackage: 'wp2', status: cornerQ ? 'provisional' : 'ok', questionIds: cornerQ ? [cornerQ] : [] });
      wallPieces++;
    }
  }

  // ---- posts & supports --------------------------------------------------
  const trellisInfo = trellisPostsForBed(bed, poly, ctx);
  const trellisPosts = trellisInfo.flatMap(ti => ti.posts);
  const replaced = new Set(rules.trellis.replacesCornerPost ? trellisPosts.filter(p => p.replacesVertex != null).map(p => p.replacesVertex) : []);
  for (const ti of trellisInfo) if (ti.edgeIndex == null) {
    c.q({ id: `q.trellis-edge:${ti.trellisId}`, type: 'missing_dimension', text: `Which wall of ${bed.name} carries trellis ${ti.trellisId}? Needed to know which corner posts it replaces.` });
  }
  const postLen = rules.bed.postEmbedIn + heightIn - rules.bed.postTopBelowBedTopIn;
  const postGroup = rules.bed.postGroup;
  const postStock = rules.bed.postStockFt;
  const postFormula = `${rules.bed.postEmbedIn}" embed + ${heightIn}" bed − ${rules.bed.postTopBelowBedTopIn}" below top = ${postLen}"`;
  let cornerPosts = 0;
  for (const cn of cs) {
    if (replaced.has(cn.index)) continue;
    cornerPosts++;
    c.piece({ id: `${bed.id}:post:corner${cn.index + 1}`, groupKey: postGroup, lengthIn: postLen,
      label: `${bed.name} — corner post ${cn.index + 1}${cn.reflex ? ' (inside corner)' : ''} (${postFormula})`, role: 'bed-post',
      allowedStockFt: postStock, allowanceEligible: true, workPackage: 'wp2' });
  }

  const supportGroup = rules.bed.supportGroup;
  const vertLen = heightIn - rules.bed.postTopBelowBedTopIn;
  const vertQ = c.q({ id: 'q.support-vertical', type: 'construction_detail',
    text: `Length of the opposing vertical PT 2×4 at middle supports? Using bed height − ${rules.bed.postTopBelowBedTopIn}" (${vertLen}") meanwhile.`,
    provisional: `${vertLen}" vertical` });
  let middlePosts = 0, supports = 0, trellisAsSupport = 0, provisionalSupports = 0;
  const pairs = opposingPairs(poly, rules.bed.middleSupportOverFt);
  if (!isRect && pairs.length) {
    c.q({ id: 'q.support-layout-L', type: 'construction_detail',
      text: 'Support layout for L/U-shaped beds: confirm middle posts and cross members (one per run over 5\', post on the longer wall, 2×4 to the facing wall).',
      provisional: 'One support per run over 5\', post on the longer wall.' });
  }
  for (const pr of pairs) {
    const eA = es[pr.edgeA], L = eA.lengthFt;
    const long = L > rules.bed.longRunReviewOverFt + 1e-9;
    const n = long ? Math.ceil(L / rules.bed.provisionalMaxSpanFt - 1e-9) - 1 : 1;
    let qid = null;
    if (long) {
      qid = c.q({ id: `q.support-layout:${bed.id}`, type: 'construction_detail',
        text: `Confirm support layout for the ${ftIn(L * 12)} run of ${bed.name}: how many middle posts/cross members?`,
        provisional: `${n} supports assumed (spans ≤ ${rules.bed.provisionalMaxSpanFt}').` });
    } else if (!isRect) qid = 'q.support-layout-L';
    const dir = [(eA.b[0] - eA.a[0]) / L, (eA.b[1] - eA.a[1]) / L];
    const nrm = [-dir[1], dir[0]];
    const crossLen = pr.distanceFt * 12 - 2 * WALL_T_IN;
    for (let k = 1; k <= n; k++) {
      const s = k * L / (n + 1);
      const pA = [eA.a[0] + dir[0] * s, eA.a[1] + dir[1] * s];
      const pB = [pA[0] + nrm[0] * pr.distanceFt, pA[1] + nrm[1] * pr.distanceFt];
      const near = (p) => trellisPosts.some(tp => Math.hypot(tp.point[0] - p[0], tp.point[1] - p[1]) <= TOL_FT);
      const status = qid ? 'provisional' : 'ok';
      const qids = qid ? [qid] : [];
      supports++; if (qid) provisionalSupports++;
      const sid = `${bed.id}:support:e${pr.edgeA}-e${pr.edgeB}:${k}`;
      if (near(pA) || near(pB)) trellisAsSupport++;
      else {
        middlePosts++;
        c.piece({ id: `${sid}:post`, groupKey: postGroup, lengthIn: postLen,
          label: `${bed.name} — middle post on wall ${pr.edgeA + 1} (${ftIn(s * 12)} along)`, role: 'bed-post',
          allowedStockFt: postStock, allowanceEligible: true, workPackage: 'wp2', status, questionIds: qids });
      }
      c.piece({ id: `${sid}:cross`, groupKey: supportGroup, lengthIn: crossLen,
        label: `${bed.name} — cross member wall ${pr.edgeA + 1} → wall ${pr.edgeB + 1} (${ftIn(pr.distanceFt * 12)} outside − 2 walls)`,
        role: 'support-cross', allowanceEligible: true, workPackage: 'wp2', status, questionIds: qids });
      c.piece({ id: `${sid}:vertical`, groupKey: supportGroup, lengthIn: vertLen,
        label: `${bed.name} — opposing vertical 2×4 on wall ${pr.edgeB + 1}`, role: 'support-vertical',
        allowanceEligible: true, workPackage: 'wp2', status: 'provisional', questionIds: [...qids, vertQ] });
    }
  }
  Object.assign(c.metrics, { cornerPosts, replacedCorners: replaced.size, middlePosts, supports, provisionalSupports,
    trellisPostsAsSupports: trellisAsSupport, installed4x4: cornerPosts + middlePosts, postLengthIn: postLen });

  // ---- deck screws -------------------------------------------------------
  const connections = wallPieces * 2 + supports * courses * 2;
  const spb = rules.bed.screwsPerBoardEnd;
  const screwQ = c.q({ id: 'q.screw-rule', type: 'construction_detail',
    text: 'Recorded "3 per 2×6 and 2 to connect to the posts": screws per board end at each post, or per board? Needed for a final 3" screw count.' });
  const pkgQ = 'q.pkg:screw:deck:3in';
  c.req({ productKey: rules.bed.screwKey, role: 'deck-screws', unit: 'ea', workPackage: 'wp2',
    qty: typeof spb === 'number' ? connections * spb : null,
    status: typeof spb === 'number' ? 'provisional' : 'unresolved',
    formula: `${connections} board-to-post/support connections (${wallPieces} wall boards × 2 ends + ${supports} supports × ${courses} courses × 2) × ${spb ?? '?'} screws`,
    refs: ['rule:bed.screwsPerBoardEnd'], questionIds: [screwQ, pkgQ] });

  // ---- liner & trim (walls only, only where lining is included) ----------
  const linerOn = job.scope?.liner !== false && bed.props?.liner !== false;
  if (linerOn) {
    const L = rules.liner;
    const stripH = heightIn + (L.topAllowanceIn || 0) + (L.bottomAllowanceIn || 0);
    const lapIn = L.lapIn;
    const insidePerimIn = perimeter(inside) * 12;
    const maxStripIn = L.rollLengthFt * 12;
    const segs = Math.max(1, Math.ceil((insidePerimIn - 1e-6) / maxStripIn));
    const laps = segs; // closing lap of the loop + one per extra strip
    const loopIn = insidePerimIn + laps * (lapIn ?? 0);
    c.metrics.liner = { stripHeightIn: stripH, insidePerimeterIn: round(insidePerimIn, 3), laps, lapIn, loopLengthIn: round(loopIn, 3),
      segmentsIn: Array.from({ length: Math.ceil((loopIn - 1e-6) / maxStripIn) }, (_, i, a) => round(i < a.length - 1 ? maxStripIn : loopIn - maxStripIn * (a.length - 1), 3)) };
    if (lapIn == null) c.q({ id: 'q.liner-lap', type: 'construction_detail', text: 'Liner lap at strip joints and where each wall loop closes (inches)? Using 0" meanwhile.', provisional: '0" lap' });
    if (!(L.topAllowanceIn > 0) && !(L.bottomAllowanceIn > 0)) c.q({ id: 'q.liner-allowance', type: 'construction_detail', text: 'Liner allowance above/below the 27.5" wall for stapling or tucking (inches)? Using full wall height only.', provisional: 'strip height = wall height' });

    if (job.scope?.trim !== false && bed.props?.trim !== false) {
      const trimGroup = `lumber:${mat}:1x4`;
      const tt = rules.trim.thicknessIn;
      const ies = edges(inside), ics = corners(inside);
      const maxIn = Math.max(...rules.trim.stockFt) * 12;
      const thr = (v) => { const { prevEdge: p, nextEdge: n } = ics[v]; return ies[p].lengthFt > ies[n].lengthFt + 1e-9 ? p : ies[n].lengthFt > ies[p].lengthFt + 1e-9 ? n : Math.min(p, n); };
      const adj = (ei, v) => { const through = thr(v) === ei; return ics[v].convex ? (through ? 0 : -tt) : (through ? tt : 0); };
      let trimIn = 0;
      for (const e of ies) {
        const run = e.lengthFt * 12 + adj(e.index, e.index) + adj(e.index, (e.index + 1) % ies.length);
        trimIn += run;
        const n = Math.max(1, Math.ceil((run - 1e-6) / maxIn));
        for (let k = 0; k < n; k++) {
          c.piece({ id: `${bed.id}:trim:e${e.index}:${k + 1}`, groupKey: trimGroup, lengthIn: run / n, nominalLengthIn: run / n,
            label: `${bed.name} — trim, inside wall ${e.index + 1}${n > 1 ? ` (piece ${k + 1}/${n}, butt joint)` : ''}`, role: 'trim',
            allowedStockFt: rules.trim.stockFt, mustBeContinuous: true, allowanceEligible: true, workPackage: 'wp4' });
        }
      }
      c.metrics.trimRunIn = round(trimIn, 3);
      const ts = rules.trim.screwSpacingIn;
      const tq = c.q({ id: 'q.trim-screws', type: 'construction_detail', text: 'Trim screw spacing and screw type/length for the 1×4 trim?' });
      c.req({ productKey: rules.trim.screwKey, role: 'trim-screws', unit: 'ea', workPackage: 'wp4',
        qty: typeof ts === 'number' ? Math.ceil(trimIn / ts) + ies.length : null, status: typeof ts === 'number' ? 'provisional' : 'unresolved',
        formula: `${round(trimIn / 12, 2)} ft of trim ÷ ${ts ?? '?'}" spacing + 1 per run`, refs: ['rule:trim.screwSpacingIn'], questionIds: [tq, `q.pkg:${rules.trim.screwKey}`] });
    }
    const ss = L.stapleSpacingIn;
    const sq = c.q({ id: 'q.staple-spacing', type: 'construction_detail', text: 'Liner staple spacing (and rows per strip) and staple size?' });
    c.req({ productKey: L.stapleKey, role: 'liner-staples', unit: 'ea', workPackage: 'wp4',
      qty: typeof ss === 'number' ? Math.ceil(insidePerimIn / ss) : null, status: typeof ss === 'number' ? 'provisional' : 'unresolved',
      formula: `${round(insidePerimIn / 12, 2)} ft inside perimeter ÷ ${ss ?? '?'}" spacing (one row)`, refs: ['rule:liner.stapleSpacingIn'], questionIds: [sq, `q.pkg:${L.stapleKey}`] });
  }
  return finish(c);
}
