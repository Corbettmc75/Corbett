// Price matching. Only material-only catalog entries for the IDENTICAL productKey and the
// same unit basis can price a shopping row. Unknown stays null — never zero.
import { productName } from './products.js';

const dateKey = d => String(d ?? '');

export function matchPrice(productKey, catalog = [], unit = null) {
  const exact = catalog.filter(e => e && e.productKey === productKey);
  const material = exact.filter(e => e.priceType === 'material' && Number.isFinite(e.unitPriceCents));
  const nonMaterial = exact.filter(e => e.priceType !== 'material');
  if (!material.length) {
    return { unitPriceCents: null, reason: 'no-material-price', nonMaterial };
  }
  const sameUnit = unit ? material.filter(e => (e.unitBasis || e.packageUnit) === unit) : material;
  if (!sameUnit.length) {
    return { unitPriceCents: null, reason: 'unit-mismatch', nonMaterial,
      mismatch: material.map(e => `${e.supplier}: $${(e.unitPriceCents / 100).toFixed(2)} per ${e.unitBasis}`) };
  }
  const best = [...sameUnit].sort((a, b) => dateKey(b.priceDate).localeCompare(dateKey(a.priceDate)))[0];
  return {
    unitPriceCents: best.unitPriceCents, supplier: best.supplier, store: best.store ?? null,
    priceDate: best.priceDate ?? null, source: best.source ?? null, entryId: best.id, sku: best.sku ?? null, nonMaterial,
  };
}

function fmt(c) { return `$${(c / 100).toFixed(2)}`; }

/** Service/selling-side entries that relate to a row (e.g. Greenworks soil rates on soil rows). */
function relatedServiceNotes(row, catalog) {
  const notes = [];
  if (row.category === 'soil' && row.unit === 'cy') {
    for (const e of catalog.filter(e => e.priceType !== 'material' && /^service:soil/.test(e.productKey))) {
      notes.push(`${e.supplier} ${e.spec || ''}: ${fmt(e.unitPriceCents)}/${e.unitBasis} is a ${e.priceType} rate, not a material purchase price — not used.`);
    }
  }
  return notes;
}

const STATUS_RANK = { unresolved: 3, missing_price: 2, provisional: 1, ok: 0 };
export function worseStatus(a, b) { return (STATUS_RANK[a] ?? 0) >= (STATUS_RANK[b] ?? 0) ? a : b; }

/**
 * Adds price fields to shopping rows. Returns { rows, questions }.
 */
export function priceRows(rows, catalog = []) {
  const questions = [];
  const out = rows.map(r => {
    const row = { ...r, issues: [...(r.issues || [])], notes: [...(r.notes || [])] };
    const m = matchPrice(row.productKey, catalog, row.unit);
    row.notes.push(...relatedServiceNotes(row, catalog));
    for (const e of m.nonMaterial || []) {
      if (!(row.category === 'soil')) row.notes.push(`${e.supplier}: ${fmt(e.unitPriceCents)} is a ${e.priceType} rate — not used as a material cost.`);
    }
    row.priceType = 'material';
    if (m.unitPriceCents == null) {
      row.unitPriceCents = null; row.extendedCents = null;
      row.supplier = null; row.priceDate = null; row.priceSource = null;
      const qid = `q.price:${row.productKey}`;
      const text = m.reason === 'unit-mismatch'
        ? `Catalog price for ${row.name} is not per ${row.unit} (${m.mismatch.join('; ')}) — add a per-${row.unit} material price.`
        : `No supplier price for ${row.name} — add it to the price catalog.`;
      questions.push({ id: qid, type: 'missing_price', text, componentIds: [], productKeys: [row.productKey], provisional: 'Excluded from the material total; shown as unknown.', status: 'open' });
      row.issues.push(qid);
      row.status = worseStatus(row.status || 'ok', 'missing_price');
    } else {
      row.unitPriceCents = m.unitPriceCents;
      row.extendedCents = row.totalQty == null ? null : Math.round(m.unitPriceCents * row.totalQty);
      row.supplier = [m.supplier, m.store].filter(Boolean).join(', ');
      row.priceDate = m.priceDate;
      row.priceSource = m.source?.file || m.source?.url || null;
      row.priceEntryId = m.entryId;
    }
    return row;
  });
  return { rows: out, questions };
}

export { productName };
