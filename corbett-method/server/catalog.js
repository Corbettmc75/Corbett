// Catalog entry validation and CSV import (CONTRACT §7).
import { randomUUID } from 'node:crypto';

export const PRICE_TYPES = ['material', 'service', 'selling'];
const KEY_RE = /^[a-z0-9][a-z0-9.\-]*(:[a-z0-9][a-z0-9.\-]*){1,5}$/;
const str = (v, max = 300) => (v == null || v === '' ? null : String(v).trim().slice(0, max));

export function parseMoneyToCents(v) {
  if (v == null || String(v).trim() === '' || String(v).trim() === '—' || String(v).trim() === '-') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/** Returns {entry} or {error}. A price is required: unknown prices are simply not entered. */
export function validateEntry(input) {
  if (!input || typeof input !== 'object') return { error: 'Entry must be an object.' };
  const productKey = str(input.productKey, 120);
  if (!productKey || !KEY_RE.test(productKey)) return { error: `productKey "${productKey ?? ''}" is not valid (use e.g. lumber:cedartone:2x6:16).` };
  const priceType = str(input.priceType, 20);
  if (!PRICE_TYPES.includes(priceType)) return { error: `priceType must be one of ${PRICE_TYPES.join(', ')} (material-only prices, contractor/service rates and customer selling prices are kept apart).` };
  let cents = input.unitPriceCents;
  if (cents == null && input.unitPrice != null) cents = parseMoneyToCents(input.unitPrice);
  if (!Number.isInteger(cents) || cents < 0) return { error: 'A unit price is required (leave unknown prices out instead of entering 0).' };
  const packageSize = input.packageSize == null || input.packageSize === '' ? null : Number(input.packageSize);
  if (packageSize != null && !(Number.isFinite(packageSize) && packageSize > 0)) return { error: 'packageSize must be a positive number.' };
  const supplier = str(input.supplier, 120);
  if (!supplier) return { error: 'supplier is required.' };
  const priceDate = str(input.priceDate, 20);
  if (!priceDate) return { error: 'priceDate is required (when the price was quoted or printed).' };
  const src = input.source && typeof input.source === 'object' ? input.source : {};
  return { entry: {
    id: str(input.id, 120) || `cat-${randomUUID()}`,
    productKey, supplier, store: str(input.store, 120), sku: str(input.sku, 60), spec: str(input.spec, 300) || productKey,
    packageSize, packageUnit: str(input.packageUnit, 30), unitPriceCents: cents, unitBasis: str(input.unitBasis, 30) || str(input.packageUnit, 30),
    priceDate, source: { file: str(src.file ?? input.sourceFile, 300), page: str(src.page ?? input.sourcePage, 20), url: str(src.url ?? input.sourceUrl, 500) },
    priceType, notes: str(input.notes, 500) || '',
  } };
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

/**
 * CSV columns (header names, case-insensitive): productKey, supplier, store, sku, spec, packageSize,
 * packageUnit, unitPrice (dollars) | unitPriceCents, unitBasis, priceDate, priceType, sourceFile,
 * sourcePage, sourceUrl, notes, id.
 */
export function importCsv(text, defaults = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { entries: [], errors: [{ row: 0, error: 'CSV needs a header row and at least one data row.' }] };
  const header = rows[0].map(h => h.trim().replace(/\s+/g, ''));
  const lc = header.map(h => h.toLowerCase());
  const known = ['productkey', 'supplier', 'store', 'sku', 'spec', 'packagesize', 'packageunit', 'unitprice', 'unitpricecents', 'unitbasis', 'pricedate', 'pricetype', 'sourcefile', 'sourcepage', 'sourceurl', 'notes', 'id'];
  const canon = { productkey: 'productKey', packagesize: 'packageSize', packageunit: 'packageUnit', unitprice: 'unitPrice', unitpricecents: 'unitPriceCents', unitbasis: 'unitBasis', pricedate: 'priceDate', pricetype: 'priceType', sourcefile: 'sourceFile', sourcepage: 'sourcePage', sourceurl: 'sourceUrl' };
  const entries = [], errors = [];
  rows.slice(1, 5001).forEach((r, i) => {
    const o = { ...defaults };
    lc.forEach((h, j) => { if (known.includes(h) && r[j] != null && r[j].trim() !== '') o[canon[h] || h] = r[j].trim(); });
    if (o.unitPriceCents != null) o.unitPriceCents = Number(o.unitPriceCents);
    const { entry, error } = validateEntry(o);
    if (error) errors.push({ row: i + 2, error }); else entries.push(entry);
  });
  return { entries, errors };
}
