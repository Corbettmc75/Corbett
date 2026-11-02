// Trellis takeoff: 6x6 posts (exact count), Y braces, paired 2x12 headers, 2x4 slats, mesh.
import { collector, finish, ftIn, wallMaterial, round } from './util.js';

export function takeoff(tr, ctx) {
  const { rules } = ctx;
  const R = rules.trellis;
  const c = collector(tr);
  const p = tr.props || {};
  const bed = ctx.componentsById[p.bedId];
  const mat = p.material && !/tbd/i.test(p.material) ? p.material : wallMaterial(bed, rules);
  const bedH = Number(bed?.props?.heightIn ?? rules.bed.heightIn);
  const L = Number(p.lengthFt ?? tr.geometry?.lengthFt);
  const posts = Number(p.posts);
  c.metrics = { lengthFt: L || null, posts: posts || 0, material: mat };

  if (!bed) c.q({ id: `q.trellis-bed:${tr.id}`, type: 'missing_dimension', text: `${tr.name}: which bed does it stand in? Bed height sets the post length.` });

  // ---- posts -------------------------------------------------------------
  const postGroup = `lumber:${mat}:6x6`;
  const postLen = bedH + R.topAboveBedIn + R.embedIn;
  if (!(posts > 0)) c.q({ id: `q.trellis-posts:${tr.id}`, type: 'missing_dimension', text: `${tr.name}: how many 6×6 posts?` });
  for (let k = 1; k <= (posts || 0); k++) {
    c.piece({ id: `${tr.id}:post${k}`, groupKey: postGroup, lengthIn: postLen,
      label: `${tr.name} — post ${k} (${bedH}" bed + ${R.topAboveBedIn}" above + ${R.embedIn}" embed)`, role: 'trellis-post',
      allowedStockFt: R.postStockFt, allowanceEligible: false, workPackage: 'wp3' });
  }
  c.metrics.postLengthIn = postLen;

  // ---- braces --------------------------------------------------------------
  const bpp = R.bracesPerPost;
  const braceQ = bpp == null ? c.q({ id: 'q.braces-per-post', type: 'construction_detail',
    text: 'Y-detail: how many 19" 6×6 braces per trellis post (end posts vs middle posts)?', provisional: '2 per post assumed' }) : null;
  const angleQ = !(R.braceAngleEnvelopeIn > 0) ? c.q({ id: 'q.brace-angle', type: 'construction_detail',
    text: 'Brace angle cuts: is 19" the long-point length, and how much extra stock does each angled end need?', provisional: '19" stock per brace, no extra' }) : null;
  const braceLen = R.braceLengthIn + (R.braceAngleEnvelopeIn || 0);
  const nBr = (posts || 0) * (bpp ?? 2);
  for (let k = 1; k <= nBr; k++) {
    c.piece({ id: `${tr.id}:brace${k}`, groupKey: postGroup, lengthIn: braceLen, nominalLengthIn: R.braceLengthIn,
      label: `${tr.name} — Y brace ${k} (${R.braceLengthIn}" finished)`, role: 'trellis-brace', allowanceEligible: false,
      allowedStockFt: R.braceStockFt ?? null,
      workPackage: 'wp3', status: bpp == null ? 'provisional' : 'ok', questionIds: [braceQ, angleQ].filter(Boolean) });
  }
  const kerf = rules.lumber.kerfIn;
  const stockIn = Math.max(...R.postStockFt) * 12;
  if (postLen + kerf + braceLen > stockIn) {
    const left = stockIn - postLen;
    c.q({ id: 'q.brace-offcut', type: 'construction_detail',
      text: `${postLen}" post leaves ${left}" before kerf on a ${stockIn / 12}' 6×6 — cannot yield a ${braceLen}" brace. Braces need separate 6×6 stock (planned) — OK?`,
      provisional: 'Braces cut from separate 6×6 stock.' });
  }

  // ---- headers -------------------------------------------------------------
  const hc = Number(p.headerCount ?? 0), hl = Number(p.headerLengthFt ?? L);
  if (!(hl > 0)) c.q({ id: `q.header-length:${tr.id}`, type: 'missing_dimension', text: `${tr.name}: header length?` });
  else for (let k = 1; k <= hc; k++) {
    c.piece({ id: `${tr.id}:header${k}`, groupKey: `lumber:${mat}:2x12`, lengthIn: hl * 12,
      label: `${tr.name} — 2×12 header ${k} of ${hc} (continuous ${ftIn(hl * 12)}, angle-cut ends within length)`, role: 'trellis-header',
      allowedStockFt: [hl], mustBeContinuous: true, allowanceEligible: false, workPackage: 'wp3' });
  }

  // ---- slats ---------------------------------------------------------------
  const slatLen = p.slatLengthIn ?? R.slatLengthIn;
  const spacing = p.slatSpacingIn ?? R.slatSpacingIn;
  const mode = R.slatSpacingMode;
  if (mode == null) c.q({ id: 'q.slat-spacing', type: 'construction_detail', text: `2×4 slat spacing ${spacing}": clear gap or on-center?`, provisional: 'on-center' });
  if (slatLen == null) {
    c.q({ id: 'q.slat-length', type: 'construction_detail', text: 'Finished 2×4 slat length is not dimensioned — what length (and which direction do slats run)?' });
    c.req({ productKey: `lumber:${mat}:2x4`, role: 'slats', unit: 'board', qty: null, workPackage: 'wp3', status: 'unresolved',
      formula: 'Slat count/length waits on slat length', questionIds: ['q.slat-length', 'q.slat-spacing'] });
  } else if (L > 0) {
    const run = L * 12;
    const count = mode === 'clear' ? Math.floor((run + spacing) / (3.5 + spacing)) : Math.floor(run / spacing) + 1;
    for (let k = 1; k <= count; k++) {
      c.piece({ id: `${tr.id}:slat${k}`, groupKey: `lumber:${mat}:2x4`, lengthIn: Number(slatLen),
        label: `${tr.name} — slat ${k}`, role: 'trellis-slat', allowanceEligible: true, workPackage: 'wp3',
        status: mode == null ? 'provisional' : 'ok', questionIds: mode == null ? ['q.slat-spacing'] : [] });
    }
    c.metrics.slats = count;
  }

  // ---- mesh ----------------------------------------------------------------
  const rebar = rules.trellis.meshOption === 'rebar';
  const meshKey = rebar ? 'mesh:rebar-grid' : 'mesh:welded-6x6-0187';
  // Mesh fills between posts from the bed top to the underside of the header; bought by coverage, cut to fit.
  const headerDepthIn = 11.25;
  const meshH = rules.trellis.meshAttachSpacingIn != null ? R.topAboveBedIn - headerDepthIn : null;
  const clearIn = L ? L * 12 - 2 * R.postInsetFromBoxEdgeIn - (Number(p.posts) || 0) * 5.5 : null;
  const panels = Math.max(1, (Number(p.posts) || 2) - 1);
  if (meshH == null) c.q({ id: 'q.mesh-panel', type: 'product_spec',
    text: 'Trellis mesh: coverage is per trellis, but the purchasable panel size (W×H) and attachment hardware are not specified. Which panel?' });
  const cover = meshH != null && clearIn != null ? clearIn * meshH / 144 : null;
  c.req({ productKey: meshKey, role: 'mesh', unit: 'sqft', qty: cover == null ? null : round(cover, 1), workPackage: 'wp3', status: cover == null ? 'unresolved' : 'ok',
    basis: 'calculation',
    formula: cover == null ? `${L || '?'}' trellis × mesh height (not dimensioned)` : `${round(clearIn, 2)}" clear between posts (${L}' − 2 × ${R.postInsetFromBoxEdgeIn}" inset − ${p.posts} × 5.5" posts) × ${meshH}" (74" − 11.25" header)`,
    refs: [rebar ? 'proposal:option basic rebar mesh grid' : 'proposal:upgraded welded mesh 6×6, 0.187" wire'], questionIds: ['q.mesh-panel'] });
  const perim = cover == null ? null : 2 * (clearIn / panels + meshH);
  c.req({ productKey: 'mesh:attachment', role: 'mesh-attachment', unit: 'ea', workPackage: 'wp3', status: perim == null ? 'unresolved' : 'ok',
    qty: perim == null ? null : panels * Math.ceil(perim / rules.trellis.meshAttachSpacingIn),
    formula: perim == null ? 'Attachment hardware not specified' : `${panels} panel(s) × perimeter ${round(perim, 1)}" ÷ ${rules.trellis.meshAttachSpacingIn}" (galvanized fence staples)`, questionIds: ['q.mesh-panel'] });
  return finish(c);
}
