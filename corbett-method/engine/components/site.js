// Site components: paths, patio, stoops, screens/fence, planting, mulch, rock, demolition, edging, drain,
// irrigation and lighting (only when the job scope includes them).
import { toPolygon, area as polyArea } from '../geometry.js';
import { collector, finish, round } from './util.js';

const CY = 27;
export function geomArea(g) {
  if (!g) return null;
  if (g.kind === 'area') return Number(g.areaSqFt) > 0 ? Number(g.areaSqFt) : null;
  const p = toPolygon(g);
  return p ? polyArea(p) : null;
}

function path(comp, ctx) {
  const { rules } = ctx; const c = collector(comp); const R = rules.path;
  const a = geomArea(comp.geometry);
  const qid = a == null ? c.q({ id: `q.path-outline:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: path outline is not fully dimensioned — length × width (or corner points)?${comp.notes ? ` (${comp.notes})` : ''}` }) : null;
  c.metrics = { areaSqFt: a == null ? null : round(a, 3) };
  const qs = qid ? [qid] : [];
  c.req({ productKey: R.gravelKey, role: 'path-gravel', unit: 'cy', workPackage: 'wp7', qty: a == null ? null : round(a * R.gravelIn / 12 / CY, 4),
    formula: `${a == null ? '?' : round(a, 2)} sq ft × ${R.gravelIn}" ÷ 12 ÷ 27`, refs: ['rule:path.gravelIn'], questionIds: qs });
  if (R.fabric) c.req({ productKey: R.fabricKey, role: 'path-fabric', unit: 'sqft', workPackage: 'wp7', qty: a == null ? null : round(a, 3),
    formula: `${a == null ? '?' : round(a, 2)} sq ft (laps/roll size per q.pkg)`, refs: ['rule:path.fabric'], questionIds: qs });
  c.req({ productKey: R.dgKey, role: 'path-dg', unit: 'cy', workPackage: 'wp7', qty: a == null ? null : round(a * R.dgIn / 12 / CY, 4),
    formula: `${a == null ? '?' : round(a, 2)} sq ft × ${R.dgIn}" ÷ 12 ÷ 27 (compacted volume; loose factor per supplier)`, refs: ['rule:path.dgIn'], questionIds: qs });
  if (a != null && R.compactionFactor == null) c.q({ id: 'q.path-compaction', type: 'product_spec',
    text: 'Gravel/DG: supplier loose-to-compacted factor? Volumes are compacted in-place until supplied.' });
  return finish(c);
}

function hardscapeBase(c, ctx, areaSqFt, label) {
  const H = ctx.rules.hardscape || {};
  if (areaSqFt == null || H.baseIn == null) return;
  c.req({ productKey: H.baseKey, role: 'paver-base', unit: 'cy', workPackage: 'wp7', qty: round(areaSqFt * H.baseIn / 12 / CY, 4), basis: 'calculation',
    formula: `${label}: ${round(areaSqFt, 1)} sq ft × ${H.baseIn}" ÷ 12 ÷ 27`, refs: ['rule:hardscape.baseIn'], questionIds: ['q.patio-base'] });
  if (H.sandIn) c.req({ productKey: H.sandKey, role: 'bedding-sand', unit: 'cy', workPackage: 'wp7', qty: round(areaSqFt * H.sandIn / 12 / CY, 4), basis: 'calculation',
    formula: `${label}: ${round(areaSqFt, 1)} sq ft × ${H.sandIn}" ÷ 12 ÷ 27`, refs: ['rule:hardscape.sandIn'], questionIds: ['q.patio-base'] });
}

