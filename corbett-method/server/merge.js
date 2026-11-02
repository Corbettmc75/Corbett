// Pure job-document helpers: applying a reviewed extraction proposal, re-applying locked
// manual corrections, and protecting server-owned fields on client saves.

const clone = (o) => structuredClone(o);

function setPath(obj, dotted, value) {
  const parts = String(dotted).split('.');
  if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) return;
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = value;
}

/** Re-apply every locked correction onto the matching component (corrections always win). */
export function applyCorrections(job) {
  const byId = new Map((job.components || []).map(c => [c.id, c]));
  for (const cor of job.corrections || []) {
    if (!cor.locked) continue;
    const c = byId.get(cor.componentId);
    if (!c || !cor.path) continue;
    setPath(c, cor.path, clone(cor.value));
    c.provenance = c.provenance || {};
    c.provenance[cor.path] = { basis: 'manual', ref: cor.note || `Correction by ${cor.by || 'user'}`, confirmed: true };
  }
  return job;
}

const lockedIds = (job) => new Set((job.corrections || []).filter(c => c.locked).map(c => c.componentId));
const keyOf = (c) => `${c.type}|${String(c.name || '').trim().toLowerCase()}`;

/**
 * Merge accepted proposal items into a job (returns a new doc).
 * - Previously extracted, unlocked components are replaced; locked ones are kept.
 * - Manually-created components (no origin) are never touched.
 * - answers, allowances, settings, catalog and standards are never touched.
 */
export function applyProposal(job, { extraction, file, accept = [], edits = {} }) {
  const doc = clone(job);
  const proposal = extraction.proposal || { items: [], summary: {} };
  const acceptSet = new Set(accept);
  const items = proposal.items.filter(i => acceptSet.has(i.itemId));
  const locked = lockedIds(doc);

  doc.components = (doc.components || []).filter(c => !c.origin || locked.has(c.id));
  const keptKeys = new Set(doc.components.filter(c => c.origin).map(keyOf));
  const tempToId = {};

  for (const it of items.filter(i => i.kind === 'component')) {
    const e = edits[it.itemId] && typeof edits[it.itemId] === 'object' ? edits[it.itemId] : {};
    const d = it.data;
    const comp = {
      id: `x-${it.itemId.slice(2)}`,
      type: typeof e.type === 'string' ? e.type : d.type,
      name: typeof e.name === 'string' ? e.name.slice(0, 120) : d.name,
      scenarioId: null, excluded: false,
      geometry: e.geometry !== undefined ? e.geometry : d.geometry,
      props: { extracted: d.props, ...(e.props && typeof e.props === 'object' ? e.props : {}) },
      provenance: clone(d.provenance || {}),
      notes: [d.notes, d.dimensionLabels?.length ? `Labels: ${d.dimensionLabels.map(l => `${l.text}${l.describes ? ` (${l.describes})` : ''}`).join('; ')}` : ''].filter(Boolean).join('\n'),
      origin: extraction.id, extractedItemId: it.itemId,
    };
    if (e.geometry !== undefined) comp.provenance.geometry = { basis: 'manual', ref: 'Edited during drawing review', confirmed: true };
    tempToId[d.tempId] = comp.id;
    if (keptKeys.has(keyOf(comp))) continue; // a locked, corrected version already exists
    doc.components.push(comp);
  }

  doc.drawingNotes = (doc.drawingNotes || []).filter(n => !n.extractionId);
  for (const it of items.filter(i => i.kind === 'note' || i.kind === 'exclusion')) {
    doc.drawingNotes.push({ id: it.itemId, kind: it.kind, text: it.data.text, extractionId: extraction.id });
    if (it.kind === 'exclusion') {
      doc.scope = doc.scope || {};
      if (/\bno\b[^.]*irrigation/i.test(it.data.text)) doc.scope.irrigation = false;
      if (/\bno\b[^.]*lighting/i.test(it.data.text)) doc.scope.lighting = false;
    }
  }
  doc.drawingQuestions = (doc.drawingQuestions || []).filter(q => !q.extractionId);
  for (const it of items.filter(i => i.kind === 'question')) {
    doc.drawingQuestions.push({ id: `q.drawing.${it.itemId}`, type: it.data.type, text: it.data.text,
      componentIds: tempToId[it.data.componentTempId] ? [tempToId[it.data.componentTempId]] : [], extractionId: extraction.id });
  }

  doc.sources = doc.sources || [];
  const srcId = `src-${file.id}`;
  const src = { id: srcId, fileId: file.id, kind: 'drawing', title: proposal.summary?.projectName || file.name,
    revision: proposal.summary?.revision || null, date: proposal.summary?.drawingDate || null, pages: file.pages || null,
    notes: proposal.summary?.message || '' };
  const i = doc.sources.findIndex(s => s.id === srcId);
  if (i >= 0) doc.sources[i] = { ...doc.sources[i], ...src }; else doc.sources.push(src);

  applyCorrections(doc);
  return doc;
}

/** Client saves may not change identity or server-owned fields. */
export function protectServerFields(incoming, current) {
  const doc = clone(incoming);
  doc.id = current.id;
  doc.projectKey = current.projectKey;
  doc.extractions = clone(current.extractions || []);
  return doc;
}

export function validateJobDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'Job must be an object.';
  if (typeof doc.name !== 'string' || !doc.name.trim()) return 'Job name is required.';
  if (doc.components && !Array.isArray(doc.components)) return 'components must be an array.';
  if (JSON.stringify(doc).length > 5 * 1024 * 1024) return 'Job document is too large.';
  return null;
}

export function newJobDoc({ id, name, customer = '', address = '', projectKey }) {
  return {
    id, projectKey, name, customer, address, status: 'draft',
    sources: [], scope: { irrigation: false, lighting: false, liner: true, trim: true }, settings: {},
    scenarios: [{ id: 'base', name: 'Base', selected: true, note: '', overrides: {} }],
    components: [], allowances: [], answers: {}, corrections: [], extractions: [],
    buildPlan: { packages: {} }, actuals: { purchases: [], leftovers: [], costs: [] },
    costInputs: { taxRatePct: null, deliveryCents: null, disposalCents: null, laborHours: null, laborRateCents: null, contingencyPct: null, serviceCharges: [] },
    selling: null,
  };
}
