// Acceptance: Theresa & Anders (drawing 9/18/26 + signed estimate #20465).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateJob } from '../engine/estimate.js';
import { shoppingCsv, cutListCsv, jobPackHtml } from '../engine/exports.js';
import seed from '../data/theresa-anders.seed.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url)));
const OPTS = { catalog, generatedAt: 'fixed' };
const est = estimateJob(seed, OPTS);
const row = key => est.shopping.find(r => r.productKey === key && !r.provisionalOnly);
const rows = prefix => est.shopping.filter(r => r.productKey.startsWith(prefix));

test('seven installed 6×6 trellis posts → seven post boards, no 15% inflation', () => {
  const plan = est.cutPlans['lumber:cedartone:6x6'].reviewed;
  const postBoards = plan.boards.filter(b => b.cuts.some(c => est.pieces.find(p => p.id === c.pieceId)?.role === 'trellis-post'));
  assert.equal(postBoards.length, 7);
  assert.ok(postBoards.every(b => b.stockLengthFt === 12 && b.cuts.length === 1));
  for (const r of rows('lumber:cedartone:6x6')) assert.equal(r.allowanceQty, 0);
  const posts = est.pieces.filter(p => p.role === 'trellis-post');
  assert.equal(posts.length, 7);
  // The confirmed 6×6×12 shopping row reads exactly 7; provisional brace boards live in a separate row.
  assert.equal(row('lumber:cedartone:6x6:12').totalQty, 7);
  const prov = est.shopping.filter(r => r.provisionalOnly && r.groupKey === 'lumber:cedartone:6x6');
  assert.ok(prov.every(r => r.status === 'provisional' && r.allowanceQty === 0));
});

test('headers: exactly four 12\' and two 20\' 2×12, no 8\' header allowance', () => {
  const r = rows('lumber:cedartone:2x12');
  assert.deepEqual(Object.fromEntries(r.map(x => [x.productKey, x.totalQty])), {
    'lumber:cedartone:2x12:20': 2, 'lumber:cedartone:2x12:12': 4,
  });
  assert.ok(r.every(x => x.allowanceQty === 0));
  assert.equal(row('lumber:cedartone:2x12:8'), undefined);
});

test('special order only for continuous runs > 16\' and kept continuous', () => {
  for (const [, plans] of Object.entries(est.cutPlans)) {
    for (const b of plans.reviewed.boards.filter(b => b.specialOrder)) {
      assert.ok(b.cuts.some(c => c.lengthIn > 192), `${b.id} special order without a >16' piece`);
      assert.ok(b.reason);
    }
    for (const b of plans.reviewed.boards) for (const c of b.cuts) assert.ok(c.lengthIn <= b.stockLengthFt * 12);
  }
  const sp = rows('lumber:').filter(r => r.specialOrder);
  assert.ok(sp.every(r => r.allowanceQty === 0), 'no spare special-order boards');
});

test('PT 4×4 bought only as 8\' stock', () => {
  const pt = rows('lumber:pt:4x4');
  assert.ok(pt.length >= 1);
  assert.ok(pt.every(r => r.productKey === 'lumber:pt:4x4:8'));
});

test('every reviewed board is physically feasible with kerf', () => {
  for (const plans of Object.values(est.cutPlans)) {
    const k = plans.reviewed.kerfIn;
    for (const b of plans.reviewed.boards) {
      const need = b.cuts.reduce((a, c) => a + c.lengthIn, 0) + k * (b.cuts.length - 1) + plans.reviewed.endTrimIn;
      assert.ok(need <= b.stockLengthFt * 12 + 1e-6, `${b.id}: ${need}`);
    }
  }
});

test('incompatible materials are never pooled', () => {
  for (const [gk, plans] of Object.entries(est.cutPlans))
    for (const b of plans.reviewed.boards) for (const c of b.cuts)
      assert.equal(est.pieces.find(p => p.id === c.pieceId).groupKey, gk);
});

test('soil 8.5 and 5.5 cy, compost 12, plants 4/9/4 preserved', () => {
  assert.equal(row('soil:basic-organic').totalQty, 8.5);
  assert.equal(row('soil:basic-organic').unit, 'cy');
  assert.equal(row('soil:premium-organic').totalQty, 5.5);
  assert.equal(row('soil:premium-organic').unit, 'cy');
  assert.equal(row('compost:cow:1cf').totalQty, 12);
  assert.equal(row('plant:karl-foerster').totalQty, 4);
  assert.equal(row('plant:allium').totalQty, 9);
  assert.equal(row('plant:quick-fire-hydrangea').totalQty, 4);
  // soil has no material price → unknown, not priced from Greenworks service rate
  assert.equal(row('soil:basic-organic').unitPriceCents, null);
});

test('no irrigation or lighting purchases', () => {
  assert.ok(!est.shopping.some(r => /irrigation|drip|valve|lighting|light|transformer|hunter|protrade/i.test(`${r.productKey} ${r.name}`)));
  assert.equal(est.guides.find(g => g.id === 'wp5').status, 'not-in-scope');
});

