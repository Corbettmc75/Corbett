import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPolygon, area, perimeter, insetPolygon, corners, opposingPairs } from '../engine/geometry.js';

const upperL = { kind: 'polygon', points: [[0,0],[7.5,0],[7.5,12],[5,12],[5,4],[0,4]] };
const mirroredL = { kind: 'polygon', points: [[0,0],[7.5,0],[7.5,4],[2.5,4],[2.5,12],[0,12]] };
const lowerL = { kind: 'polygon', points: [[4,0],[6.5,0],[6.5,12],[0,12],[0,8],[4,8]] };

test('L-shaped bed areas (no double-counted overlap)', () => {
  assert.equal(area(toPolygon(upperL)), 50);
  assert.equal(area(toPolygon(mirroredL)), 50);
  assert.equal(area(toPolygon(lowerL)), 46);
  assert.equal(area(toPolygon({ kind: 'rect', lengthFt: 20, widthFt: 2.5 })), 50);
});

test('clockwise input and rotation give the same area and perimeter', () => {
  const cw = { kind: 'polygon', points: [...upperL.points].reverse() };
  const rot = { kind: 'polygon', points: upperL.points.map(([x, y]) => [-y, x]) };
  for (const g of [cw, rot]) {
    assert.equal(area(toPolygon(g)), 50);
    assert.equal(perimeter(toPolygon(g)), 39);
  }
});

test('inset by wall thickness: rectangle and L', () => {
  const t = 1.5 / 12;
  assert.ok(Math.abs(area(insetPolygon(toPolygon({ kind: 'rect', lengthFt: 20, widthFt: 2.5 }), t)) - 19.75 * 2.25) < 1e-9);
  const inL = area(insetPolygon(toPolygon(upperL), t));
  assert.ok(inL < 50 && inL > 44, `inside L ${inL}`);
  // L: 50 − t·P + t²·(convex − reflex) = 50 − 4.875 + t²·4
  assert.ok(Math.abs(inL - (50 - t * 39 + t * t * 4)) < 1e-9);
});

test('corners classify the reflex corner of an L', () => {
  const cs = corners(toPolygon(upperL));
  assert.equal(cs.filter(c => c.convex).length, 5);
  assert.equal(cs.filter(c => c.reflex).length, 1);
});

test('opposing pairs counted once per facing pair', () => {
  const pairs = opposingPairs(toPolygon({ kind: 'rect', lengthFt: 8, widthFt: 5 }), 5);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].distanceFt, 5);
  const lp = opposingPairs(toPolygon(upperL), 5);
  assert.deepEqual(lp.map(p => [p.lengthAFt, p.distanceFt]).sort(), [[12, 2.5], [7.5, 4]].sort());
});
