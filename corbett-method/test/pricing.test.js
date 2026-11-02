import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchPrice, priceRows } from '../engine/pricing.js';
import { computeCosts } from '../engine/costs.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url)));

test('CedarTone 2×6×16 → $22.29 Menards 2026-02-19', () => {
  const m = matchPrice('lumber:cedartone:2x6:16', catalog, 'board');
  assert.equal(m.unitPriceCents, 2229);
  assert.equal(m.supplier, 'Menards');
  assert.equal(m.priceDate, '2026-02-19');
});

test('PT 4×4 has no price → null with a missing_price question, never zero', () => {
  const { rows, questions } = priceRows([{ productKey: 'lumber:pt:4x4:8', name: 'PT 4×4 × 8\'', unit: 'board', totalQty: 9, status: 'ok', category: 'lumber' }], catalog);
  assert.equal(rows[0].unitPriceCents, null);
  assert.equal(rows[0].extendedCents, null);
  assert.equal(rows[0].status, 'missing_price');
  assert.equal(questions[0].id, 'q.price:lumber:pt:4x4:8');
  assert.equal(questions[0].type, 'missing_price');
});

test('2×12 smooth cedar 10\' has no price (dash in source)', () => {
  assert.equal(matchPrice('lumber:smooth-cedar:2x12:10', catalog, 'board').unitPriceCents, null);
  assert.equal(matchPrice('lumber:smooth-cedar:2x12:12', catalog, 'board').unitPriceCents, 18564);
});

test('Greenworks soil service rates never price soil rows', () => {
  const { rows } = priceRows([{ productKey: 'soil:basic-organic', name: 'Basic soil', unit: 'cy', totalQty: 8.5, status: 'ok', category: 'soil' }], catalog);
  assert.equal(rows[0].unitPriceCents, null);
  assert.ok(rows[0].notes.some(n => /service rate|not a material/.test(n)));
  // even an entry keyed exactly to the product but typed 'service' is ignored
  const fake = [{ productKey: 'soil:basic-organic', priceType: 'service', unitPriceCents: 12500, unitBasis: 'cy', supplier: 'Greenworks' }];
  assert.equal(matchPrice('soil:basic-organic', fake, 'cy').unitPriceCents, null);
});

test('price matches only identical product key and unit basis', () => {
  const cat = [{ productKey: 'soil:basic-organic', priceType: 'material', unitPriceCents: 4000, unitBasis: 'bag', supplier: 'X', priceDate: '2026-01-01' }];
  assert.equal(matchPrice('soil:basic-organic', cat, 'cy').unitPriceCents, null);
  assert.equal(matchPrice('lumber:cedartone:2x6', catalog, 'board').unitPriceCents, null);
});

test('costs: selling price separate; missing prices keep material total unknown', () => {
  const rows = [{ extendedCents: 1000 }, { extendedCents: null }];
  const c = computeCosts(rows, { selling: { totalCents: 4127688 }, costInputs: {} });
  assert.equal(c.materialsCents, null);
  assert.equal(c.materialsKnownCents, 1000);
  assert.equal(c.sellingPriceCents, 4127688);
  assert.equal(c.internalTotalCents, null);
  assert.equal(c.taxCents, null);
});
