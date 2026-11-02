// Internal project cost. Customer selling price is reported separately and never mixed in.
// Anything not provided is null (unknown) and listed in notes — never treated as zero.

export function computeCosts(rows = [], job = {}, rules = {}) {
  const notes = [];
  const priced = rows.filter(r => r.extendedCents != null);
  const missing = rows.filter(r => r.extendedCents == null);
  const materialsKnownCents = priced.reduce((a, r) => a + r.extendedCents, 0);
  const materialsCents = missing.length ? null : materialsKnownCents;
  if (missing.length) notes.push(`${missing.length} purchase line(s) have no price or quantity yet — material total is incomplete (known subtotal shown).`);

  const ci = job.costInputs || {};
  const has = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

  let taxCents = null;
  if (has(ci.taxRatePct)) {
    taxCents = Math.round(materialsKnownCents * Number(ci.taxRatePct) / 100);
    if (materialsCents == null) notes.push('Tax is computed on the known material subtotal only.');
  } else notes.push('Sales tax rate not entered.');

  const deliveryCents = has(ci.deliveryCents) ? Number(ci.deliveryCents) : null;
  const disposalCents = has(ci.disposalCents) ? Number(ci.disposalCents) : null;
  if (deliveryCents == null) notes.push('Delivery not entered.');
  if (disposalCents == null) notes.push('Disposal/hauling not entered.');

  let laborCents = null;
  if (has(ci.laborHours) && has(ci.laborRateCents)) laborCents = Math.round(Number(ci.laborHours) * Number(ci.laborRateCents));
  else notes.push('Internal labor (hours × rate) not entered.');

  const svc = (ci.serviceCharges || []).filter(s => has(s.cents));
  const serviceChargesCents = svc.length ? svc.reduce((a, s) => a + Number(s.cents), 0) : null;

  const subtotalParts = [materialsKnownCents, taxCents, deliveryCents, disposalCents, laborCents, serviceChargesCents];
  const knownSubtotal = subtotalParts.reduce((a, v) => a + (v ?? 0), 0);
  let contingencyCents = null;
  if (has(ci.contingencyPct)) contingencyCents = Math.round(knownSubtotal * Number(ci.contingencyPct) / 100);
  else notes.push('Contingency % not entered.');

  const internalKnownCents = knownSubtotal + (contingencyCents ?? 0);
  const internalTotalCents = materialsCents == null ? null : internalKnownCents;

  const sellingPriceCents = Number.isFinite(job.selling?.totalCents) ? job.selling.totalCents : null;
  if (sellingPriceCents != null) notes.push(`Customer selling price (${job.selling.source || 'proposal'}) is shown separately and is not a cost.`);

  return {
    materialsCents, materialsKnownCents, missingPriceCount: missing.length,
    taxCents, deliveryCents, disposalCents, laborCents, serviceChargesCents, contingencyCents,
    internalKnownCents, internalTotalCents, sellingPriceCents,
    marginKnownCents: sellingPriceCents != null && internalTotalCents != null ? sellingPriceCents - internalTotalCents : null,
    notes,
  };
}
