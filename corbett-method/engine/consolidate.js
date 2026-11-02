// Consolidates the whole job's requirements into one purchasing list.
// Lumber: all compatible pieces across components are pooled per groupKey, optimized together,
// and counted as purchased boards. Everything else: identical productKey+unit is summed across
// components FIRST, then rounded to the purchase unit.
import { LUMBER_GROUPS } from './rules.js';
import { productInfo } from './products.js';
import { optimizeGroup } from './cutopt.js';
import { matchPrice, worseStatus } from './pricing.js';

const EPS = 1e-9;

export function stockForGroup(groupKey, catalog = []) {
  const g = LUMBER_GROUPS[groupKey];
  if (!g) return null;
  const mk = (ft, specialOrder) => ({ lengthFt: ft, specialOrder,
    priceCents: matchPrice(`${groupKey}:${ft}`, catalog, 'board').unitPriceCents ?? null });
  return [...g.stockFt.map(ft => mk(ft, false)), ...g.specialOrderFt.map(ft => mk(ft, true))];
}

/** Optimize every lumber pool. Returns { cutPlans: {groupKey:{reviewed, nominal}}, questions }. */
export function planLumber(pieces = [], rules, catalog = [], { timeLimitMs = 10000, nodeLimit = 150000 } = {}) {
  const L = rules?.lumber || {};
  const byGroup = new Map();
  for (const p of pieces) {
    if (!byGroup.has(p.groupKey)) byGroup.set(p.groupKey, []);
    byGroup.get(p.groupKey).push(p);
  }
  const cutPlans = {};
  const questions = [];
  for (const [groupKey, ps] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stock = stockForGroup(groupKey, catalog);
    if (!stock) {
      questions.push({ id: `q.lumber-group:${groupKey}`, type: 'product_spec',
        text: `Lumber product "${groupKey}" is not in the stock list — which species/treatment and stock lengths should be bought?`,
        componentIds: [...new Set(ps.map(p => p.componentId))], productKeys: [], provisional: 'Pieces listed but not purchased.', status: 'open' });
      cutPlans[groupKey] = { reviewed: { groupKey, mode: 'reviewed', boards: [], infeasible: ps.map(p => ({ pieceId: p.id, label: p.label, reason: 'Unknown lumber product' })), conflicts: [], proof: 'best-found', notes: [], stats: {} }, nominal: null };
      continue;
    }
    const common = { groupKey, pieces: ps, stock, nodeLimit, kerfIn: L.kerfIn ?? 0.125, endTrimIn: L.endTrimIn ?? 0,
      minUsableOffcutIn: L.minUsableOffcutIn ?? 12, objective: L.objective || 'waste', timeLimitMs,
      stockToleranceIn: L.stockLengthToleranceIn ?? 0 };
    const reviewed = optimizeGroup({ ...common, mode: 'reviewed' });
    const nominal = optimizeGroup({ ...common, mode: 'nominal' });
    cutPlans[groupKey] = { reviewed, nominal };
    for (const inf of reviewed.infeasible) {
      questions.push({ id: `q.infeasible:${inf.pieceId}`, type: 'construction_detail',
        text: `${inf.label || inf.pieceId}: ${inf.reason} How should this run be built?`,
        componentIds: [ps.find(p => p.id === inf.pieceId)?.componentId].filter(Boolean), productKeys: [], provisional: 'Not purchased.', status: 'open' });
    }
  }
  return { cutPlans, questions };
}

function roundQty(qty, unit, rules) {
  if (qty == null) return null;
  if (unit === 'cy') {
    const step = rules?.soil?.roundToCy || 0.25;
    return Math.round(Math.ceil(qty / step - 1e-9) * step * 1000) / 1000;
  }
  if (['bag', 'ea', 'roll', 'board', 'box', 'load', 'stick', 'panel'].includes(unit)) return Math.ceil(qty - 1e-9);
  return Math.ceil(qty * 100 - 1e-6) / 100; // sqft, lf, cf: keep exact to 0.01, no invented rounding
}

/**
 * @param {{requirements, cutPlans, rules, pieces?}} args
 * @returns {{ rows: ShoppingRow[], questions: Question[] }}
 */
