import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupPrice, extractJsonLdOffers } from '../server/pricelookup.js';

const env = { PRICE_LOOKUP_HOSTS: 'www.menards.com' };
const page = (ld) => ({ ok: true, status: 200, text: async () => `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>` });

test('lookup disabled by default: no request made, no price', async () => {
  let called = false;
  const r = await lookupPrice({ url: 'https://www.menards.com/p/x', productKey: 'k' }, { env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(r.ok, false); assert.equal(called, false); assert.equal(r.candidate, undefined);
});
test('non-allowed host refused', async () => {
  const r = await lookupPrice({ url: 'https://evil.example/p', productKey: 'k' }, { env, fetchImpl: async () => page({}) });
  assert.equal(r.ok, false);
});
test('network failure reported, never a number', async () => {
  const r = await lookupPrice({ url: 'https://www.menards.com/p', productKey: 'k' }, { env, fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(r.ok, false); assert.match(r.error, /unchanged/);
});
test('page without JSON-LD price → failure, not a guessed price', async () => {
  const r = await lookupPrice({ url: 'https://www.menards.com/p', productKey: 'k' }, { env, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>$22.29</p>' }) });
  assert.equal(r.ok, false);
});
test('JSON-LD offer yields dated candidate with URL', async () => {
  const r = await lookupPrice({ url: 'https://www.menards.com/p/2x6', productKey: 'lumber:cedartone:2x6:16' },
    { env, now: () => new Date('2026-11-02T12:00:00Z'), fetchImpl: async () => page({ '@type': 'Product', name: 'CedarTone 2x6x16', offers: { price: '22.49', priceCurrency: 'USD' } }) });
  assert.equal(r.ok, true); assert.equal(r.candidate.unitPriceCents, 2249); assert.equal(r.candidate.priceDate, '2026-11-02');
  assert.equal(r.candidate.priceType, 'material'); assert.equal(r.candidate.source.url, 'https://www.menards.com/p/2x6');
});
test('malformed JSON-LD ignored', () => { assert.deepEqual(extractJsonLdOffers('<script type="application/ld+json">{bad</script>'), []); });