function patio(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (a == null) qs.push(c.q({ id: `q.patio-dims:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: patio outline/width not dimensioned${comp.notes ? ` (${comp.notes.split('.')[0]})` : ''} — confirm patio dimensions.` }));
  const b = p.border;
  // Border band: runs (outer lengths per bordered side) × band width, minus the overlap at inside corners.
  const runs = (b?.runsFt || []).map(Number).filter(x => x > 0);
  const w = (b?.widthIn ?? ctx.rules.hardscape?.borderWidthIn) != null ? Number(b?.widthIn ?? ctx.rules.hardscape.borderWidthIn) / 12 : null;
  const borderLf = runs.length ? runs.reduce((x, y) => x + y, 0) : null;
  const borderArea = borderLf != null && w != null ? borderLf * w - Math.max(0, runs.length - 1) * w * w : null;
  const field = a != null ? (borderArea != null ? a - borderArea : a) : null;
  c.metrics = { areaSqFt: a == null ? null : round(a, 2), borderLf: borderLf == null ? null : round(borderLf, 2), borderAreaSqFt: borderArea == null ? null : round(borderArea, 2), fieldSqFt: field == null ? null : round(field, 2) };
  c.req({ productKey: p.product, role: 'pavers', unit: 'sqft', qty: field == null ? null : round(field, 2), workPackage: 'wp7',
    basis: comp.provenance?.geometry?.basis ?? 'drawing',
    formula: field == null ? 'Patio field area' : `${round(a, 1)} sq ft patio − ${round(borderArea ?? 0, 1)} sq ft border band = ${round(field, 1)} sq ft field`, questionIds: [...qs, `q.pkg:${p.product}`] });
  if (b) {
    const ans = ctx.job.answers?.['q.patio-border']?.value ?? ctx.rules.assume?.patioBorder;
    let key, qids = [...qs];
    if (b.productDrawing && b.productProposal && b.productDrawing !== b.productProposal && !ans) {
      qids.push(c.q({ id: 'q.patio-border', type: 'scope_conflict',
        text: 'Updated drawing names Courtstone (Basalt) border; signed proposal names Copthorne (Basalt), 2 rows on 3 sides. Which?',
        productKeys: [b.productDrawing, b.productProposal] }));
      key = b.productProposal;
    } else key = ans === 'drawing' || /courtstone/i.test(ans || '') ? b.productDrawing : (b.productProposal ?? b.productDrawing);
    const rows = Number(b.rows) || null;
    c.req({ productKey: key, role: 'patio-border', unit: 'lf', qty: borderLf != null && rows ? round(borderLf * rows, 2) : null, workPackage: 'wp7',
      status: borderLf != null && rows ? 'ok' : 'unresolved',
      formula: borderLf != null ? `${rows} rows × ${round(borderLf, 2)} ft on ${runs.length} sides (${runs.map(x => round(x, 2)).join(' + ')} ft)` : 'Border run waits on patio dimensions',
      questionIds: [...qids, `q.pkg:${key}`] });
  }
  hardscapeBase(c, ctx, a, comp.name);
  if (ctx.rules.hardscape?.baseIn == null) c.q({ id: 'q.patio-base', type: 'construction_detail',
    text: 'Patio and stoop base: depth/material spec (kept separate from the path base)?' });
  return finish(c);
}

function stoop(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (!comp.geometry) qs.push(c.q({ id: `q.stoop-dims:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: only ${comp.notes?.match(/\d+'/)?.[0] ?? 'one side'} is labelled — stoop depth and coping run?` }));
  else if (ctx.rules.hardscape?.baseIn == null) qs.push(c.q({ id: `q.stoop-detail:${comp.id}`, type: 'construction_detail',
    text: `${comp.name}: step riser height, which edges get coping, and how the wrap walls are built?` }));
  const ex = p.existing ? p.existing.lengthFt * p.existing.widthFt : null;
  const wrap = a != null ? (ex != null ? a - ex : a) : null;
  // Coping follows the exposed (not-against-house) outer edges given in props.copingEdgesFt.
  const coping = Array.isArray(p.copingEdgesFt) ? p.copingEdgesFt.reduce((x, y) => x + Number(y), 0) : null;
  c.metrics = { outlineSqFt: a == null ? null : round(a, 2), existingAreaSqFt: ex == null ? null : round(ex, 2), wrapStepSqFt: wrap == null ? null : round(wrap, 2), copingLf: coping };
  if (p.product) c.req({ productKey: p.product, role: 'stoop-pavers', unit: 'sqft', qty: wrap == null ? null : round(wrap, 2), workPackage: 'wp7',
    status: wrap == null ? 'unresolved' : 'ok',
    formula: ex != null ? `${round(a, 2)} sq ft wrap outline − ${round(ex, 2)} sq ft existing stoop = ${round(wrap, 2)} sq ft step` : `${round(a ?? 0, 2)} sq ft`,
    questionIds: [...qs, `q.pkg:${p.product}`] });
  if (p.coping?.product) c.req({ productKey: p.coping.product, role: 'stoop-coping', unit: 'lf', qty: coping == null ? null : round(coping, 2), workPackage: 'wp7',
    status: coping == null ? 'unresolved' : 'ok',
    formula: coping == null ? 'Coping run waits on stoop size' : `Exposed edges ${p.copingEdgesFt.map(x => round(x, 2)).join(' + ')} ft`,
    questionIds: [...qs, `q.pkg:${p.coping.product}`] });
  if (wrap != null && p.product) hardscapeBase(c, ctx, wrap, comp.name);
  return finish(c);
}

