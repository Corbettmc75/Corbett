import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTakeoff } from '../engine/takeoff.js';
import { resolveRules } from '../engine/rules.js';
import theresa from '../data/theresa-anders.seed.js';

const count = (arr, f) => arr.filter(f).length;
const bedJob = (geometry, extra = {}) => ({ id: 'j', projectKey: 'p', scope: { liner: false }, components: [
  { id: 'b', type: 'bed', name: 'Bed', geometry, props: { courses: 5, heightIn: 27.5, liner: false } }], ...extra });

test('5×8 bed, five courses: nominal ten 96" + ten 60"; interlaced reviewed 6×96, 4×93, 4×60, 6×57', () => {
  const job = bedJob({ kind: 'rect', lengthFt: 8, widthFt: 5 });
  const t = buildTakeoff(job, resolveRules(job));
  const walls = t.pieces.filter(p => p.role === 'wall');
  assert.equal(walls.length, 20);
  assert.equal(count(walls, p => p.nominalLengthIn === 96), 10);
  assert.equal(count(walls, p => p.nominalLengthIn === 60), 10);
  const by = (n) => count(walls, p => p.lengthIn === n);
  assert.deepEqual([by(96), by(93), by(60), by(57)], [6, 4, 4, 6]);
  assert.ok(!t.questions.some(q => q.id === 'q.corner-rule'), 'interlaced is confirmed — no corner-rule question');
  assert.ok(t.questions.some(q => q.id === 'q.interlace-start'), 'odd course count asks which walls start through');
});

test('nominal rule (if selected) keeps outside lengths and raises the corner question', () => {
  const job = bedJob({ kind: 'rect', lengthFt: 8, widthFt: 5 }, { settings: { 'bed.cornerRule': 'nominal' } });
  const t = buildTakeoff(job, resolveRules(job));
  assert.equal(count(t.pieces, p => p.role === 'wall' && p.lengthIn === 96), 10);
  assert.ok(t.questions.some(q => q.id === 'q.corner-rule'));
});

test('5×8 rectangle: 4 corner posts + 1 middle support (not one per wall), all PT 4x4 from 8\' stock', () => {
  const job = bedJob({ kind: 'rect', lengthFt: 8, widthFt: 5 });
  const t = buildTakeoff(job, resolveRules(job));
  const posts = t.pieces.filter(p => p.role === 'bed-post');
  assert.equal(posts.length, 5);
  assert.ok(posts.every(p => p.groupKey === 'lumber:pt:4x4' && p.lengthIn === 48 && JSON.stringify(p.allowedStockFt) === '[8]'));
  assert.equal(count(t.pieces, p => p.role === 'support-cross'), 1);
  assert.equal(t.pieces.find(p => p.role === 'support-cross').lengthIn, 57);
});

const rules = resolveRules(theresa);
const T = buildTakeoff(theresa, rules);

test('Theresa: outside area 146 sq ft, inside smaller', () => {
  assert.equal(T.metrics._job.outsideAreaSqFt, 146);
  assert.ok(T.metrics._job.insideAreaSqFt < 146);
  assert.equal(T.metrics['bed-upper'].outsideAreaSqFt, 50);
  assert.equal(T.metrics['bed-lower'].outsideAreaSqFt, 46);
  assert.equal(T.metrics['bed-center'].outsideAreaSqFt, 50);
});

test('Theresa: exactly 7 trellis posts (12\' stock), not inflated', () => {
  const posts = T.pieces.filter(p => p.role === 'trellis-post');
  assert.equal(posts.length, 7);
  assert.ok(posts.every(p => p.lengthIn === 125.5 && JSON.stringify(p.allowedStockFt) === '[12]' && p.allowanceEligible === false));
});

test('Theresa: headers are four 12\' and two 20\' continuous pieces, no 8\' headers', () => {
  const h = T.pieces.filter(p => p.role === 'trellis-header');
  assert.equal(h.length, 6);
  assert.equal(count(h, p => p.lengthIn === 144 && p.allowedStockFt[0] === 12), 4);
  assert.equal(count(h, p => p.lengthIn === 240 && p.allowedStockFt[0] === 20), 2);
  assert.equal(count(h, p => p.lengthIn === 96), 0);
  assert.ok(h.every(p => p.mustBeContinuous && !p.allowanceEligible));
});

