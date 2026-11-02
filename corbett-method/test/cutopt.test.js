import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeGroup, fitsOn, compareObjectives } from '../engine/cutopt.js';
import { planLumber, consolidate } from '../engine/consolidate.js';
import { DEFAULT_RULES } from '../engine/rules.js';

const stock2x6 = [8, 10, 12, 16].map(f => ({ lengthFt: f, specialOrder: false, priceCents: null })).concat([{ lengthFt: 20, specialOrder: true, priceCents: null }]);
const mk = (prefix, n, len, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, lengthIn: len, nominalLengthIn: extra.nominal ?? len, label: `${prefix} ${i}`, componentId: extra.componentId || 'c1', allowedStockFt: extra.allowedStockFt ?? null, allowanceEligible: extra.allowanceEligible ?? true, groupKey: extra.groupKey || 'lumber:cedartone:2x6', workPackage: 'wp2' }));
const count = plan => plan.boards.reduce((m, b) => (m[b.stockLengthFt] = (m[b.stockLengthFt] || 0) + 1, m), {});

function assertPhysical(plan, kerf = 0.125) {
  for (const b of plan.boards) {
    const lens = b.cuts.map(c => c.lengthIn);
    assert.ok(fitsOn(b.stockLengthFt * 12, lens, kerf, plan.endTrimIn), `${b.id} overfilled: ${lens}`);
    assert.ok(b.offcutIn >= 0);
  }
}

test('5×8 bed, 5 courses: nominal procurement is 5×16\' + 5×10\'', () => {
  const pieces = [...mk('L', 10, 96), ...mk('S', 10, 60)];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'nominal' });
  assert.deepEqual(count(plan), { 16: 5, 10: 5 });
  assert.equal(plan.proof, 'optimal');
});

test('reviewed mode never places 96+96 on a 16\' board and reports the exact-fit conflict', () => {
  const pieces = [...mk('L', 10, 96), ...mk('S', 10, 60)];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed', kerfIn: 0.125 });
  assertPhysical(plan);
  for (const b of plan.boards) assert.ok(!(b.cuts.filter(c => c.lengthIn === 96).length >= 2 && b.stockLengthFt === 16));
  assert.ok(plan.conflicts.some(c => /96/.test(c.text)));
  assert.ok(!plan.boards.some(b => b.specialOrder), 'no special order to pack short pieces');
});

test('interlaced 5×8 reviewed pieces (6×96, 4×93, 4×60, 6×57) produce a physically feasible plan', () => {
  const pieces = [...mk('A', 6, 96, { nominal: 96 }), ...mk('B', 4, 93, { nominal: 96 }), ...mk('C', 4, 60, { nominal: 60 }), ...mk('D', 6, 57, { nominal: 60 })];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed' });
  assertPhysical(plan);
  assert.equal(plan.boards.reduce((a, b) => a + b.cuts.length, 0), 20);
  assert.ok(plan.stats.purchasedIn >= plan.stats.requiredIn);
  assert.ok(!plan.boards.some(b => b.specialOrder));
});

test('kerf: one 144" header fits a 12\' board exactly; 96+96 does not fit 192"', () => {
  assert.ok(fitsOn(144, [144], 0.125));
  assert.ok(!fitsOn(192, [96, 96], 0.125));
  assert.ok(fitsOn(192, [96, 96], 0));
});

test('7 trellis posts (125.5", 12\' only) → seven 12\' boards; 19" braces never cut from post offcuts', () => {
  const g = 'lumber:cedartone:6x6';
  const stock = [8, 10, 12].map(f => ({ lengthFt: f, specialOrder: false, priceCents: null }));
  const pieces = [...mk('P', 7, 125.5, { allowedStockFt: [12], allowanceEligible: false, groupKey: g }), ...mk('Y', 14, 19, { allowanceEligible: false, groupKey: g })];
  const plan = optimizeGroup({ groupKey: g, pieces, stock, mode: 'reviewed' });
  assertPhysical(plan);
  const postBoards = plan.boards.filter(b => b.cuts.some(c => c.lengthIn === 125.5));
  assert.equal(postBoards.length, 7);
  for (const b of postBoards) {
    assert.equal(b.stockLengthFt, 12);
    assert.equal(b.cuts.length, 1, 'brace must not share a post board (18.375" left)');
    assert.equal(b.offcutIn, 18.375);
  }
});

