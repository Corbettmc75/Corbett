// Shared helpers for component takeoffs. No module-level mutable state.
export const IN_PER_FT = 12;
export const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
export const ftIn = (inches) => {
  if (inches == null) return '?';
  const neg = inches < 0; let v = Math.abs(inches);
  const ft = Math.floor(v / 12 + 1e-9); const rem = round(v - ft * 12, 3);
  return `${neg ? '−' : ''}${ft ? `${ft}'` : ''}${rem ? `${ft ? ' ' : ''}${rem}"` : ft ? '' : '0"'}`;
};

/** A per-component collector that builds requirements / pieces / questions with stable ids. */
export function collector(component) {
  const out = { requirements: [], pieces: [], questions: [], metrics: {} };
  const cid = component?.id ?? '_job';
  const cname = component?.name ?? 'Whole job';
  out.req = (r) => {
    const req = {
      id: r.id ?? `${cid}:${r.role}`, productKey: r.productKey, qty: r.qty ?? null, unit: r.unit,
      componentId: r.componentId ?? (component ? cid : null), label: r.label ?? cname, role: r.role,
      basis: r.basis ?? 'calculation', formula: r.formula ?? '', refs: r.refs ?? [],
      status: r.status ?? (r.qty == null ? 'unresolved' : 'ok'), questionIds: r.questionIds ?? [],
      workPackage: r.workPackage, allowanceEligible: r.allowanceEligible ?? false,
    };
    out.requirements.push(req);
    return req;
  };
  out.piece = (p) => {
    const piece = {
      id: p.id, groupKey: p.groupKey, lengthIn: round(p.lengthIn, 4), nominalLengthIn: round(p.nominalLengthIn ?? p.lengthIn, 4),
      label: p.label, componentId: p.componentId ?? cid, role: p.role, allowedStockFt: p.allowedStockFt ?? null,
      mustBeContinuous: p.mustBeContinuous ?? true, allowanceEligible: p.allowanceEligible ?? true,
      workPackage: p.workPackage, status: p.status ?? 'ok', questionIds: p.questionIds ?? [],
    };
    out.pieces.push(piece);
    return piece;
  };
  out.q = (q) => {
    out.questions.push({ id: q.id, type: q.type, text: q.text, componentIds: q.componentIds ?? (component ? [cid] : []),
      productKeys: q.productKeys ?? [], provisional: q.provisional ?? null, status: 'open' });
    return q.id;
  };
  return out;
}

export function finish(c) {
  return { requirements: c.requirements, pieces: c.pieces, questions: c.questions, metrics: c.metrics };
}

export function wallMaterial(component, rules) {
  return component?.props?.material && !/same as/i.test(component.props.material) ? component.props.material : rules.bed.wallMaterial;
}