function screen(comp, ctx) {
  const c = collector(comp); const p = comp.props || {}; const S = ctx.rules.screen || {};
  const runs = p.runs ?? [{ lengthFt: comp.geometry?.lengthFt ?? null, ref: 'drawing' }];
  const known = runs.filter(r => r.lengthFt != null).reduce((s, r) => s + Number(r.lengthFt), 0);
  const missing = runs.filter(r => r.lengthFt == null);
  const qs = [];
  if (missing.length) qs.push(c.q({ id: `q.screen-runs:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: length of ${missing.map(r => r.ref).join('; ')}?` }));
  c.metrics = { lengthFt: round(known, 2), heightFt: p.heightFt ?? null };
  if (S.courses == null || missing.length) {
    qs.push(c.q({ id: 'q.screen-construction', type: 'construction_detail',
      text: `4' screens & dog fence ("same lumber as boxes"): post size/spacing, framing and board layout per panel?` }));
    c.req({ productKey: comp.type === 'fence' ? 'assembly:dog-fence' : 'assembly:screen-panel', role: comp.type, unit: 'lf',
      qty: missing.length ? null : known, status: 'unresolved', workPackage: 'wp8',
      formula: `${known}' known × ${p.heightFt ?? '?'}' tall; lumber list waits on panel construction`, questionIds: qs });
    return finish(c);
  }
  // Same lumber as the boxes: horizontal 2×6 courses on 4×4 posts (continuous runs share corner posts).
  const mat = ctx.rules.bed.wallMaterial;
  const boardGroup = `lumber:${mat}:2x6`, postGroup = `lumber:${mat}:${S.postSection || '4x4'}`;
  let k = 0;
  runs.forEach((r, i) => {
    for (let course = 1; course <= S.courses; course++) {
      c.piece({ id: `${comp.id}:r${i + 1}c${course}`, groupKey: boardGroup, lengthIn: round(r.lengthFt * 12, 3), nominalLengthIn: round(r.lengthFt * 12, 3),
        label: `${comp.name} — run ${i + 1} (${round(r.lengthFt, 2)}') course ${course}`, role: 'screen-board', allowanceEligible: true, workPackage: 'wp8' });
    }
  });
  const posts = runs.reduce((n, r) => n + Math.ceil(r.lengthFt / S.postSpacingFt - 1e-9), 0) + 1;
  const postLen = (p.heightFt ?? 4) * 12 + (S.postEmbedIn ?? 24);
  for (let i = 1; i <= posts; i++) c.piece({ id: `${comp.id}:post${i}`, groupKey: postGroup, lengthIn: postLen, nominalLengthIn: postLen,
    label: `${comp.name} — post ${i} (${p.heightFt ?? 4}' + ${S.postEmbedIn ?? 24}" buried)`, role: 'screen-post', allowanceEligible: false, workPackage: 'wp8' });
  c.req({ productKey: ctx.rules.bed.screwKey, role: 'screen-screws', unit: 'ea', workPackage: 'wp8', basis: 'calculation',
    qty: runs.reduce((n, r) => n + S.courses * (Math.ceil(r.lengthFt / S.postSpacingFt - 1e-9) + 1) * 2, 0),
    formula: `2 screws per board at each post (${S.courses} courses)`, questionIds: ['q.screen-construction'] });
  c.metrics.posts = posts;
  return finish(c);
}