test('headers 4×144 + 2×240 → four 12\' + two 20\' special order, no 8\'', () => {
  const g = 'lumber:cedartone:2x12';
  const stock = [8, 10, 12, 16].map(f => ({ lengthFt: f, specialOrder: false, priceCents: null })).concat([{ lengthFt: 20, specialOrder: true, priceCents: 7499 }]);
  const pieces = [...mk('H12-', 4, 144, { groupKey: g, allowanceEligible: false }), ...mk('H20-', 2, 240, { groupKey: g, allowanceEligible: false })];
  const plan = optimizeGroup({ groupKey: g, pieces, stock, mode: 'reviewed' });
  assert.deepEqual(count(plan), { 12: 4, 20: 2 });
  const sp = plan.boards.filter(b => b.specialOrder);
  assert.equal(sp.length, 2);
  assert.ok(sp.every(b => b.reason && /continuous/.test(b.reason)));
  for (const b of sp) assert.equal(b.cuts.length, 1, 'continuous 240" header kept whole');
});

test('pieces ≤ 192" never trigger special order', () => {
  const pieces = [...mk('X', 9, 190), ...mk('Y', 7, 50)];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed' });
  assert.ok(!plan.boards.some(b => b.specialOrder));
  assertPhysical(plan);
});

test('special-order offcut is reused: 230" + 9" share one 20\' board', () => {
  const pieces = [...mk('LONG', 1, 230), ...mk('SHORT', 1, 9, { componentId: 'c2' })];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed' });
  assert.equal(plan.boards.length, 1);
  assert.equal(plan.boards[0].stockLengthFt, 20);
  assert.equal(plan.boards[0].cuts.length, 2);
});

test('piece longer than every stock length is infeasible, never spliced', () => {
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces: mk('Z', 1, 250), stock: stock2x6, mode: 'reviewed' });
  assert.equal(plan.boards.length, 0);
  assert.equal(plan.infeasible.length, 1);
  assert.match(plan.infeasible[0].reason, /Splicing is not allowed/);
});

test('PT 4×4 48" posts (8\' only) → only 8\' boards and exact-fit conflict', () => {
  const g = 'lumber:pt:4x4';
  const plan = optimizeGroup({ groupKey: g, pieces: mk('P', 5, 48, { allowedStockFt: [8], groupKey: g }), stock: [{ lengthFt: 8, specialOrder: false, priceCents: null }], mode: 'reviewed' });
  assert.ok(plan.boards.every(b => b.stockLengthFt === 8));
  assert.equal(plan.boards.length, 5);
  assert.ok(plan.conflicts.length >= 1);
  assert.match(plan.conflicts[0].text, /96\.125/);
});

test('compatible offcuts are reused across components', () => {
  const pieces = [...mk('A', 1, 100, { componentId: 'bedA' }), ...mk('B', 1, 90, { componentId: 'bedB' })];
  const plan = optimizeGroup({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed' });
  assert.equal(plan.boards.length, 1);
  assert.deepEqual(new Set(plan.boards[0].cuts.map(c => c.componentId)), new Set(['bedA', 'bedB']));
});

test('incompatible materials are never pooled', () => {
  const pieces = [...mk('CT', 1, 90, { groupKey: 'lumber:cedartone:2x6' }), ...mk('RC', 1, 90, { groupKey: 'lumber:rough-cedar:2x6' })];
  const { cutPlans } = planLumber(pieces, DEFAULT_RULES, []);
  assert.equal(cutPlans['lumber:cedartone:2x6'].reviewed.boards.length, 1);
  assert.equal(cutPlans['lumber:rough-cedar:2x6'].reviewed.boards.length, 1);
  const { rows } = consolidate({ cutPlans, rules: DEFAULT_RULES, pieces });
  assert.ok(rows.some(r => r.productKey.startsWith('lumber:cedartone:2x6')));
  assert.ok(rows.some(r => r.productKey.startsWith('lumber:rough-cedar:2x6')));
  for (const r of rows) for (const pid of r.pieceIds) assert.equal(pieces.find(p => p.id === pid).groupKey, r.groupKey);
});

test('extra allowance is shown separately and excludes non-eligible boards', () => {
  const pieces = [...mk('W', 10, 180), ...mk('P', 3, 125.5, { allowanceEligible: false })];
  const { cutPlans } = planLumber(pieces, DEFAULT_RULES, []);
  const { rows } = consolidate({ cutPlans, rules: DEFAULT_RULES, pieces });
  const r16 = rows.find(r => r.productKey === 'lumber:cedartone:2x6:16');
  assert.equal(r16.baseQty, 10);
  assert.equal(r16.allowanceQty, 2); // ceil(10 × 15%)
  const r12 = rows.find(r => r.productKey === 'lumber:cedartone:2x6:12');
  assert.equal(r12.allowanceQty, 0);
});

test('compareObjectives only uses cost when all prices are known', () => {
  const pieces = mk('Q', 4, 70);
  const res = compareObjectives({ groupKey: 'lumber:cedartone:2x6', pieces, stock: stock2x6, mode: 'reviewed' });
  assert.equal(res.cost, null);
});