test('Theresa: trellis end posts replace corner 4x4s; PT 4x4 only from 8\' stock', () => {
  assert.equal(T.metrics['bed-upper'].replacedCorners, 2);
  assert.equal(T.metrics['bed-center'].replacedCorners, 2);
  assert.equal(T.metrics['bed-lower'].replacedCorners, 2);
  assert.equal(T.metrics['bed-upper'].cornerPosts, 4);
  assert.equal(T.metrics['bed-center'].cornerPosts, 2);
  const pt = T.pieces.filter(p => p.groupKey === 'lumber:pt:4x4');
  assert.ok(pt.length > 0 && pt.every(p => JSON.stringify(p.allowedStockFt) === '[8]'));
});

test('Theresa: concrete = 7 (6x6) + ceil(4x4/2)', () => {
  const n4 = count(T.pieces, p => p.role === 'bed-post' || p.role === 'screen-post');
  const bags = T.requirements.filter(r => r.productKey === 'concrete:fast-set:50lb').reduce((s, r) => s + r.qty, 0);
  assert.equal(bags, 7 + Math.ceil(n4 / 2));
});

test('Theresa: soil, compost and plants keep confirmed proposal quantities; geometry reconciled separately', () => {
  const q = (k) => T.requirements.filter(r => r.productKey === k).reduce((s, r) => s + r.qty, 0);
  assert.equal(q('soil:basic-organic'), 8.5);
  assert.equal(q('soil:premium-organic'), 5.5);
  assert.equal(q('compost:cow:1cf'), 12);
  assert.equal(q('plant:karl-foerster'), 4);
  assert.equal(q('plant:allium'), 9);
  assert.equal(q('plant:quick-fire-hydrangea'), 4);
  for (const k of ['soil:basic-organic', 'soil:premium-organic', 'compost:cow:1cf'])
    assert.ok(T.reconciliations.some(r => r.id === `rec:${k}` && r.calculatedQty != null));
});

test('Theresa: no irrigation or lighting requirements', () => {
  assert.equal(count(T.requirements, r => /^(irrigation|lighting)/.test(r.productKey)), 0);
});

test('Theresa: unknowns are typed precisely (standard assumptions off)', () => {
  const raw = { ...theresa, settings: { useStandardAssumptions: false } };
  const T0 = buildTakeoff(raw, resolveRules(raw));
  const byId = Object.fromEntries(T0.questions.map(q => [q.id, q]));
  assert.equal(byId['q.patio-border'].type, 'scope_conflict');
  assert.equal(byId['q.rock-depth'].type, 'missing_dimension');
  assert.equal(byId['q.pkg:screw:deck:3in'].type, 'product_spec');
  assert.equal(byId['q.mesh-panel'].type, 'product_spec');
  assert.ok(!T0.questions.some(q => q.type === 'missing_price'));
  assert.equal(byId['q.brace-offcut'].type, 'construction_detail');
});

test('scenario: rough-sawn alternative changes wall pool only for that scenario', () => {
  const t2 = buildTakeoff(theresa, resolveRules(theresa, 'alt-rough'));
  assert.ok(t2.pieces.some(p => p.groupKey === 'lumber:rough-cedar:2x6'));
  assert.ok(!T.pieces.some(p => p.groupKey === 'lumber:rough-cedar:2x6'));
});

test('takeoff is deterministic and does not mutate the job', () => {
  const before = JSON.stringify(theresa);
  const a = JSON.stringify(buildTakeoff(theresa, rules));
  const b = JSON.stringify(buildTakeoff(theresa, rules));
  assert.equal(a, b);
  assert.equal(JSON.stringify(theresa), before);
});

test('locked manual corrections apply', () => {
  const job = { ...structuredClone(theresa), corrections: [{ id: 'c1', componentId: 'rock-dog', path: 'props.depthIn', value: 3, by: 'corbett', locked: true }] };
  const t = buildTakeoff(job, resolveRules(job));
  assert.ok(!t.questions.some(q => q.id === 'q.rock-depth'));
  assert.equal(t.metrics['rock-dog'].requiredCf, 26);
});
