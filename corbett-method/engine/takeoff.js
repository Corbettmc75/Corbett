// Takeoff orchestrator: job → requirements, lumber pieces, questions, metrics, reconciliations.
// Pure and deterministic. Nothing is shared between jobs.
import { takeoff as bedTakeoff } from './components/bed.js';
import { takeoff as trellisTakeoff } from './components/trellis.js';
import { SITE_TAKEOFFS } from './components/site.js';
import { collector, round } from './components/util.js';
import { productInfo } from './products.js';

const CY = 27;

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(a, b) {
  const out = structuredClone(a);
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  return out;
}
function setPath(obj, dotted, value) {
  const parts = dotted.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts.at(-1)] = structuredClone(value);
}

/** Components in force for this scenario, with scenario patches and locked manual corrections applied. */
export function activeComponents(job, rules) {
  const scen = (job.scenarios || []).find(s => s.id === rules.scenarioId);
  const patches = scen?.overrides?.components || {};
  return (job.components || [])
    .filter(c => !c.excluded && (!c.scenarioId || c.scenarioId === rules.scenarioId))
    .map(c => {
      let comp = patches[c.id] ? deepMerge(c, patches[c.id]) : structuredClone(c);
      for (const cor of (job.corrections || []).filter(x => x.componentId === c.id && x.path)) {
        setPath(comp, cor.path, cor.value);
        comp.provenance = { ...(comp.provenance || {}), [cor.path]: { basis: 'manual', ref: cor.note || `Correction by ${cor.by ?? 'user'}`, confirmed: true } };
      }
      return comp;
    })
    .filter(c => !c.excluded);
}

function packStrips(segmentsIn, stripLenIn) {
  const strips = [];
  for (const s of [...segmentsIn].sort((a, b) => b - a)) {
    const st = strips.find(x => x.left + 1e-6 >= s);
    if (st) { st.left -= s; st.parts.push(s); } else strips.push({ left: stripLenIn - s, parts: [s] });
  }
  return strips;
}

