// Exports: shopping CSV, cut-list CSV, printable job pack (self-contained HTML).
// All drawing/user text is untrusted: CSV cells are formula-guarded, HTML is escaped.

const money = c => (c == null ? '' : (c / 100).toFixed(2));
const moneyH = c => (c == null ? 'unknown' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const num = v => (v == null ? '' : String(+(+v).toFixed(3)));

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function issueText(row, est) {
  const qs = (row.issues || []).map(id => est.unresolved?.find(q => q.id === id)?.text).filter(Boolean);
  return [row.status, ...qs].filter(Boolean).join(' | ');
}

export function shoppingCsv(est) {
  const head = ['Product', 'Quantity', 'Base', 'Extra allowance', 'Unit', 'Package', 'Unit price', 'Extended', 'Supplier', 'Price date', 'Status/issue'];
  return csv([head, ...est.shopping.map(r => [
    r.name, num(r.totalQty), num(r.baseQty), num(r.allowanceQty), r.unit,
    r.packageSize != null ? `${r.packageSize} ${r.packageUnit || ''}`.trim() : `TBD ${r.packageUnit || ''}`.trim(),
    money(r.unitPriceCents), money(r.extendedCents), r.supplier || '', r.priceDate || '', issueText(r, est),
  ])]);
}

export function cutListCsv(est) {
  const head = ['Board', 'Material', 'Stock length (ft)', 'Special order', 'Cut #', 'Finished length (in)', 'Piece', 'Component', 'Saw loss (in)', 'Usable offcut (in)', 'Waste (in)'];
  const rows = [head];
  for (const [gk, plans] of Object.entries(est.cutPlans || {})) {
    for (const b of plans.reviewed.boards) {
      b.cuts.forEach((c, i) => rows.push([b.id, gk, b.stockLengthFt, b.specialOrder ? 'yes' : '', i + 1, num(c.lengthIn), c.label, c.componentId,
        i === 0 ? num(b.sawLossIn) : '', i === 0 ? num(b.usableOffcutIn) : '', i === 0 ? num(b.wasteIn) : '']));
    }
    for (const inf of plans.reviewed.infeasible || []) rows.push(['UNRESOLVED', gk, '', '', '', '', inf.label, '', '', '', inf.reason]);
  }
  return csv(rows);
}

function boardSvg(b) {
  const W = 600, H = 22, L = b.stockLengthFt * 12, sx = W / L;
  let x = 0; const parts = [];
  const colors = ['#7aa874', '#a7c89f'];
  b.cuts.forEach((c, i) => {
    const w = c.lengthIn * sx;
    parts.push(`<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${colors[i % 2]}" stroke="#333" stroke-width=".5"/>`);
    parts.push(`<text x="${(x + w / 2).toFixed(1)}" y="15" font-size="10" text-anchor="middle">${escapeHtml(num(c.lengthIn))}"</text>`);
    x += w + 0.125 * sx;
  });
  if (b.offcutIn > 0) parts.push(`<rect x="${(W - b.offcutIn * sx).toFixed(1)}" y="0" width="${(b.offcutIn * sx).toFixed(1)}" height="${H}" fill="${b.usableOffcutIn ? '#e8d9a8' : '#ddd'}" stroke="#333" stroke-width=".5"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Board ${escapeHtml(b.id)} cut diagram">${parts.join('')}</svg>`;
}

export function jobPackHtml(est, job = {}) {
  const e = escapeHtml;
  const rows = est.shopping.map(r => `<tr><td>${e(r.name)}</td><td class="n">${e(num(r.totalQty) || '?')}</td><td class="n">${e(num(r.baseQty))}</td><td class="n">${r.allowanceQty ? '+' + e(num(r.allowanceQty)) : ''}</td><td>${e(r.unit)}</td><td class="n">${e(money(r.unitPriceCents) || '—')}</td><td class="n">${e(money(r.extendedCents) || '—')}</td><td>${e(r.supplier || '')} ${e(r.priceDate || '')}</td><td>${e(r.status)}</td></tr>`).join('');
  const qs = est.unresolved.map(q => `<li><b>${e(q.type.replace(/_/g, ' '))}:</b> ${e(q.text)}</li>`).join('');
  const cuts = Object.entries(est.cutPlans || {}).map(([gk, p]) => `<h3>${e(gk)} — ${e(p.reviewed.proof === 'optimal' ? 'optimal plan' : 'best plan found')}</h3>` +
    (p.reviewed.conflicts || []).map(c => `<p class="warn">${e(c.text)} ${e(c.suggestion)}</p>`).join('') +
    p.reviewed.boards.map(b => `<div class="board"><b>${e(b.id)}</b> ${e(b.stockLengthFt)}'${b.specialOrder ? ' <i>special order</i>' : ''} — ${b.cuts.map(c => `${e(num(c.lengthIn))}" ${e(c.label)}`).join(' · ')} — saw ${e(num(b.sawLossIn))}", offcut ${e(num(b.offcutIn))}"${b.usableOffcutIn ? ' (keep)' : ' (waste)'}${boardSvg(b)}</div>`).join('') +
    (p.reviewed.infeasible || []).map(i => `<p class="warn">${e(i.label)}: ${e(i.reason)}</p>`).join('')).join('');
  const c = est.costs || {};
  const costRows = [['Materials (known)', c.materialsKnownCents], ['Materials (complete)', c.materialsCents], ['Tax', c.taxCents], ['Delivery', c.deliveryCents],
    ['Disposal', c.disposalCents], ['Internal labor', c.laborCents], ['Contractor/service', c.serviceChargesCents], ['Contingency', c.contingencyCents],
    ['Internal total', c.internalTotalCents]].map(([l, v]) => `<tr><td>${e(l)}</td><td class="n">${e(moneyH(v))}</td></tr>`).join('');
  const guides = (est.guides || []).map(g => `<section class="wp"><h3>${e(g.id.toUpperCase())} · ${e(g.title)}${g.day ? ` — ${e(g.day)}` : ''}</h3>
    ${g.status === 'not-in-scope' ? '<p><i>Not in scope.</i></p>' : `
    <ol>${g.steps.map(s => `<li>${g.checklist?.[s.id] ? '☑' : '☐'} ${e(s.text)}</li>`).join('')}</ol>
    ${g.supplies.length ? `<p><b>Supplies:</b> ${g.supplies.map(s => `${e(num(s.qty) || '?')} ${e(s.unit)} ${e(s.name)}${s.note ? ` (${e(s.note)})` : ''}`).join('; ')}</p>` : ''}
    ${g.cutInstructions.length ? `<details><summary>Boards (${g.cutInstructions.length})</summary><ul>${g.cutInstructions.map(ci => `<li>${e(ci.text)}</li>`).join('')}</ul></details>` : ''}
    <p><b>Tools:</b> ${g.tools.map(e).join(', ')}</p><p><b>Checks:</b> ${g.checks.map(e).join('; ')}</p>
    ${g.notes ? `<p><b>Crew notes:</b> ${e(g.notes)}</p>` : ''}`}</section>`).join('');
  const recs = (est.reconciliations || []).map(r => `<li>${e(r.label)}: confirmed ${e(num(r.confirmedQty))} ${e(r.unit)}; calculated ${e(r.calculatedQty == null ? 'unknown' : num(r.calculatedQty))} ${e(r.unit)} — ${e(r.note || '')}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job pack — ${e(job.name || est.jobId)}</title>
<style>body{font:13px/1.4 system-ui,sans-serif;margin:16px;color:#222;background:#fff}h1{font-size:20px}h2{font-size:16px;border-bottom:2px solid #4a6b45;margin-top:24px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}.n{text-align:right}.warn{color:#9a3b00}
.board{margin:6px 0;break-inside:avoid}.wp{break-inside:avoid;border:1px solid #ddd;padding:6px 10px;margin:8px 0}@media print{details{display:block}summary{display:none}}</style></head><body>
<h1>${e(job.name || '')}</h1><p>${e(job.customer || '')} · ${e(job.address || '')}<br>Scenario: ${e(est.scenarioName || 'default')} · Generated ${e(est.generatedAt)} · Rules ${e(est.rulesHash)}</p>
<h2>Shopping list</h2><table><thead><tr><th>Product</th><th>Qty</th><th>Base</th><th>Extra</th><th>Unit</th><th>Unit $</th><th>Ext $</th><th>Supplier / date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Unresolved (${est.unresolved.length})</h2><ul>${qs || '<li>None</li>'}</ul>
${recs ? `<h2>Reconciliation</h2><ul>${recs}</ul>` : ''}
<h2>Costs (internal)</h2><table>${costRows}</table><p>Customer selling price (separate): ${e(moneyH(c.sellingPriceCents))}</p><ul>${(c.notes || []).map(n => `<li>${e(n)}</li>`).join('')}</ul>
<h2>Cutting guide</h2>${cuts || '<p>No lumber.</p>'}
<h2>Build packages</h2>${guides}
</body></html>`;
}
