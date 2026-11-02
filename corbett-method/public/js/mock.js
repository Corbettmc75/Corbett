// Offline mock backend — loaded ONLY when the URL has ?mock=1. Illustrative fixture for UI testing;
// numbers here are not engine output and must never be shown as a real estimate.
let version = 3;
const job = {
  id: 'job-mock', projectKey: 'mock', name: 'MOCK — Theresa & Anders', customer: 'Theresa Sorensen', address: '1521 Wakeman Ave, Wheaton', status: 'approved',
  sources: [{ id: 's1', fileId: null, kind: 'drawing', title: "Theresa's Garden & Backyard Oasis", revision: '9/18/26', date: '2026-09-18', pages: 1 }],
  scope: { irrigation: false, lighting: false, liner: true, trim: true }, settings: {},
  scenarios: [{ id: 'signed', name: 'Signed proposal — CedarTone', selected: true }, { id: 'alt-rough', name: 'Alternative — rough-sawn cedar', selected: false }],
  components: [
    { id: 'bed-upper', type: 'bed', name: 'Upper L bed', geometry: { kind: 'polygon', points: [[0,0],[7.5,0],[7.5,12],[5,12],[5,4],[0,4]] }, props: { courses: 5, heightIn: 27.5 }, provenance: { geometry: { basis: 'manual', ref: 'Reviewed', confirmed: true } } },
    { id: 'bed-center', type: 'bed', name: 'Center bed', geometry: { kind: 'polygon', points: [[0,0],[2.5,0],[2.5,20],[0,20]] }, props: { courses: 5, heightIn: 27.5 }, provenance: { geometry: { basis: 'drawing', ref: "20' × 2.5'" } } },
    { id: 'bed-lower', type: 'bed', name: 'Lower L bed', geometry: { kind: 'polygon', points: [[4,0],[6.5,0],[6.5,12],[0,12],[0,8],[4,8]] }, props: { courses: 5, heightIn: 27.5 }, provenance: { geometry: { basis: 'drawing', ref: 'Lower L' } } },
    { id: 'tr-upper', type: 'trellis', name: "Upper trellis (12')", geometry: { kind: 'line', lengthFt: 12 }, props: { bedId: 'bed-upper', edge: [[7.5,0],[7.5,12]], posts: 2 } },
    { id: 'tr-center', type: 'trellis', name: "Center trellis (20')", geometry: { kind: 'line', lengthFt: 20 }, props: { bedId: 'bed-center', edge: [[2.5,0],[2.5,20]], posts: 3 } },
    { id: 'tr-lower', type: 'trellis', name: "Lower trellis (12')", geometry: { kind: 'line', lengthFt: 12 }, props: { bedId: 'bed-lower', edge: [[6.5,0],[6.5,12]], posts: 2 } },
    { id: 'rock-dog', type: 'rock', name: 'Dog rock area', geometry: { kind: 'rect', lengthFt: 13, widthFt: 8 }, props: {}, provenance: { geometry: { basis: 'drawing', ref: "8'x13'" } } },
    { id: 'patio', type: 'patio', name: 'Beacon Hill patio', geometry: null, props: {}, notes: "19' labelled; width not dimensioned." },
  ],
  allowances: [], answers: {}, corrections: [], extractions: [], buildPlan: { packages: {} },
  actuals: { purchases: [], leftovers: [], costs: [] },
  costInputs: { taxRatePct: null, deliveryCents: null, disposalCents: null, laborHours: null, laborRateCents: null, contingencyPct: null, serviceCharges: [] },
  selling: { source: 'Estimate #20465 (signed) — customer selling price', totalCents: 4127688, lines: [{ activity: 'Custom CedarTone Box', description: '(3) boxes', cents: 885720 }] },
};
const board = (id, ft, cuts, so = false) => {
  const used = cuts.reduce((a, c) => a + c.lengthIn, 0); const saw = cuts.length * 0.125; const rem = ft * 12 - used - saw;
  return { id, productKey: `x:${ft}`, stockLengthFt: ft, specialOrder: so, cuts, sawLossIn: saw, offcutIn: rem, usableOffcutIn: rem >= 12 ? rem : 0, wasteIn: rem >= 12 ? 0 : rem, notes: [] };
};
const estimate = () => ({
  jobId: 'job-mock', version, scenarioId: 'signed',
  metrics: { 'bed-upper': { outsideAreaSqFt: 50, insideAreaSqFt: 45.3, perimeterFt: 39 }, 'bed-center': { outsideAreaSqFt: 50, insideAreaSqFt: 44.4, perimeterFt: 45 }, 'bed-lower': { outsideAreaSqFt: 46, insideAreaSqFt: 41.5, perimeterFt: 37 } },
  shopping: [
    { productKey: 'lumber:cedartone:6x6:12', name: 'CedarTone 6×6 × 12\'', category: 'lumber', baseQty: 7, allowanceQty: 0, totalQty: 7, unit: 'board', packageSize: 1, packageUnit: 'board', unitPriceCents: 5949, extendedCents: 41643, supplier: 'Menards Naperville', priceDate: '2026-02-19', status: 'ok', issues: [] },
    { productKey: 'lumber:cedartone:2x12:20', name: "CedarTone 2×12 × 20' (special order)", category: 'lumber', baseQty: 2, allowanceQty: 0, totalQty: 2, unit: 'board', packageSize: 1, packageUnit: 'board', unitPriceCents: 7499, extendedCents: 14998, supplier: 'Menards Naperville', priceDate: '2026-02-19', status: 'ok', issues: [] },
    { productKey: 'lumber:pt:4x4:8', name: "Pressure-treated 4×4 × 8'", category: 'lumber', baseQty: 17, allowanceQty: 3, totalQty: 20, unit: 'board', packageSize: 1, packageUnit: 'board', unitPriceCents: null, extendedCents: null, supplier: null, priceDate: null, status: 'missing_price', issues: ['q.price:lumber:pt:4x4:8'] },
    { productKey: 'soil:basic-organic', name: 'Basic organic garden soil', category: 'soil', baseQty: 8.5, allowanceQty: 0, totalQty: 8.5, unit: 'cy', packageSize: 0.25, packageUnit: 'cy', unitPriceCents: null, extendedCents: null, status: 'missing_price', issues: [] },
    { productKey: 'screw:deck:3in', name: '3" deck screws (package TBD)', category: 'fastener', baseQty: null, allowanceQty: 0, totalQty: null, unit: 'box', unitPriceCents: null, extendedCents: null, status: 'unresolved', issues: ['q.screw-rule'] },
  ],
  cutPlans: {
    'lumber:pt:4x4': { reviewed: { groupKey: 'lumber:pt:4x4', mode: 'reviewed', kerfIn: 0.125, endTrimIn: 0, proof: 'optimal', stats: { purchasedIn: 96 * 2, requiredIn: 96 },
      boards: [board('B-PT4-01', 8, [{ pieceId: 'p1', label: 'Upper L — corner post', lengthIn: 48 }]), board('B-PT4-02', 8, [{ pieceId: 'p2', label: 'Upper L — corner post', lengthIn: 48 }])],
      conflicts: [{ text: '48" + 48" + 1/8" kerf = 96 1/8" does not fit one 96" board.', suggestion: 'Shorten posts by 1/8" (embed 23 7/8") to get two per board — needs approval.' }], infeasible: [] },
      nominal: { groupKey: 'lumber:pt:4x4', mode: 'nominal', kerfIn: 0, proof: 'optimal', stats: { purchasedIn: 96, requiredIn: 96 }, boards: [board('N-PT4-01', 8, [{ label: 'post', lengthIn: 48 }, { label: 'post', lengthIn: 48 }])], conflicts: [], infeasible: [] } },
    'lumber:cedartone:2x12': { reviewed: { groupKey: 'lumber:cedartone:2x12', mode: 'reviewed', kerfIn: 0.125, proof: 'optimal', stats: { purchasedIn: 240, requiredIn: 240 },
      boards: [{ ...board('B-2x12-01', 20, [{ label: 'Center trellis — header A', lengthIn: 240 }], true), sawLossIn: 0, offcutIn: 0, usableOffcutIn: 0, wasteIn: 0, reason: 'Required continuous 20\' header' }], conflicts: [], infeasible: [] } },
  },
  unresolved: [
    { id: 'q.corner-rule', type: 'construction_detail', text: 'How are bed corners joined — butt (one wall through) or interlaced each course?', provisional: 'Nominal outside lengths used', status: 'open', componentIds: ['bed-upper'] },
    { id: 'q.patio-size', type: 'missing_dimension', text: 'Patio width is not dimensioned (19\' long side is). What is the width?', status: 'open', componentIds: ['patio'] },
    { id: 'q.price:lumber:pt:4x4:8', type: 'missing_price', text: 'No supplier price for pressure-treated 4×4×8\'.', productKeys: ['lumber:pt:4x4:8'], status: 'open' },
    { id: 'q.border', type: 'scope_conflict', text: 'Border: drawing says Courtstone (Basalt), signed proposal says Copthorne (Basalt). Which is being built?', status: 'open' },
    { id: 'q.mesh-panel', type: 'product_spec', text: 'Welded mesh coverage is known; what stock panel size will be bought?', status: 'open' },
  ],
  reconciliations: [{ id: 'r1', label: 'Basic organic soil', confirmedQty: 8.5, calculatedQty: 6.3, unit: 'cy', note: 'Inside area × 15.5" (below top 12")' }],
  costs: { materialsCents: null, materialsKnownCents: 56641, missingPriceCount: 3, taxCents: null, deliveryCents: null, disposalCents: null, laborCents: null, serviceChargesCents: null, contingencyCents: null, internalTotalCents: null, notes: ['Materials total incomplete — 3 items unpriced.'] },
  guides: [
    { id: 'wp1', title: '1. Layout, grade, site prep & demolition', steps: [{ id: 's1', text: 'Mark bed outlines from the plan; check diagonals.' }, { id: 's2', text: 'Find the high point; build from there.' }], supplies: [], boards: [], tools: ['Tape', 'String line', 'Level'], checks: ['Outlines match plan within 1/4"'] },
    { id: 'wp2', title: '2. Cut lumber & build beds', steps: [{ id: 's1', text: 'Cut boards per cutting guide.' }], supplies: [{ productKey: 'lumber:pt:4x4:8', name: 'PT 4×4 × 8\'', qty: 17, unit: 'board' }], boards: ['B-PT4-01', 'B-PT4-02'], tools: ['Miter saw', 'Drill/driver'], checks: ['Square (diagonals equal)', 'Level'] },
  ],
  audit: [{ productKey: 'lumber:cedartone:6x6:12', rowQty: 7, from: [{ componentId: 'tr-upper', basis: 'drawing', formula: '2 posts' }, { componentId: 'tr-center', basis: 'drawing', formula: '3 posts' }, { componentId: 'tr-lower', basis: 'drawing', formula: '2 posts' }] }],
});
let extractionPolls = 0;
export async function handle(method, path, body) {
  await new Promise(r => setTimeout(r, 120));
  const p = path.split('?')[0];
  if (p === '/api/me' || p === '/api/login') return { user: { username: 'corbett', name: 'Corbett', role: 'admin' }, csrf: 'mock' };
  if (p === '/api/logout') return {};
  if (p === '/api/jobs' && method === 'GET') return [{ id: job.id, name: job.name, customer: job.customer, status: job.status, version, updatedAt: new Date().toISOString(), updatedBy: 'Courtney' }];
  if (p === '/api/jobs' && method === 'POST') return { id: job.id };
  if (p === `/api/jobs/${job.id}` && method === 'GET') return { job: structuredClone(job), version, updatedAt: new Date().toISOString(), updatedBy: 'Corbett' };
  if (p === `/api/jobs/${job.id}` && method === 'PUT') { Object.assign(job, body.job); version++; return { version }; }
  if (p.endsWith('/estimate')) return estimate();
  if (p.endsWith('/analyze')) { extractionPolls = 0; return { extractionId: 'ex1' }; }
  if (p === '/api/extractions/ex1') { extractionPolls++; return extractionPolls < 3 ? { status: 'running', stage: 'extracting', progress: extractionPolls / 3 } : { status: 'done', proposal: { summary: { projectName: "Theresa's Garden & Backyard Oasis", revision: '9/18/26', source: 'ai' },
      items: [...job.components.slice(0, 6).map(c => ({ itemId: 'c-' + c.id, kind: 'component', confidence: c.id === 'bed-lower' ? 0.4 : 0.9, data: { type: c.type, name: c.name, geometry: c.geometry, provenance: c.provenance || {}, dimensionLabels: [{ text: "12'", describes: 'overall depth' }] } })),
        { itemId: 'e-1', kind: 'exclusion', data: { text: 'NO irrigation or lighting' } }, { itemId: 'n-1', kind: 'note', data: { text: 'Dimension label "24\'4\""', dimension: { text: "24'4\"" } } },
        ...estimate().unresolved.slice(0, 2).map(q => ({ itemId: 'q-' + q.id, kind: 'question', data: { type: q.type, text: q.text } }))] } }; }
  if (p.includes('/apply')) return { version };
  if (p === '/api/catalog' && method === 'GET') return [{ id: 'c1', productKey: 'lumber:cedartone:6x6:12', supplier: 'Menards', store: 'Naperville', spec: 'CedarTone 6×6 × 12\'', packageSize: 1, packageUnit: 'board', unitPriceCents: 5949, unitBasis: 'board', priceDate: '2026-02-19', priceType: 'material', source: { file: 'Menards sheet 2026-02-19' } },
    { id: 'c2', productKey: 'service:soil-install', supplier: 'Greenworks', spec: 'Soil — Greenworks column', unitPriceCents: 12500, unitBasis: 'cy', priceDate: '2025', priceType: 'service', notes: 'Service rate — not a material price', source: { file: 'GreenworksRates_2025' } }];
  if (p === '/api/standards') return { rules: { lumber: { kerfIn: 0.125, extraAllowancePct: 15 }, bed: { cornerRule: 'nominal', wallMaterial: 'cedartone' } } };
  if (p.endsWith('/revisions')) return [{ version: 1, updatedAt: '2026-10-30T14:00:00Z', updatedBy: 'Courtney' }, { version, updatedAt: new Date().toISOString(), updatedBy: 'Corbett' }];
  if (p.endsWith('/audit')) return [{ at: new Date().toISOString(), by: 'Corbett', action: 'answer', detail: 'q.corner-rule' }];
  return {};
}
export async function upload(path, file, onProgress) {
  for (let i = 1; i <= 5; i++) { await new Promise(r => setTimeout(r, 100)); onProgress?.(i / 5); }
  return { fileId: 'f1', pages: 1, kind: 'drawing' };
}