export function buildTakeoff(job, rules) {
  const components = activeComponents(job, rules);
  const componentsById = Object.fromEntries(components.map(c => [c.id, c]));
  const ctx = { job, rules, components, componentsById, scope: job.scope || {} };
  const requirements = [], pieces = [], questions = [], metrics = {}, reconciliations = [];
  const add = (r) => { requirements.push(...r.requirements); pieces.push(...r.pieces); questions.push(...r.questions); };

  for (const comp of components) {
    let r;
    if (comp.type === 'bed') r = bedTakeoff(comp, ctx);
    else if (comp.type === 'trellis') r = trellisTakeoff(comp, ctx);
    else if (SITE_TAKEOFFS[comp.type]) r = SITE_TAKEOFFS[comp.type](comp, ctx);
    else { questions.push({ id: `q.type:${comp.id}`, type: 'construction_detail', text: `${comp.name}: no takeoff rule for type "${comp.type}".`, componentIds: [comp.id], productKeys: [], provisional: null, status: 'open' }); continue; }
    add(r);
    metrics[comp.id] = r.metrics;
  }

  const J = collector(null);
  const beds = components.filter(c => c.type === 'bed' && metrics[c.id]?.insideAreaSqFt != null);

  // ---- concrete (job level, rounded once) --------------------------------
  const n6 = pieces.filter(p => p.role === 'trellis-post').length;
  const n4 = pieces.filter(p => p.role === 'bed-post').length;
  const C = rules.concrete;
  if (n6) J.req({ id: '_job:concrete:6x6', productKey: C.productKey, qty: n6 * C.bagsPer6x6, unit: 'bag', role: 'footings-6x6', workPackage: 'wp3',
    formula: `${n6} installed 6×6 trellis posts × ${C.bagsPer6x6} bag`, refs: ['rule:concrete.bagsPer6x6'], allowanceEligible: false });
  if (n4) J.req({ id: '_job:concrete:4x4', productKey: C.productKey, qty: Math.ceil(n4 / C.fourByFoursPerBag), unit: 'bag', role: 'footings-4x4', workPackage: 'wp2',
    formula: `${n4} installed 4×4 bed posts ÷ ${C.fourByFoursPerBag}, rounded up`, refs: ['rule:concrete.fourByFoursPerBag'],
    status: pieces.some(p => p.role === 'bed-post' && p.status === 'provisional') ? 'provisional' : 'ok', allowanceEligible: false });

  // ---- liner rolls (job level) -------------------------------------------
  const L = rules.liner;
  const linerBeds = beds.filter(b => metrics[b.id].liner);
  if (linerBeds.length) {
    const stripH = Math.max(...linerBeds.map(b => metrics[b.id].liner.stripHeightIn));
    const rollW = L.rollWidthFt * 12, rollL = L.rollLengthFt * 12;
    const perRoll = Math.floor(rollW / stripH + 1e-9);
    const segs = linerBeds.flatMap(b => metrics[b.id].liner.segmentsIn);
    const strips = packStrips(segs, rollL);
    const rolls = Math.ceil(strips.length / perRoll);
    const unusedFullStrips = rolls * perRoll - strips.length;
    metrics._liner = { stripHeightIn: stripH, stripsPerRoll: perRoll, stripLengthIn: rollL, stripsUsed: strips.length, rolls,
      stripRemnantsIn: strips.map(s => round(s.left, 2)), unusedFullStrips, edgeSliverIn: round(rollW - perRoll * stripH, 3),
      layout: strips.map((s, i) => ({ strip: i + 1, piecesIn: s.parts.map(x => round(x, 2)), remnantIn: round(s.left, 2) })) };
    J.req({ id: '_job:liner', productKey: L.productKey, qty: rolls, unit: 'roll', role: 'liner', workPackage: 'wp4',
      formula: `${strips.length} wall strips (${round(stripH, 2)}" tall, ≤ ${L.rollLengthFt}' long) cut from ${perRoll} strips per ${L.rollWidthFt}×${L.rollLengthFt}' roll; walls only, no bottoms`,
      refs: ['rule:liner'], status: L.lapIn == null ? 'provisional' : 'ok', questionIds: L.lapIn == null ? ['q.liner-lap'] : [], allowanceEligible: false });
  }

  // ---- soil & compost: geometric calc vs confirmed allowances -------------
  const S = rules.soil;
  const allowances = (job.allowances || []).filter(a => a.confirmed !== false);
  const allowanceFor = (key) => allowances.find(a => a.productKey === key);
  const premCf = beds.reduce((s, b) => s + metrics[b.id].insideAreaSqFt * S.premiumTopIn / 12, 0);
  const basicCf = beds.reduce((s, b) => s + metrics[b.id].insideAreaSqFt * Math.max(0, (metrics[b.id].heightIn - S.premiumTopIn)) / 12, 0);
  const areaBasis = S.compostAreaBasis === 'outside' ? 'outsideAreaSqFt' : 'insideAreaSqFt';
  const compostArea = beds.reduce((s, b) => s + metrics[b.id][areaBasis], 0);
  const calc = {
    [S.basicKey]: { qty: basicCf / CY, unit: 'cy', label: 'Basic organic soil (below top 12")',
      formula: `Σ inside area × (bed height − ${S.premiumTopIn}") = ${round(basicCf, 2)} cu ft ÷ 27` },
    [S.premiumKey]: { qty: premCf / CY, unit: 'cy', label: 'Premium organic soil (top 12")',
      formula: `Σ inside area ${round(premCf * 12 / S.premiumTopIn, 2)} sq ft × ${S.premiumTopIn}" = ${round(premCf, 2)} cu ft ÷ 27` },
    [S.compostKey]: { qty: Math.ceil(compostArea / S.compostSqFtPerBag - 1e-9), unit: 'bag', label: 'Cow compost (1 cu ft bags)',
      formula: `${round(compostArea, 2)} sq ft (${S.compostAreaBasis} area) ÷ ${S.compostSqFtPerBag}, rounded up` },
  };
  if (beds.length) {
    if (S.compostAreaBasis === 'inside' && !job.answers?.['q.compost-area']) J.q({ id: 'q.compost-area', type: 'construction_detail',
      text: 'Compost "1 bag per 15 sq ft": inside soil area or outside bed footprint?', provisional: 'inside soil area' });
    for (const [key, cv] of Object.entries(calc)) {
      const al = allowanceFor(key);
      const shown = cv.unit === 'cy' ? Math.ceil(cv.qty / S.roundToCy - 1e-9) * S.roundToCy : cv.qty;
      if (al) {
        reconciliations.push({ id: `rec:${key}`, label: cv.label, confirmedQty: al.qty, calculatedQty: round(cv.qty, 3), calculatedRounded: shown, unit: cv.unit,
          basis: 'proposal vs geometry', note: `${cv.formula}. Proposal quantity kept. Settlement allowance: ${S.settlementPct == null ? 'not established' : S.settlementPct + '%'}; compost displacement not deducted.` });
      } else {
        J.req({ id: `_job:${key}`, productKey: key, qty: cv.unit === 'cy' ? round(cv.qty, 4) : cv.qty, unit: cv.unit, role: 'soil', workPackage: 'wp6',
          formula: cv.formula, refs: ['rule:soil'], allowanceEligible: false });
      }
    }
  }

  // ---- confirmed allowances win; component duplicates are reconciled -----
  for (const al of allowances) {
    const dup = requirements.filter(r => r.productKey === al.productKey);
    const dupQty = dup.reduce((s, r) => s + (r.qty ?? 0), 0);
    if (dup.length) {
      if (dupQty !== al.qty) reconciliations.push({ id: `rec:${al.productKey}`, label: productInfo(al.productKey).name, confirmedQty: al.qty, calculatedQty: dupQty,
        unit: al.unit, basis: 'proposal vs drawing', note: 'Proposal quantity kept.' });
      for (const d of dup) requirements.splice(requirements.indexOf(d), 1);
    }
    J.req({ id: `allowance:${al.id}`, productKey: al.productKey, qty: al.qty, unit: al.unit, role: 'allowance', componentId: al.componentId ?? null,
      label: productInfo(al.productKey).name, basis: 'proposal', formula: `Confirmed proposal quantity: ${al.source?.ref ?? ''}`,
      refs: [`proposal:${al.source?.ref ?? al.id}`], workPackage: al.productKey.startsWith('plant:') ? 'wp8' : al.productKey.startsWith('soil:') || al.productKey.startsWith('compost:') ? 'wp6' : 'wp8',
      allowanceEligible: false });
  }
  requirements.push(...J.requirements);
  questions.push(...J.questions);

  // ---- package-size questions for products without a defined package ----
  for (const r of requirements) {
    if (/^(lumber|assembly|disposal|irrigation|lighting):/.test(r.productKey ?? '')) continue;
    const info = productInfo(r.productKey);
    if (info.packageSize == null) {
      const qid = `q.pkg:${r.productKey}`;
      if (!r.questionIds.includes(qid)) r.questionIds.push(qid);
      questions.push({ id: qid, type: 'product_spec', text: `${info.name}: purchasable package/stock size?`, componentIds: r.componentId ? [r.componentId] : [], productKeys: [r.productKey], provisional: null, status: 'open' });
    }
  }

  // ---- dedupe questions, mark answered ---------------------------------
  const qmap = new Map();
  for (const q of questions) {
    const ex = qmap.get(q.id);
    if (ex) { ex.componentIds = [...new Set([...ex.componentIds, ...q.componentIds])]; ex.productKeys = [...new Set([...ex.productKeys, ...q.productKeys])]; }
    else qmap.set(q.id, { ...q, componentIds: [...q.componentIds], productKeys: [...q.productKeys] });
  }
  for (const q of qmap.values()) if (job.answers?.[q.id] != null) q.status = 'answered';
  // drop dangling question refs (e.g. q.pkg ids for products that do have a package size)
  for (const r of [...requirements, ...pieces]) r.questionIds = [...new Set(r.questionIds)].filter(id => qmap.has(id));

  metrics._job = {
    installed6x6: n6, installed4x4: n4,
    concreteBags: n6 * C.bagsPer6x6 + (n4 ? Math.ceil(n4 / C.fourByFoursPerBag) : 0),
    outsideAreaSqFt: round(beds.reduce((s, b) => s + metrics[b.id].outsideAreaSqFt, 0), 4),
    insideAreaSqFt: round(beds.reduce((s, b) => s + metrics[b.id].insideAreaSqFt, 0), 4),
  };
  return { requirements, pieces, questions: [...qmap.values()], metrics, reconciliations };
}
