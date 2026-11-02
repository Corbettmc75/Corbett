// Lumber cut optimizer for one compatibility pool (same species/treatment/section).
//
// Model: each purchased board is a "bin" whose final stock length is chosen at the end
// (smallest permitted / cheapest length that physically holds its cuts). Pieces never splice.
// Physical fit on a board of L inches with pieces p1..pn:
//   Σp + kerf·(n−1) + endTrim ≤ L   (the final cut, if any leftover remains, consumes ≤ kerf of the leftover)
// so an exact fit needs no final cut, but two exact halves need one kerf between them.
//
// Special-order stock is used only for pieces that cannot be made from any permitted in-stock
// length. Those boards are opened first; their offcuts can host other compatible pieces.
// Search: exact branch-and-bound (depth-first, symmetric-piece pruning, slack lower bound) within
// a node/time budget, seeded with several greedy heuristics. proof = 'optimal' only when the
// search finished exhaustively or matched the lower bound; otherwise 'best-found'.

const EPS = 1e-6;

const LINE_PREFIX = { cedartone: '', pt: 'PT-', 'rough-cedar': 'RC-', 'smooth-cedar': 'SC-' };

export function boardPrefix(groupKey) {
  const [, line = '', section = ''] = String(groupKey).split(':');
  const p = LINE_PREFIX[line] ?? (line ? line.slice(0, 2).toUpperCase() + '-' : '');
  return `B-${p}${section}`;
}

/** Inches consumed by kerfs for pieces on a board of usable length. */
function requiredIn(lengths, kerf) {
  const n = lengths.length;
  if (!n) return 0;
  let s = 0;
  for (const l of lengths) s += l;
  return s + kerf * (n - 1);
}

export function fitsOn(boardIn, lengths, kerf, endTrim = 0) {
  return requiredIn(lengths, kerf) <= boardIn - endTrim + EPS;
}

function round3(x) { return Math.round(x * 1000) / 1000; }

/**
 * @returns CutPlan (see docs/CONTRACT.md)
 */