test('missing prices stay null; supplied prices populate exact products', () => {
  for (const r of est.shopping) {
    if (r.unitPriceCents == null) assert.equal(r.extendedCents, null);
    assert.notEqual(r.unitPriceCents, 0);
  }
  assert.equal(row('lumber:cedartone:2x12:20').unitPriceCents, 7499);
  assert.equal(row('lumber:cedartone:2x12:12').unitPriceCents, 3839);
  assert.equal(row('lumber:pt:4x4:8').unitPriceCents, null);
});

test('cost totals equal the sum of priced rows; selling price separate', () => {
  const sum = est.shopping.reduce((a, r) => a + (r.extendedCents ?? 0), 0);
  assert.equal(est.costs.materialsKnownCents, sum);
  assert.equal(est.costs.materialsCents, null); // some prices unknown
  assert.equal(est.costs.sellingPriceCents, 4127688);
  assert.notEqual(est.costs.materialsKnownCents, est.costs.sellingPriceCents);
});

test('shopping list, CSV export and daily supplies agree', () => {
  const csv = shoppingCsv(est).trim().split('\r\n').slice(1);
  assert.equal(csv.length, est.shopping.length);
  const supplyTotals = new Map();
  for (const g of est.guides) for (const s of g.supplies) supplyTotals.set(s.productKey, s.qty == null ? null : (supplyTotals.get(s.productKey) ?? 0) + s.qty);
  const shopTotals = new Map();
  for (const r of est.shopping) if (r.totalQty != null) shopTotals.set(r.productKey, (shopTotals.get(r.productKey) ?? 0) + r.totalQty);
  for (const [k, q] of shopTotals) assert.ok(Math.abs((supplyTotals.get(k) ?? -1) - q) < 1e-9, `guides vs shopping for ${k}`);
  assert.ok(csv.some(l => l.includes('8.5')));
  assert.ok(cutListCsv(est).includes('B-2x12-'));
  const html = jobPackHtml(est, seed);
  assert.ok(html.startsWith('<!doctype html>'));
});

test('exports escape untrusted drawing text', () => {
  const evil = structuredClone(seed);
  evil.id = 'evil'; evil.name = '<script>alert(1)</script>';
  evil.components.find(c => c.id === 'bed-center').name = '=HYPERLINK("x")<img src=x onerror=1>';
  const e2 = estimateJob(evil, OPTS);
  const html = jobPackHtml(e2, evil);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!/(^|,)=HYPERLINK/m.test(cutListCsv(e2)));
});

test('estimate is pure; answers drive rules; corrections persist', () => {
  const before = JSON.stringify(seed);
  const again = estimateJob(seed, OPTS);
  assert.equal(JSON.stringify(seed), before);
  assert.deepEqual(again.shopping, est.shopping);
  const answered = structuredClone(seed);
  answered.answers = { 'q.braces-per-post': { value: 2, by: 'corbett' } };
  const e3 = estimateJob(answered, OPTS);
  assert.ok(!e3.unresolved.some(q => q.id === 'q.braces-per-post'));
});

test('cross-project isolation: no leakage between jobs', () => {
  const other = structuredClone(seed);
  other.id = 'job-other'; other.projectKey = 'rodenbostel-test'; other.name = 'Other';
  other.components = [{ id: 'b1', type: 'bed', name: 'Bed', geometry: { kind: 'rect', lengthFt: 8, widthFt: 4 }, props: { courses: 5, heightIn: 27.5, liner: false, trim: false }, provenance: {} }];
  other.allowances = []; other.selling = null;
  const aloneOther = estimateJob(other, OPTS);
  const a1 = estimateJob(seed, OPTS);
  const o2 = estimateJob(other, OPTS);
  assert.deepEqual(o2.shopping, aloneOther.shopping);
  assert.deepEqual(a1.shopping, est.shopping);
  assert.ok(!o2.shopping.some(r => r.productKey.startsWith('plant:') || r.productKey.startsWith('soil:') && r.totalQty === 8.5));
  assert.ok(!o2.shopping.some(r => r.productKey.includes('2x12')));
  other.components[0].geometry.lengthFt = 99;
  assert.deepEqual(estimateJob(seed, OPTS).shopping, est.shopping);
});

test('unresolved questions are specific and typed (standard assumptions off)', () => {
  const raw = estimateJob({ ...seed, settings: { ...seed.settings, useStandardAssumptions: false } }, OPTS);
  const types = new Set(raw.unresolved.map(q => q.type));
  assert.ok(types.has('scope_conflict'));
  assert.ok(types.has('product_spec'));
  for (const q of raw.unresolved) { assert.ok(q.text.length > 10); assert.ok(!/need measurements/i.test(q.text)); }
  assert.ok(raw.unresolved.some(q => /Courtstone|Copthorne/.test(q.text)));
  assert.ok(raw.priceGaps.length > 0, 'missing prices are listed, not asked');
});

test('with standard assumptions, Corbett is asked nothing and every assumption is listed', () => {
  assert.equal(est.unresolved.length, 0, est.unresolved.map(q => q.id).join(', '));
  assert.ok(est.assumptions.some(a => a.key === 'border' && /Copthorne/.test(a.text)));
  // Missing prices stay unknown (never zero) and are shown on the shopping list.
  for (const r of est.shopping) if (r.unitPriceCents == null) assert.equal(r.extendedCents ?? null, null);
  // Every site item now has a quantity.
  const none = est.shopping.filter(r => r.totalQty == null).map(r => r.productKey);
  assert.deepEqual(none, []);
});
