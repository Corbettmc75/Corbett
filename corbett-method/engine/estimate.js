// Orchestrator: job → full Estimate. Pure: never mutates the input job.
import { resolveRules } from './rules.js';
import { buildTakeoff } from './takeoff.js';
import { planLumber, consolidate } from './consolidate.js';
import { priceRows } from './pricing.js';
import { computeCosts } from './costs.js';
import { buildGuides } from './guides.js';
import { productName } from './products.js';

const EXCLUDED_BY_SCOPE = { irrigation: /^(irrigation|drip|valve|poly)[:]/, lighting: /^(lighting|light|transformer|cable)[:]/ };

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function setPath(obj, path, value) {
  const parts = String(path).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = value;
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

/** Build the effective job view for one scenario: overrides + locked manual corrections + scope. */
export function effectiveJob(job, scenarioId = null) {
  const j = structuredClone(job);
  const scen = (j.scenarios || []).find(s => scenarioId ? s.id === scenarioId : s.selected) || null;
  const activeId = scen?.id ?? null;
  j.components = (j.components || []).filter(c => !c.excluded && (c.scenarioId == null || c.scenarioId === activeId));
  for (const [id, patch] of Object.entries(scen?.overrides?.components || {})) {
    const c = j.components.find(x => x.id === id);
    if (c) deepMerge(c, patch);
  }
  for (const corr of j.corrections || []) {
    const c = j.components.find(x => x.id === corr.componentId);
    if (c && corr.path) setPath(c, corr.path, corr.value);
  }
  if (!j.scope?.irrigation) j.components = j.components.filter(c => c.type !== 'irrigation');
  if (!j.scope?.lighting) j.components = j.components.filter(c => c.type !== 'lighting');
  return { job: j, scenario: scen };
}

export function estimateJob(job, { catalog = [], standards = null, scenarioId = null, generatedAt = null, timeLimitMs = 10000, nodeLimit = 150000 } = {}) {
  const { job: view, scenario } = effectiveJob(job, scenarioId);
  const rules = resolveRules(view, scenario?.id ?? null, standards);
  const take = buildTakeoff(view, rules) || {};
  let requirements = [...(take.requirements || [])];
  const pieces = [...(take.pieces || [])];
  const reconciliations = [...(take.reconciliations || [])];
  const questions = [...(take.questions || [])];

  // Scope: excluded systems never reach the purchase list.
  requirements = requirements.filter(r => !((!view.scope?.irrigation && EXCLUDED_BY_SCOPE.irrigation.test(r.productKey)) ||
                                            (!view.scope?.lighting && EXCLUDED_BY_SCOPE.lighting.test(r.productKey))));

  // Confirmed proposal allowances are the purchase quantity; calculated values become reconciliations.
  for (const al of (view.allowances || []).filter(a => a.confirmed)) {
    const calc = requirements.filter(r => r.productKey === al.productKey && r.basis !== 'proposal');
    const fromProposal = requirements.filter(r => r.productKey === al.productKey && r.basis === 'proposal');
    if (calc.length) {
      const calcQty = calc.every(r => r.qty != null) ? +calc.reduce((a, r) => a + r.qty, 0).toFixed(3) : null;
      if (!reconciliations.some(x => x.productKey === al.productKey || x.id === `rec:${al.productKey}`)) {
        reconciliations.push({ id: `rec:${al.productKey}`, productKey: al.productKey, label: productName(al.productKey),
          confirmedQty: al.qty, calculatedQty: calcQty, unit: al.unit, basis: 'calculation',
          note: 'Confirmed proposal quantity is purchased; geometric recalculation shown for reconciliation only.' });
      }
      requirements = requirements.filter(r => !calc.includes(r));
    }
    if (!fromProposal.length) {
      requirements.push({ id: `req:${al.id}`, productKey: al.productKey, qty: al.qty, unit: al.unit, componentId: al.componentId,
        label: productName(al.productKey), role: 'proposal allowance', basis: 'proposal', formula: `Confirmed: ${al.qty} ${al.unit}`,
        refs: [`proposal:${al.source?.ref || ''}`], status: 'ok', questionIds: [],
        workPackage: /^soil:|^compost:/.test(al.productKey) ? 'wp6' : /^plant:/.test(al.productKey) ? 'wp8' : 'wp1',
        allowanceEligible: false });
    }
  }

  const { cutPlans, questions: lq } = planLumber(pieces, rules, catalog, { timeLimitMs, nodeLimit });
  const { rows: unpriced, questions: cq } = consolidate({ requirements, cutPlans, rules, pieces });
  const { rows: shopping, questions: pq } = priceRows(unpriced, catalog);
  // Exact-fit conflicts become questions only for stock-restricted pieces (e.g. PT posts from 8' only),
  // where the restriction forces the waste. Others stay visible in the cutting guide.
  const pieceMap = new Map(pieces.map(p => [p.id, p]));
  for (const [gk, plans] of Object.entries(cutPlans)) {
    const restricted = (plans.reviewed.conflicts || []).filter(c => c.pieceIds.every(id => pieceMap.get(id)?.allowedStockFt?.length));
    if (restricted.length) {
      questions.push({ id: `q.exact-fit:${gk}`, type: 'construction_detail',
        text: restricted.map(c => `${c.text} ${c.suggestion}`).join(' '),
        componentIds: [...new Set(restricted.flatMap(c => c.pieceIds.map(id => pieceMap.get(id)?.componentId)).filter(Boolean))],
        productKeys: [], provisional: 'Planned with kerf: one piece per board where they cannot pair.', status: 'open' });
    }
  }

  // Questions: dedupe, drop answered.
  const answered = id => { const a = job.answers?.[id]; return a && a.value !== undefined && a.value !== null && a.value !== ''; };
  const qmap = new Map();
  for (const q of [...questions, ...lq, ...cq, ...pq]) {
    if (!q?.id || answered(q.id)) continue;
    const prev = qmap.get(q.id);
    if (prev) {
      prev.componentIds = [...new Set([...(prev.componentIds || []), ...(q.componentIds || [])])];
      prev.productKeys = [...new Set([...(prev.productKeys || []), ...(q.productKeys || [])])];
    } else qmap.set(q.id, { status: 'open', componentIds: [], productKeys: [], ...q });
  }
  const typeOrder = ['scope_conflict', 'missing_dimension', 'construction_detail', 'product_spec', 'missing_price'];
  const unresolved = [...qmap.values()].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

  // Audit trail row → requirements / boards / pieces.
  const reqById = new Map(requirements.map(r => [r.id, r]));
  const pieceById = new Map(pieces.map(p => [p.id, p]));
  const audit = shopping.map(row => ({
    rowId: row.rowId || row.productKey, productKey: row.productKey, rowQty: row.totalQty,
    from: [
      ...(row.requirementIds || []).map(id => { const r = reqById.get(id); return r && { requirementId: id, componentId: r.componentId, qty: r.qty, unit: r.unit, basis: r.basis, ref: (r.refs || []).join('; '), formula: r.formula }; }),
      ...(row.boardIds || []).map(bid => {
        const plan = cutPlans[row.groupKey]?.reviewed; const b = plan?.boards.find(x => x.id === bid);
        return b && { boardId: bid, cuts: b.cuts.map(c => { const p = pieceById.get(c.pieceId); return { pieceId: c.pieceId, componentId: c.componentId, lengthIn: c.lengthIn, label: c.label, role: p?.role }; }) };
      }),
    ].filter(Boolean),
    allowance: row.allowanceQty ? `+${row.allowanceQty} extra allowance (${rules.lumber?.extraAllowancePct}% rule)` : null,
  }));

  const est = {
    jobId: job.id, version: job.version ?? null, scenarioId: scenario?.id ?? null, scenarioName: scenario?.name ?? null,
    generatedAt: generatedAt ?? new Date().toISOString(),
    rulesHash: fnv1a(JSON.stringify(rules)), rules,
    metrics: take.metrics || {}, requirements, pieces, cutPlans, shopping,
    unresolved, reconciliations, audit,
  };
  est.costs = computeCosts(shopping, view, rules);
  est.guides = buildGuides(est, view);
  return est;
}

export default estimateJob;