function planting(comp, ctx) {
  const c = collector(comp);
  for (const pl of comp.props?.plants ?? []) {
    c.req({ id: `${comp.id}:${pl.key}`, productKey: pl.key, role: 'plants', unit: 'ea', qty: pl.qty, workPackage: 'wp8',
      basis: comp.provenance?.['props.plants']?.basis ?? 'drawing', formula: `${pl.qty} as drawn`, allowanceEligible: false });
  }
  return finish(c);
}

function mulch(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (a == null) qs.push(c.q({ id: `q.mulch-area:${comp.id}`, type: 'missing_dimension', text: `${comp.name}: area to cover (perennial beds + around AC) is not dimensioned — sq ft?` }));
  const depth = p.depthIn ?? ctx.rules.mulch?.depthIn ?? null;
  if (depth == null) qs.push(c.q({ id: `q.mulch-depth:${comp.id}`, type: 'construction_detail', text: `${comp.name}: placement depth (inches)?` }));
  c.metrics = { areaSqFt: a == null ? null : round(a, 2), depthIn: depth };
  c.req({ productKey: p.product, role: 'mulch', unit: 'cy', workPackage: 'wp8',
    qty: a != null && depth != null ? round(a * depth / 12 / CY, 4) : null,
    formula: `${a == null ? '?' : round(a, 1)} sq ft × ${depth ?? '?'}" ÷ 12 ÷ 27`, questionIds: [...qs, `q.mulch-depth:${comp.id}`] });
  return finish(c);
}

function rock(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (a == null) qs.push(c.q({ id: `q.rock-area:${comp.id}`, type: 'missing_dimension', text: `${comp.name}: area?` }));
  const depth = p.depthIn ?? ctx.rules.rock?.depthIn ?? null;
  const credit = p.relocatedCreditCf ?? null;
  if (depth == null) qs.push(c.q({ id: 'q.rock-depth', type: 'missing_dimension', text: `Rock depth for the ${comp.geometry?.widthFt ?? '?'}×${comp.geometry?.lengthFt ?? '?'} (${a ?? '?'} sq ft) dog area?` }));
  if (credit == null) qs.push(c.q({ id: 'q.rock-credit', type: 'construction_detail', text: 'How much existing rock is being relocated into the dog area (cu ft or cu yd)? It is credited before buying new rock.' }));
  const needCf = a != null && depth != null ? a * depth / 12 : null;
  // With the standard assumption, the full volume is listed and relocated rock is used first (buy only the shortfall).
  const netCf = needCf != null ? Math.max(0, needCf - (credit ?? 0)) : null;
  c.metrics = { areaSqFt: a, depthIn: depth, requiredCf: needCf == null ? null : round(needCf, 3), creditCf: credit, netCf: netCf == null ? null : round(netCf, 3) };
  c.req({ productKey: p.product, role: 'rock', unit: 'cy', workPackage: 'wp7', qty: netCf == null ? null : round(netCf / CY, 4), allowanceEligible: false,
    formula: `${a ?? '?'} sq ft × ${depth ?? '?'}" ÷ 12${credit ? ` − ${credit} cu ft relocated` : ' (less whatever existing rock is moved in first)'} ÷ 27`, questionIds: [...qs, 'q.rock-depth', 'q.rock-credit'] });
  return finish(c);
}

function demolition(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  if (ctx.rules.assume?.demolitionIsService) { c.metrics = { service: true, items: p.items || [] }; return finish(c); }
  const q = c.q({ id: 'q.demo-detail', type: 'construction_detail',
    text: 'Demolition: removal thickness and material per area (sod/soil, flagstone, concrete walk), and hauling basis (dumpster size or loads)?' });
  c.req({ productKey: 'disposal:demolition', role: 'demolition-disposal', unit: 'load', qty: null, workPackage: 'wp1', status: 'unresolved',
    formula: `${(p.items || []).join('; ') || 'Project footprint'} — volume waits on thickness/material/hauling`, questionIds: [q] });
  return finish(c);
}

