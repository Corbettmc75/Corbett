// Generates data/catalog.seed.json from the price table supplied in the project brief
// (Menards, Naperville, sheet dated 2026-02-19). A dash in the source = no entry (unknown, not zero).
import { writeFileSync } from 'node:fs';
const src = { file: 'Menards price sheet, Naperville, dated 2026-02-19 (values supplied in project brief)', page: null, url: null };
const lines = { cedartone: 'CedarTone', 'smooth-cedar': 'Smooth cedar', 'rough-cedar': 'Rough-sawn cedar' };
const T = {
  '2x6':  { lengths: [8,10,12,16], cedartone:[11.19,14.09,16.19,22.29], 'smooth-cedar':[24.38,30.18,36.48,49.98], 'rough-cedar':[25.88,32.48,38.89,51.94] },
  '6x6':  { lengths: [8,10,12], cedartone:[40.89,49.39,59.49], 'smooth-cedar':[179.99,224.99,269.99], 'rough-cedar':[149.99,166.79,239.99] },
  '2x12': { lengths: [8,10,12,16,20], cedartone:[22.29,27.49,38.39,45.09,74.99], 'smooth-cedar':[123.79,null,185.64,244.48,333.39], 'rough-cedar':[115.99,null,167.98,228.00,299.99] },
  '4x4':  { lengths: [8,10,12], cedartone:[16.79,20.59,24.29], 'smooth-cedar':[40.28,50.38,60.59], 'rough-cedar':[41.99,52.59,62.99] },
};
const out = [];
for (const [sec, t] of Object.entries(T)) for (const line of Object.keys(lines)) t.lengths.forEach((ft, i) => {
  const p = t[line][i]; if (p == null) return;
  out.push({ id: `menards-20260219-${line}-${sec}-${ft}`, productKey: `lumber:${line}:${sec}:${ft}`, supplier: 'Menards', store: 'Naperville',
    sku: null, spec: `${lines[line]} ${sec.replace('x','×')} × ${ft}'`, packageSize: 1, packageUnit: 'board',
    unitPriceCents: Math.round(p * 100), unitBasis: 'board', priceDate: '2026-02-19', source: src, priceType: 'material',
    notes: (sec === '2x12' && ft === 20) || (ft === 20) ? '20-ft: special order' : '' });
});
const gw = { file: 'GreenworksRates_2025 (screenshot; only soil rates were legible/supplied)', page: null, url: null };
out.push({ id: 'greenworks-2025-soil', productKey: 'service:soil-install', supplier: 'Greenworks', store: null, sku: null,
  spec: 'Soil — Greenworks column', packageSize: 1, packageUnit: 'cy', unitPriceCents: 12500, unitBasis: 'cy', priceDate: '2025', source: gw,
  priceType: 'service', notes: 'Contractor/service rate — NOT a raw material purchase price' });
out.push({ id: 'greenworks-2025-soil-hgg', productKey: 'service:soil-install', supplier: 'Greenworks (HGG column)', store: null, sku: null,
  spec: 'Soil — HGG column', packageSize: 1, packageUnit: 'cy', unitPriceCents: 15000, unitBasis: 'cy', priceDate: '2025', source: gw,
  priceType: 'service', notes: 'Service/selling-side rate — NOT a raw material purchase price' });
writeFileSync(new URL('../data/catalog.seed.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} entries`);