export function consolidate({ requirements = [], cutPlans = {}, rules = {}, pieces = [] }) {
  const rows = [];
  const questions = [];
  const pct = rules?.lumber?.extraAllowancePct ?? 0;
  const pieceById = new Map(pieces.map(p => [p.id, p]));

  // ---- Lumber rows from reviewed cut plans ----
  const lumberGroupsWithPieces = new Set(Object.keys(cutPlans));
  for (const [groupKey, plans] of Object.entries(cutPlans)) {
    const plan = plans.reviewed;
    const byKey = new Map();
    // Boards carrying ONLY provisional pieces (e.g. unconfirmed brace counts) form their own row,
    // so a provisional quantity never inflates a confirmed count (7 trellis posts stay 7).
    const allProv = b => b.cuts.length > 0 && b.cuts.every(c => pieceById.get(c.pieceId)?.status === 'provisional');
    for (const b of plan.boards) {
      const k = allProv(b) ? `${b.productKey}|provisional` : b.productKey;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(b);
    }
    const nominalCount = new Map();
    for (const b of plans.nominal?.boards || []) nominalCount.set(b.productKey, (nominalCount.get(b.productKey) || 0) + 1);
    for (const [rowKey, boards] of [...byKey.entries()].sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))) {
      const productKey = rowKey.split('|')[0];
      const provisionalOnly = rowKey.endsWith('|provisional');
      const info = productInfo(productKey);
      // Special-order boards are bought only for required continuous runs — never as spare allowance.
      const eligible = boards.filter(b => !b.specialOrder && b.cuts.every(c => c.allowanceEligible !== false)).length;
      const allowanceQty = pct > 0 && eligible > 0 ? Math.ceil(eligible * pct / 100 - 1e-9) : 0;
      const pieceIds = boards.flatMap(b => b.cuts.map(c => c.pieceId));
      const qids = [...new Set(pieceIds.flatMap(id => pieceById.get(id)?.questionIds || []))];
      const provisional = pieceIds.some(id => pieceById.get(id)?.status === 'provisional');
      const notes = [];
      if (boards.some(b => b.specialOrder)) notes.push(`Special order: ${boards.filter(b => b.specialOrder).map(b => b.reason).filter(Boolean).join('; ')}`);
      const roles = new Map();
      for (const b of boards) { const r = [...new Set(b.cuts.map(c => pieceById.get(c.pieceId)?.role || 'piece'))].join(' + '); roles.set(r, (roles.get(r) || 0) + 1); }
      if (roles.size > 1) notes.push(`Boards: ${[...roles].map(([r, n]) => `${n} for ${r}`).join(', ')}.`);
      if (boards.some(b => b.specialOrder) && pct > 0) notes.push('No extra allowance on special-order boards.');
      if (allowanceQty) notes.push(`Extra ${pct}% lumber allowance on ${eligible} eligible board(s); trellis posts, headers and braces are not inflated.`);
      if (provisionalOnly) notes.unshift('Provisional boards — bought only once the open question is answered; kept separate from confirmed quantities.');
      rows.push({
        rowId: rowKey, productKey, provisionalOnly,
        name: provisionalOnly ? `${info.name} — provisional (${[...roles.keys()].join(', ')})` : info.name,
        category: 'lumber', groupKey,
        baseQty: boards.length, allowanceQty, totalQty: boards.length + allowanceQty, unit: 'board',
        nominalQty: provisionalOnly ? null : (nominalCount.get(productKey) ?? 0),
        packageSize: 1, packageUnit: 'board', specialOrder: !!info.specialOrder,
        status: provisional ? 'provisional' : 'ok', issues: qids, notes,
        requirementIds: [], boardIds: boards.map(b => b.id), pieceIds,
      });
    }
    // nominal-only lengths (shown for transparency with zero reviewed qty) are omitted from the buy list.
    if (plan.infeasible.length) {
      rows.push({
        productKey: `${groupKey}:unresolved`, name: `${LUMBER_GROUPS[groupKey]?.label || groupKey} — pieces with no feasible stock`,
        category: 'lumber', groupKey, baseQty: null, allowanceQty: 0, totalQty: null, unit: 'board', packageSize: 1, packageUnit: 'board',
        status: 'unresolved', issues: plan.infeasible.map(i => `q.infeasible:${i.pieceId}`), notes: plan.infeasible.map(i => `${i.label}: ${i.reason}`),
        requirementIds: [], boardIds: [], pieceIds: plan.infeasible.map(i => i.pieceId),
      });
    }
  }

  // ---- Non-lumber requirements ----
  const groups = new Map();
  for (const r of requirements) {
    if (/^lumber:/.test(r.productKey || '')) {
      const gk = r.productKey.split(':').slice(0, 3).join(':');
      if (lumberGroupsWithPieces.has(gk)) continue; // pieces are the source of truth — avoid double counting
    }
    const key = `${r.productKey}|${r.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const unitsByProduct = new Map();
  for (const k of groups.keys()) {
    const [pk, unit] = k.split('|');
    if (!unitsByProduct.has(pk)) unitsByProduct.set(pk, new Set());
    unitsByProduct.get(pk).add(unit);
  }
  for (const [key, reqs] of groups) {
    const [productKey, unit] = key.split('|');
    const info = { ...productInfo(productKey) };
    const gk = /^lumber:[^:]+:[^:]+$/.test(productKey) ? productKey : null;
    if (gk && LUMBER_GROUPS[gk]) info.name = `${LUMBER_GROUPS[gk].label} (stock length not yet determined)`;
    const issues = [...new Set(reqs.flatMap(r => r.questionIds || []))];
    const notes = [];
    let status = 'ok';
    for (const r of reqs) status = worseStatus(status, r.status === 'unresolved' ? 'unresolved' : r.status === 'provisional' ? 'provisional' : 'ok');
    const known = reqs.filter(r => r.qty != null && Number.isFinite(r.qty));
    const unknown = reqs.filter(r => !(r.qty != null && Number.isFinite(r.qty)));
    let baseExact = known.reduce((a, r) => a + r.qty, 0);
    if (unknown.length) {
      status = 'unresolved';
      notes.push(`Quantity incomplete: ${unknown.map(r => r.label || r.componentId).join(', ')} not yet quantifiable${known.length ? ` (known part: ${+baseExact.toFixed(3)} ${unit})` : ''}.`);
    }
    if (unitsByProduct.get(productKey).size > 1) {
      const qid = `q.units:${productKey}`;
      issues.push(qid);
      questions.push({ id: qid, type: 'product_spec', text: `${info.name} is required in different units (${[...unitsByProduct.get(productKey)].join(', ')}) — how is it purchased?`,
        componentIds: [...new Set(reqs.map(r => r.componentId))], productKeys: [productKey], provisional: 'Kept as separate rows.', status: 'open' });
      status = worseStatus(status, 'unresolved');
    }
    const base = unknown.length ? null : roundQty(baseExact, unit, rules);
    const allowanceEligible = reqs.every(r => r.allowanceEligible === true) && /^lumber:/.test(productKey);
    const allowanceQty = allowanceEligible && base > 0 ? Math.ceil(base * pct / 100 - 1e-9) : 0;
    if (base != null && Math.abs(base - baseExact) > EPS) notes.push(`Exact requirement ${+baseExact.toFixed(3)} ${unit}, rounded to ${base} ${unit} purchase.`);
    if (info.packageSize == null && base != null && rules?.assume?.packagesCoverCount) {
      notes.push(`Buy the box, roll or load size that covers ${base} ${unit}.`);
    } else if (info.packageSize == null && base != null) {
      const qid = `q.package:${productKey}`;
      issues.push(qid);
      questions.push({ id: qid, type: 'product_spec', text: `Which ${info.name} product/package should be bought? (${base} ${unit} needed)`,
        componentIds: [...new Set(reqs.map(r => r.componentId))], productKeys: [productKey], provisional: `Need shown in ${unit}; package count not calculated.`, status: 'open' });
      status = worseStatus(status, 'unresolved');
    }
    rows.push({
      productKey, name: info.name, category: info.category,
      baseQty: base, allowanceQty, totalQty: base == null ? null : Math.round((base + allowanceQty) * 1000) / 1000, unit,
      exactQty: known.length ? +baseExact.toFixed(4) : null,
      packageSize: info.packageSize ?? null, packageUnit: info.packageUnit ?? null,
      status, issues: [...new Set(issues)], notes,
      basis: [...new Set(reqs.map(r => r.basis))],
      requirementIds: reqs.map(r => r.id), boardIds: [], pieceIds: [],
    });
  }
  const catOrder = ['lumber', 'concrete', 'fastener', 'liner', 'trellis', 'soil', 'hardscape', 'drainage', 'planting', 'plants', 'disposal', 'other'];
  rows.sort((a, b) => (catOrder.indexOf(a.category) - catOrder.indexOf(b.category)) || 0);
  return { rows, questions };
}