export function optimizeGroup({
  groupKey, pieces = [], stock = [], kerfIn = 0.125, endTrimIn = 0, minUsableOffcutIn = 12,
  objective = 'waste', mode = 'reviewed', timeLimitMs = 1500, nodeLimit = 400000, stockToleranceIn = 0,
} = {}) {
  const t0 = Date.now();
  const kerf = mode === 'nominal' ? 0 : Number(kerfIn) || 0;
  const trim = mode === 'nominal' ? 0 : Number(endTrimIn) || 0;
  const notes = [];

  const stockSorted = [...stock].map(s => ({ ...s, lengthIn: s.lengthFt * 12 + (mode === 'nominal' ? 0 : stockToleranceIn) }))
    .sort((a, b) => a.lengthFt - b.lengthFt);
  const inStock = stockSorted.filter(s => !s.specialOrder);
  const special = stockSorted.filter(s => s.specialOrder);

  // Objective feasibility: cost needs every candidate price.
  let obj = objective;
  if (obj === 'cost' && stockSorted.some(s => s.priceCents == null)) {
    obj = 'waste';
    notes.push('Cost objective requested but not every stock length has a known price — optimized for least waste instead.');
  }
  const costOf = s => (obj === 'cost' ? s.priceCents : s.lengthIn);

  const items = pieces.map(p => ({
    piece: p,
    len: mode === 'nominal' ? (p.nominalLengthIn ?? p.lengthIn) : p.lengthIn,
    allowed: Array.isArray(p.allowedStockFt) && p.allowedStockFt.length ? new Set(p.allowedStockFt) : null,
  }));

  const infeasible = [];
  const forced = [];   // need special order
  const normal = [];
  for (const it of items) {
    if (!(it.len > 0)) { infeasible.push({ pieceId: it.piece.id, label: it.piece.label, reason: 'Piece length unknown or zero' }); continue; }
    const permitted = inStock.filter(s => (!it.allowed || it.allowed.has(s.lengthFt)) && fitsOn(s.lengthIn, [it.len], kerf, trim));
    if (permitted.length) { it.lengths = permitted; normal.push(it); continue; }
    const sp = special.filter(s => (!it.allowed || it.allowed.has(s.lengthFt)) && fitsOn(s.lengthIn, [it.len], kerf, trim));
    if (sp.length) { it.lengths = [sp[0]]; forced.push(it); continue; }
    const maxAll = Math.max(0, ...stockSorted.filter(s => !it.allowed || it.allowed.has(s.lengthFt)).map(s => s.lengthIn));
    infeasible.push({
      pieceId: it.piece.id, label: it.piece.label,
      reason: `${round3(it.len)}" continuous piece is longer than every permitted stock length (${maxAll ? round3(maxAll - trim) + '" usable' : 'none permitted'}). Splicing is not allowed without approval.`,
    });
  }

  // Pre-opened special-order boards (one per forced piece, shortest special length that fits).
  forced.sort((a, b) => b.len - a.len);
  const fixedBins = forced.map(it => ({
    fixed: true, used: [it], lengths: [it.lengths[0]],
    reason: `${round3(it.len)}" ${it.piece.label || 'piece'} must be continuous and exceeds every in-stock length`,
  }));

  // ---------- search over normal pieces ----------
  normal.sort((a, b) => b.len - a.len || String(a.piece.id).localeCompare(String(b.piece.id)));
  const typeKey = it => `${it.len}|${it.allowed ? [...it.allowed].sort().join(',') : '*'}`;
  normal.forEach(it => { it.tk = typeKey(it); });

  const binLengths = (bin) => bin.used.map(u => u.len);
  const binCost = (bin) => {
    const ls = binLengths(bin);
    let best = null;
    for (const s of bin.lengths) {
      if (fitsOn(s.lengthIn, ls, kerf, trim)) {
        const c = costOf(s);
        if (best === null || c < best.c || (c === best.c && s.lengthIn < best.s.lengthIn)) best = { c, s };
      }
    }
    return best;
  };
  const allowedFor = (it, bin) => {
    // intersection of bin's permitted lengths and the piece's allowed lengths
    if (bin.fixed) return (!it.allowed || it.allowed.has(bin.lengths[0].lengthFt)) ? bin.lengths : [];
    return bin.lengths.filter(s => it.lengths.includes(s));
  };

  function evaluate(bins) {
    let cost = 0, n = 0;
    for (const b of bins) { const bc = binCost(b); if (!bc) return null; cost += bc.c; n++; }
    return { cost, n };
  }
  const better = (a, b) => !b || a.cost < b.cost - EPS || (Math.abs(a.cost - b.cost) <= EPS && a.n < b.n);

  const cloneBins = bins => bins.map(b => ({ ...b, used: [...b.used], lengths: [...b.lengths] }));

  // Greedy placement with a capacity preference.
  function greedy(order, capPrefFt, strategy) {
    const bins = cloneBins(fixedBins);
    for (const it of order) {
      let chosen = null, chosenScore = Infinity;
      for (const b of bins) {
        const ls = allowedFor(it, b);
        if (!ls.length) continue;
        const cand = { ...b, used: [...b.used, it], lengths: ls };
        const capLs = b.fixed ? ls : ls.filter(s => !capPrefFt || s.lengthFt <= capPrefFt);
        const test = capLs.length ? { ...cand, lengths: capLs } : null;
        const bc = test && binCost(test);
        if (!bc) continue;
        if (strategy === 'first') { chosen = { b, ls: test.lengths }; break; }
        const slack = bc.s.lengthIn - requiredIn(binLengths(cand), kerf) - trim;
        if (slack < chosenScore) { chosenScore = slack; chosen = { b, ls: test.lengths }; }
      }
      if (chosen) { chosen.b.used.push(it); if (!chosen.b.fixed) chosen.b.lengths = chosen.ls; }
      else {
        let ls = it.lengths.filter(s => !capPrefFt || s.lengthFt <= capPrefFt);
        if (!ls.length) ls = it.lengths;
        bins.push({ fixed: false, used: [it], lengths: ls });
      }
    }
    return bins;
  }

  let best = null, bestBins = null;
  const consider = (bins) => {
    const ev = evaluate(bins);
    if (ev && better(ev, best)) { best = ev; bestBins = cloneBins(bins); }
  };
  const caps = [null, ...inStock.map(s => s.lengthFt)];
  for (const cap of caps) for (const strat of ['first', 'best']) consider(greedy(normal, cap, strat));
  // Simple improvement: pair-wise repack of the two emptiest bins is covered by B&B; keep greedy seed.

  // Lower bound: cost of fixed bins + remaining length beyond their slack (waste objective) or price ratio (cost).
  const minRate = obj === 'cost'
    ? Math.min(...inStock.map(s => (s.priceCents ?? Infinity) / s.lengthIn))
    : 1;
  const totalLen = normal.reduce((a, it) => a + it.len, 0);
  const fixedEval = evaluate(fixedBins) || { cost: 0, n: 0 };
  const fixedSlack = fixedBins.reduce((a, b) => { const bc = binCost(b); return a + (bc ? bc.s.lengthIn - requiredIn(binLengths(b), kerf) - trim : 0); }, 0);
  const rootLB = fixedEval.cost + Math.max(0, totalLen - fixedSlack) * minRate;

  // ---------- branch and bound ----------
  let nodes = 0, exhausted = true;
  const deadline = t0 + timeLimitMs;
  const maxStockIn = Math.max(0, ...inStock.map(s => s.lengthIn));
  const boardLB = fixedBins.length + (maxStockIn ? Math.ceil(Math.max(0, totalLen - fixedSlack) / maxStockIn - EPS) : 0);
  const rootDone = () => best && best.cost <= rootLB + EPS && best.n <= boardLB;
  if (normal.length && best && !rootDone()) {
    const bins = cloneBins(fixedBins);
    const binState = bins.map(b => { const bc = binCost(b); return { c: bc ? bc.c : 0, s: bc?.s }; });
    let curCost = binState.reduce((a, x) => a + x.c, 0);
    const suffixLen = new Array(normal.length + 1).fill(0);
    for (let i = normal.length - 1; i >= 0; i--) suffixLen[i] = suffixLen[i + 1] + normal[i].len;
    const lastBinOfType = new Map();

    const dfs = (i) => {
      if (++nodes > nodeLimit || (nodes % 1024 === 0 && Date.now() > deadline)) { exhausted = false; return; }
      if (!exhausted) return;
      if (i === normal.length) {
        const ev = { cost: curCost, n: bins.length };
        if (better(ev, best)) { best = ev; bestBins = cloneBins(bins); }
        return;
      }
      // bound: slack within current chosen lengths
      let slack = 0;
      for (let k = 0; k < bins.length; k++) {
        const st = binState[k];
        if (st.s) slack += Math.max(0, st.s.lengthIn - trim - requiredIn(binLengths(bins[k]), kerf));
      }
      const lb = curCost + Math.max(0, suffixLen[i] - slack) * minRate;
      if (lb > best.cost + EPS) return;
      if (lb >= best.cost - EPS && bins.length >= best.n) return; // cannot beat on tie-break either
      const it = normal[i];
      const startBin = (i > 0 && normal[i - 1].tk === it.tk) ? (lastBinOfType.get(i - 1) ?? 0) : 0;
      const seen = new Set();
      for (let k = startBin; k < bins.length; k++) {
        const b = bins[k];
        const ls = allowedFor(it, b);
        if (!ls.length) continue;
        const sig = `${b.fixed ? 'F' : 'N'}|${binLengths(b).join(',')}|${b.lengths.map(s => s.lengthFt).join(',')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const prevLs = b.lengths, prevState = binState[k];
        b.used.push(it); b.lengths = b.fixed ? prevLs : ls;
        const bc = binCost(b);
        if (bc) {
          binState[k] = { c: bc.c, s: bc.s };
          curCost += bc.c - prevState.c;
          lastBinOfType.set(i, k);
          dfs(i + 1);
          curCost -= bc.c - prevState.c;
        }
        b.used.pop(); b.lengths = prevLs; binState[k] = prevState;
        if (!exhausted) return;
      }
      // open a new bin
      const nb = { fixed: false, used: [it], lengths: it.lengths };
      const bc = binCost(nb);
      if (bc) {
        bins.push(nb); binState.push({ c: bc.c, s: bc.s }); curCost += bc.c;
        lastBinOfType.set(i, bins.length - 1);
        dfs(i + 1);
        bins.pop(); binState.pop(); curCost -= bc.c;
      }
    };
    dfs(0);
  }
  const proof = (!normal.length || !best || rootDone() || exhausted) ? 'optimal' : 'best-found';

  // ---------- materialize ----------
  const finalBins = bestBins || cloneBins(fixedBins);
  const prefix = boardPrefix(groupKey);
  const boards = finalBins.map(b => {
    const bc = binCost(b);
    const s = bc ? bc.s : b.lengths[0];
    const cuts = [...b.used].sort((x, y) => y.len - x.len).map(u => ({
      pieceId: u.piece.id, label: u.piece.label, componentId: u.piece.componentId, lengthIn: round3(u.len),
      allowanceEligible: u.piece.allowanceEligible !== false, workPackage: u.piece.workPackage,
    }));
    const L = s.lengthFt * 12;
    const sum = cuts.reduce((a, c) => a + c.lengthIn, 0);
    const between = kerf * Math.max(0, cuts.length - 1);
    const afterLast = L - trim - sum - between;
    const finalKerf = afterLast > EPS ? Math.min(kerf, afterLast) : 0;
    const sawLossIn = round3(trim + between + finalKerf);
    const offcutIn = round3(Math.max(0, L - sum - sawLossIn));
    const usableOffcutIn = offcutIn >= minUsableOffcutIn ? offcutIn : 0;
    return {
      productKey: `${groupKey}:${s.lengthFt}`, stockLengthFt: s.lengthFt, specialOrder: !!s.specialOrder,
      reason: b.fixed ? b.reason : undefined, cuts, sawLossIn, offcutIn, usableOffcutIn,
      wasteIn: round3(offcutIn - usableOffcutIn), notes: [],
    };
  });
  boards.sort((a, b) => (b.specialOrder - a.specialOrder) || b.stockLengthFt - a.stockLengthFt
    || String(a.cuts[0]?.label || '').localeCompare(String(b.cuts[0]?.label || '')));
  boards.forEach((b, i) => { b.id = `${prefix}-${String(i + 1).padStart(2, '0')}`; });

  const conflicts = mode === 'reviewed' ? detectExactFitConflicts(items, inStock, kerf, trim) : [];
  const purchasedIn = boards.reduce((a, b) => a + b.stockLengthFt * 12, 0);
  const requiredInTotal = items.reduce((a, it) => a + (it.len > 0 ? it.len : 0), 0);
  if (proof === 'best-found') notes.push('Search budget reached — this is the best plan found, not a proven optimum.');

  return {
    groupKey, mode, kerfIn: kerf, endTrimIn: trim, objective: obj,
    boards, infeasible, conflicts, proof, notes,
    stats: { purchasedIn: round3(purchasedIn), requiredIn: round3(requiredInTotal), nodes, timeMs: Date.now() - t0,
             lowerBound: round3(rootLB), boards: boards.length },
  };
}

/** Report pieces that would fit a stock length exactly if there were no saw kerf. */
export function detectExactFitConflicts(items, inStock, kerf, trim) {
  if (!(kerf > 0)) return [];
  const out = [];
  const types = new Map();
  for (const it of items) {
    if (!(it.len > 0)) continue;
    const k = round3(it.len);
    if (!types.has(k)) types.set(k, []);
    types.get(k).push(it);
  }
  const lens = [...types.keys()];
  const seen = new Set();
  for (const s of inStock) {
    const usable = s.lengthIn - trim;
    const permitted = (L) => types.get(L).some(it => !it.allowed || it.allowed.has(s.lengthFt));
    // k copies of one length
    for (const L of lens) {
      if (!permitted(L)) continue;
      for (let n = 2; n <= 6; n++) {
        if (types.get(L).length < n) break;
        if (Math.abs(L * n - usable) < 1e-6) {
          const key = `${s.lengthFt}|${L}x${n}`;
          if (seen.has(key)) continue; seen.add(key);
          const need = round3(L * n + kerf * (n - 1));
          const fit = Math.floor((usable + kerf + EPS) / (L + kerf));
          const left = round3(s.lengthIn - fit * L - Math.min(kerf * fit, s.lengthIn - fit * L));
          out.push({
            text: `${n} × ${L}" pieces need ${need}" including ${kerf}" kerf — a ${s.lengthFt}' board yields ${fit} piece${fit === 1 ? '' : 's'} + ${left}" offcut.`,
            pieceIds: types.get(L).map(it => it.piece.id),
            suggestion: `Shorten each piece by ${kerf}" (to ${round3(L - kerf)}") if the design allows, or accept ${fit} per ${s.lengthFt}' board.`,
          });
        }
      }
    }
    // pairs of distinct lengths
    for (let a = 0; a < lens.length; a++) for (let b = a + 1; b < lens.length; b++) {
      const La = lens[a], Lb = lens[b];
      if (!permitted(La) || !permitted(Lb)) continue;
      if (Math.abs(La + Lb - usable) < 1e-6) {
        const key = `${s.lengthFt}|${La}+${Lb}`;
        if (seen.has(key)) continue; seen.add(key);
        out.push({
          text: `${La}" + ${Lb}" equals a ${s.lengthFt}' board exactly, but needs ${round3(La + Lb + kerf)}" with kerf — they cannot share one board.`,
          pieceIds: [...types.get(La), ...types.get(Lb)].map(it => it.piece.id),
          suggestion: `Shorten one piece by ${kerf}" if the design allows; otherwise they are cut from separate boards.`,
        });
      }
    }
  }
  return out;
}

/** Run both objectives and explain the tradeoff when the orders differ. */
export function compareObjectives(args) {
  const waste = optimizeGroup({ ...args, objective: 'waste' });
  const canCost = (args.stock || []).every(s => s.priceCents != null);
  if (!canCost) return { waste, cost: null, tradeoff: null };
  const cost = optimizeGroup({ ...args, objective: 'cost' });
  const priceOf = (plan) => plan.boards.reduce((a, b) => a + ((args.stock.find(s => s.lengthFt === b.stockLengthFt && !!s.specialOrder === b.specialOrder)?.priceCents) ?? 0), 0);
  const wIn = waste.stats.purchasedIn, cIn = cost.stats.purchasedIn;
  const wP = priceOf(waste), cP = priceOf(cost);
  let tradeoff = null;
  if (wIn !== cIn || wP !== cP) {
    tradeoff = `Least-waste order buys ${wIn / 12} lf for $${(wP / 100).toFixed(2)}; least-cost order buys ${cIn / 12} lf for $${(cP / 100).toFixed(2)}.`;
  }
  return { waste, cost, tradeoff, wastePriceCents: wP, costPriceCents: cP };
}