function edging(comp, ctx) {
  const { rules } = ctx; const c = collector(comp); const R = rules.edging;
  const runs = comp.props?.runs ?? [];
  if (!runs.length || runs.some(r => r.lengthFt == null)) {
    const q = c.q({ id: 'q.edging-runs', type: 'missing_dimension',
      text: 'Black edging: which boundaries get edging (marked boundaries/fences only, not boxes, foundations or pavers), and each run length?' });
    c.req({ productKey: R.stickKey, role: 'edging-sticks', unit: 'ea', qty: null, workPackage: 'wp7', status: 'unresolved', formula: 'Per eligible run: ceil(run ÷ 8\')', questionIds: [q] });
    c.req({ productKey: R.spikeKey, role: 'edging-spikes', unit: 'ea', qty: null, workPackage: 'wp7', status: 'unresolved', formula: `Per run at ${R.spikeSpacingIn}" spacing`, questionIds: [q, `q.pkg:${R.spikeKey}`] });
    return finish(c);
  }
  let sticks = 0, spikes = 0;
  for (const r of runs) {
    const L = Number(r.lengthFt) * 12;
    sticks += Math.ceil(L / (R.stickLengthFt * 12) - 1e-9);
    spikes += Math.floor(L / R.spikeSpacingIn + 1e-9) + (R.endSpikes == null ? 1 : Number(R.endSpikes));
  }
  const endQ = R.endSpikes == null ? c.q({ id: 'q.edging-ends', type: 'construction_detail', text: 'Edging spikes: extra spikes at run ends and corners?', provisional: 'one extra per run' }) : null;
  c.req({ productKey: R.stickKey, role: 'edging-sticks', unit: 'ea', qty: sticks, workPackage: 'wp7', formula: `${runs.length} runs, each ceil(length ÷ 8')` });
  c.req({ productKey: R.spikeKey, role: 'edging-spikes', unit: 'ea', qty: spikes, workPackage: 'wp7', status: endQ ? 'provisional' : 'ok',
    formula: `each run: floor(length ÷ ${R.spikeSpacingIn}") + end spikes`, questionIds: [endQ, `q.pkg:${R.spikeKey}`].filter(Boolean) });
  return finish(c);
}

function drain(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const qs = [];
  if (p.lengthFt == null) qs.push(c.q({ id: 'q.drain-length', type: 'missing_dimension', text: '4" drain tile: route length from downspout/sump to discharge along the property line/fence?' }));
  const fit = ctx.rules.drain?.fittings;
  const fq = fit ? 'q.drain-fittings' : c.q({ id: 'q.drain-fittings', type: 'product_spec', text: `Drain tile fittings for ${(p.fittings || []).join(' and ') || 'connections'}: which adapters/tees/outlet?` });
  c.req({ productKey: 'drain:tile-4in', role: 'drain-tile', unit: 'lf', qty: p.lengthFt ?? null, workPackage: 'wp7', basis: comp.provenance?.['props.lengthFt']?.basis ?? 'drawing',
    formula: p.lengthFt != null ? `${p.lengthFt} ft route (${comp.provenance?.['props.lengthFt']?.ref || 'as drawn'})` : 'Route length', questionIds: [...qs, 'q.drain-length', 'q.pkg:drain:tile-4in'] });
  c.req({ productKey: 'drain:fittings', role: 'drain-fittings', unit: 'ea', qty: fit ? fit.length : null, workPackage: 'wp7', status: fit ? 'ok' : 'unresolved',
    formula: (fit || p.fittings || []).join(', '), questionIds: [fq] });
  return finish(c);
}

function systemComp(kind) {
  return (comp, ctx) => {
    const c = collector(comp);
    if (!ctx.job.scope?.[kind]) return finish(c); // excluded scope: nothing at all
    const q = c.q({ id: `q.${kind}-design`, type: 'construction_detail',
      text: kind === 'irrigation'
        ? 'Irrigation: supply route lengths from the spigot to each bed, and filter/regulator/backflow parts to include?'
        : 'Lighting: fixture positions, transformer location and cable routes? (Spotlight lamp "M16" spec also unconfirmed.)' });
    c.req({ productKey: `${kind}:system`, role: kind, unit: 'ea', qty: null, workPackage: 'wp5', status: 'unresolved', formula: 'Waits on layout', questionIds: [q] });
    return finish(c);
  };
}

export const SITE_TAKEOFFS = {
  path, patio, stoop, screen, fence: screen, planting, mulch, rock, demolition, edging, drain,
  irrigation: systemComp('irrigation'), lighting: systemComp('lighting'),
};
