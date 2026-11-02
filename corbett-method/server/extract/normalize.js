// Validate and clamp analysis output (AI or text-layer) into reviewable proposal items.
// Everything here is treated as untrusted data: unknown fields/types are dropped,
// strings are length-limited, numbers must be finite and within sane ranges.
import { createHash } from 'node:crypto';

const TYPES = new Set(['bed', 'trellis', 'path', 'patio', 'stoop', 'screen', 'fence', 'planting', 'mulch', 'rock', 'demolition', 'edging', 'drain', 'irrigation', 'lighting']);
const Q_TYPES = new Set(['missing_dimension', 'construction_detail', 'product_spec', 'missing_price', 'scope_conflict']);

const s = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : null);
const ft = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 500 ? Math.round(v * 10000) / 10000 : null);
const conf = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const id = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

export function normalizeGeometry(g) {
  if (!g || typeof g !== 'object') return null;
  switch (g.kind) {
    case 'rect': { const L = ft(g.lengthFt), W = ft(g.widthFt); return L && W ? { kind: 'rect', lengthFt: L, widthFt: W } : null; }
    case 'line': { const L = ft(g.lengthFt); return L ? { kind: 'line', lengthFt: L } : null; }
    case 'area': { const a = g.areaSqFt; return typeof a === 'number' && Number.isFinite(a) && a > 0 && a < 250000 ? { kind: 'area', areaSqFt: Math.round(a * 100) / 100 } : null; }
    case 'polygon': {
      const pts = arr(g.points, 200).filter(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 500))
        .map(p => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]);
      return pts.length >= 3 ? { kind: 'polygon', points: pts } : null;
    }
    default: return null;
  }
}

/**
 * @param raw  analysis output (TAKEOFF_SCHEMA shape)
 * @param meta { source:'ai'|'text-layer', extractionId, fileName, model, message }
 */
export function normalizeTakeoff(raw, meta = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const items = [];
  const extractionId = meta.extractionId || 'x';
  for (const c of arr(r.components, 200)) {
    if (!c || typeof c !== 'object' || !TYPES.has(c.type)) continue;
    const name = s(c.name, 120) || c.type;
    const geometry = normalizeGeometry(c.geometry);
    const labels = arr(c.dimensionLabels, 60).map(l => ({
      text: s(l?.text, 60) || '', valueFt: ft(l?.valueFt), describes: s(l?.describes, 160) || '',
      page: Number.isInteger(l?.page) && l.page > 0 && l.page < 1000 ? l.page : null, confidence: conf(l?.confidence),
    })).filter(l => l.text);
    const ref = labels.map(l => l.text).join(', ') || 'drawing';
    const tempId = s(c.tempId, 40) || name;
    items.push({
      itemId: `c-${id(extractionId, tempId, name)}`, kind: 'component', confidence: conf(c.confidence),
      data: {
        type: c.type, name, geometry,
        props: { materials: arr(c.materials, 20).map(m => s(m, 200)).filter(Boolean), quantityNotes: arr(c.quantityNotes, 20).map(m => s(m, 200)).filter(Boolean) },
        dimensionLabels: labels, notes: s(c.notes, 600) || '', tempId,
        provenance: { geometry: { basis: 'drawing', ref: `${meta.fileName || 'drawing'}: ${ref}`.slice(0, 300), confirmed: false } },
      },
    });
    if (!geometry) items.push({ itemId: `q-${id(extractionId, tempId, 'geom')}`, kind: 'question', confidence: null,
      data: { type: 'missing_dimension', text: `${name}: outline dimensions are not fully labelled on the drawing.`, componentTempId: tempId } });
  }
  for (const e of arr(r.exclusions, 50)) { const t = s(e, 300); if (t) items.push({ itemId: `e-${id(extractionId, t)}`, kind: 'exclusion', confidence: null, data: { text: t } }); }
  for (const a of arr(r.alternatives, 50)) { const t = s(a, 300); if (t) items.push({ itemId: `n-${id(extractionId, 'alt', t)}`, kind: 'note', confidence: null, data: { text: t, alternative: true } }); }
  for (const n of arr(r.notes, 100)) { const t = s(n, 400); if (t) items.push({ itemId: `n-${id(extractionId, t)}`, kind: 'note', confidence: null, data: { text: t } }); }
  for (const d of arr(r.dimensionCandidates, 300)) {
    const t = s(d?.text, 60); if (!t) continue;
    items.push({ itemId: `n-${id(extractionId, 'dim', t, String(d.index ?? ''))}`, kind: 'note', confidence: null,
      data: { text: `Dimension label "${t}"`, dimension: { text: t, valueFt: ft(d.valueFt), secondFt: ft(d.secondFt), line: s(d.line, 200) } } });
  }
  for (const u of arr(r.uncertainties, 100)) {
    const t = s(u?.text, 400); if (!t || !Q_TYPES.has(u?.type)) continue;
    items.push({ itemId: `q-${id(extractionId, u.type, t)}`, kind: 'question', confidence: null, data: { type: u.type, text: t, componentTempId: s(u.componentTempId, 40) } });
  }
  return {
    summary: {
      source: meta.source || 'ai', model: meta.model || null, message: meta.message || null,
      projectName: s(r.projectName, 160), revision: s(r.revision, 160), drawingDate: s(r.drawingDate, 40),
      rotationNote: s(r.pageRotationNote, 200), fileName: s(meta.fileName, 200),
      counts: items.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {}),
    },
    items,
  };
}
