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

function patio(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (a == null) qs.push(c.q({ id: `q.patio-dims:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: patio outline/width not dimensioned${comp.notes ? ` (${comp.notes.split('.')[0]})` : ''} — confirm patio dimensions.` }));
  c.metrics = { areaSqFt: a == null ? null : round(a, 3) };
  c.req({ productKey: p.product, role: 'pavers', unit: 'sqft', qty: a == null ? null : round(a, 3), workPackage: 'wp7',
    basis: 'drawing', formula: 'Patio field area (border rows deducted once border is resolved)', questionIds: [...qs, `q.pkg:${p.product}`] });
  const b = p.border;
  if (b) {
    const ans = ctx.job.answers?.['q.patio-border']?.value;
    let key = null, qids = [...qs];
    if (b.productDrawing && b.productProposal && b.productDrawing !== b.productProposal && !ans) {
      qids.push(c.q({ id: 'q.patio-border', type: 'scope_conflict',
        text: 'Updated drawing names Courtstone (Basalt) border; signed proposal names Copthorne (Basalt), 2 rows on 3 sides. Which?',
        productKeys: [b.productDrawing, b.productProposal] }));
      key = b.productProposal;
    } else key = ans === 'drawing' || /courtstone/i.test(ans || '') ? b.productDrawing : (b.productProposal ?? b.productDrawing);
    c.req({ productKey: key, role: 'patio-border', unit: 'lf', qty: null, workPackage: 'wp7', status: 'unresolved',
      formula: `${b.rows ?? '?'} rows × border run on ${b.sides ?? '?'} sides (run length waits on patio dimensions)`, questionIds: qids });
  }
  if (p.base == null) c.q({ id: 'q.patio-base', type: 'construction_detail',
    text: 'Patio and stoop base: depth/material spec (kept separate from the path base)?' });
  return finish(c);
}

function stoop(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (!comp.geometry) qs.push(c.q({ id: `q.stoop-dims:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: only ${comp.notes?.match(/\d+'/)?.[0] ?? 'one side'} is labelled — stoop depth and coping run?` }));
  else qs.push(c.q({ id: `q.stoop-detail:${comp.id}`, type: 'construction_detail',
    text: `${comp.name}: step riser height, which edges get coping, and how the wrap walls are built?` }));
  c.metrics = { wrapAreaSqFt: a == null ? null : round(a, 3),
    existingAreaSqFt: p.existing ? round(p.existing.lengthFt * p.existing.widthFt, 3) : null };
  if (p.product) c.req({ productKey: p.product, role: 'stoop-pavers', unit: 'sqft', qty: null, workPackage: 'wp7', status: 'unresolved',
    formula: `Wrap ${c.metrics.wrapAreaSqFt ?? '?'} sq ft outline; paver quantity waits on wrap/step detail`, questionIds: qs });
  if (p.coping?.product) c.req({ productKey: p.coping.product, role: 'stoop-coping', unit: 'lf', qty: null, workPackage: 'wp7', status: 'unresolved',
    formula: 'Coping run waits on which edges are coped', questionIds: [...qs, `q.pkg:${p.coping.product}`] });
  return finish(c);
}

function screen(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const runs = p.runs ?? [{ lengthFt: comp.geometry?.lengthFt ?? null, ref: 'drawing' }];
  const known = runs.filter(r => r.lengthFt != null).reduce((s, r) => s + Number(r.lengthFt), 0);
  const missing = runs.filter(r => r.lengthFt == null);
  const qs = [];
  if (missing.length) qs.push(c.q({ id: `q.screen-runs:${comp.id}`, type: 'missing_dimension',
    text: `${comp.name}: length of ${missing.map(r => r.ref).join('; ')}?` }));
  qs.push(c.q({ id: 'q.screen-construction', type: 'construction_detail',
    text: `4' screens & dog fence ("same lumber as boxes"): post size/spacing, framing and board layout per panel?` }));
  c.metrics = { knownLengthFt: known, heightFt: p.heightFt ?? null };
  c.req({ productKey: comp.type === 'fence' ? 'assembly:dog-fence' : 'assembly:screen-panel', role: comp.type, unit: 'lf',
    qty: missing.length ? null : known, status: 'unresolved', workPackage: 'wp8',
    formula: `${known}' known${missing.length ? ` + ${missing.length} undimensioned run(s)` : ''} × ${p.heightFt ?? '?'}' tall; lumber list waits on panel construction`,
    questionIds: qs });
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
  if (p.depthIn == null) qs.push(c.q({ id: `q.mulch-depth:${comp.id}`, type: 'construction_detail', text: `${comp.name}: placement depth (inches)?` }));
  c.req({ productKey: p.product, role: 'mulch', unit: 'cy', workPackage: 'wp8',
    qty: a != null && p.depthIn != null ? round(a * p.depthIn / 12 / CY, 4) : null,
    formula: `${a ?? '?'} sq ft × ${p.depthIn ?? '?'}" ÷ 12 ÷ 27`, questionIds: qs });
  return finish(c);
}

function rock(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
  const a = geomArea(comp.geometry);
  const qs = [];
  if (a == null) qs.push(c.q({ id: `q.rock-area:${comp.id}`, type: 'missing_dimension', text: `${comp.name}: area?` }));
  if (p.depthIn == null) qs.push(c.q({ id: 'q.rock-depth', type: 'missing_dimension', text: `Rock depth for the ${comp.geometry?.widthFt ?? '?'}×${comp.geometry?.lengthFt ?? '?'} (${a ?? '?'} sq ft) dog area?` }));
  if (p.relocatedCreditCf == null) qs.push(c.q({ id: 'q.rock-credit', type: 'construction_detail', text: 'How much existing rock is being relocated into the dog area (cu ft or cu yd)? It is credited before buying new rock.' }));
  const needCf = a != null && p.depthIn != null ? a * p.depthIn / 12 : null;
  const netCf = needCf != null && p.relocatedCreditCf != null ? Math.max(0, needCf - p.relocatedCreditCf) : null;
  c.metrics = { areaSqFt: a, requiredCf: needCf == null ? null : round(needCf, 3), creditCf: p.relocatedCreditCf ?? null, netCf: netCf == null ? null : round(netCf, 3) };
  c.req({ productKey: p.product, role: 'rock', unit: 'cy', workPackage: 'wp7', qty: netCf == null ? null : round(netCf / CY, 4),
    formula: `${a ?? '?'} sq ft × ${p.depthIn ?? '?'}" ÷ 12 − ${p.relocatedCreditCf ?? '?'} cu ft relocated, ÷ 27`, questionIds: qs });
  return finish(c);
}

function demolition(comp, ctx) {
  const c = collector(comp); const p = comp.props || {};
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
  const fq = c.q({ id: 'q.drain-fittings', type: 'product_spec', text: `Drain tile fittings for ${(p.fittings || []).join(' and ') || 'connections'}: which adapters/tees/outlet?` });
  c.req({ productKey: 'drain:tile-4in', role: 'drain-tile', unit: 'lf', qty: p.lengthFt ?? null, workPackage: 'wp7', formula: 'Route length', questionIds: [...qs, 'q.pkg:drain:tile-4in'] });
  c.req({ productKey: 'drain:fittings', role: 'drain-fittings', unit: 'ea', qty: null, workPackage: 'wp7', status: 'unresolved', formula: (p.fittings || []).join(', '), questionIds: [fq] });
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
