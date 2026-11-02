// The Corbett Method — reusable construction standards.
// Every value carries a status: 'confirmed' (stated by Corbett), or 'default'
// (a working assumption that must be confirmed; the engine raises a question).
// Job settings, scenario overrides and answered questions override these.

export const DEFAULT_RULES = {
  version: 1,
  lumber: {
    kerfIn: 0.125,                 // confirmed planning assumption (1/8")
    endTrimIn: 0,                  // default: factory ends assumed square; confirm
    minUsableOffcutIn: 12,         // default: shorter offcuts are reported as waste
    extraAllowancePct: 15,         // confirmed; shown separately; not on fixtures/trellis posts/headers
    stockLengthToleranceIn: 0,     // default: boards assumed exactly nominal length
    objective: 'waste',            // 'waste' | 'cost' (cost only when all stock prices known)
    allowSplice: false,            // never splice continuous runs without approval
  },
  bed: {
    courses: 5,
    courseHeightIn: 5.5,
    heightIn: 27.5,
    wallMaterial: 'cedartone',     // follows proposal/drawing; scenario may override
    cornerRule: 'interlaced',      // CONFIRMED by Corbett's corner photo (Rodenbostel proposal p4): through-board alternates every course
    interlaceStart: 'long',        // default: course 1 (bottom) long walls run through; confirm → q.interlace-start
    // other options kept for special cases: 'nominal' (outside lengths, unverified) | 'butt'
    postEmbedIn: 24,               // confirmed
    postTopBelowBedTopIn: 3.5,     // confirmed
    postGroup: 'lumber:pt:4x4',
    postStockFt: [8],              // confirmed: PT 4x4 bed posts from 8' stock only
    middleSupportOverFt: 5,        // confirmed: runs over 5' get one middle support
    longRunReviewOverFt: 10,       // default: longer runs need explicit support-layout review
    provisionalMaxSpanFt: 5,       // default used only for provisional support counts on long runs
    supportGroup: 'lumber:pt:2x4', // cross member + opposing vertical
    verticalLengthRule: 'post-top',// default: vertical 2x4 = bed height − post-top offset
    screwKey: 'screw:deck:3in',
    screwsPerBoardEnd: null,       // recorded "3 per 2x6 and 2 to connect to posts" — unconfirmed → q.screw-rule
  },
  concrete: {
    productKey: 'concrete:fast-set:50lb',
    bagsPer6x6: 1,                 // confirmed
    fourByFoursPerBag: 2,          // confirmed: 1 bag per 2 installed 4x4, rounded up
  },
  soil: {
    premiumTopIn: 12,              // confirmed
    basicKey: 'soil:basic-organic',
    premiumKey: 'soil:premium-organic',
    unit: 'cy',
    roundToCy: 0.25,               // quarter-yard delivery rounding
    settlementPct: null,           // not established — never invented
    compostKey: 'compost:cow:1cf',
    compostSqFtPerBag: 15,         // confirmed
    compostAreaBasis: 'inside',    // default: inside soil area → q.compost-area
  },
  liner: {
    productKey: 'liner:6mil-black:20x100',
    rollWidthFt: 20, rollLengthFt: 100,
    lapIn: null,                   // not established → q.liner-lap
    topAllowanceIn: 0,             // default → q.liner-allowance
    bottomAllowanceIn: 0,          // default → q.liner-allowance
    stapleKey: 'staple:liner',
    stapleSpacingIn: null,         // not established → q.staple-spacing
  },
  trim: {
    group: 'lumber:cedartone:1x4', // matches wall material; resolved per bed
    stockFt: [16],                 // confirmed current standard
    thicknessIn: 0.75,
    screwKey: 'screw:trim',
    screwSpacingIn: null,          // not established → q.trim-screws
  },
  trellis: {
    postGroupSuffix: '6x6',
    postStockFt: [12],             // confirmed: normally 6x6x12
    topAboveBedIn: 74,             // confirmed 6'2"
    embedIn: 24,                   // confirmed
    postInsetFromBoxEdgeIn: 15,    // confirmed (normal)
    replacesCornerPost: true,      // confirmed
    braceLengthIn: 19,             // confirmed finished length
    braceStockFt: null,
    meshAttachSpacingIn: null,     // standard assumption: 12" fence staples            // standard assumption: braces from 6×6×8 (12' post offcuts are too short)
    bracesPerPost: null,           // not established → q.braces-per-post
    braceAngleEnvelopeIn: 0,       // default → q.brace-angle
    slatSpacingIn: 12,             // recorded; clear vs on-center unconfirmed → q.slat-spacing
    slatSpacingMode: null,         // 'clear' | 'on-center'
    slatLengthIn: null,            // not established unless drawn → q.slat-length
    headerAllowance: false,        // confirmed: no automatic spare headers
  },
  path: {
    gravelIn: 3, fabric: true, dgIn: 1.5,            // confirmed standard layers
    gravelKey: 'aggregate:landscape-gravel',
    dgKey: 'aggregate:decomposed-granite',
    fabricKey: 'fabric:landscape',
    compactionFactor: null,        // only when supplier data supports it
  },
  edging: {
    stickKey: 'edging:snap-edge:8ft', stickLengthFt: 8,
    spikeKey: 'edging:spike:10in', spikeSpacingIn: 18,
    endSpikes: null,               // endpoint/corner rule unconfirmed → q.edging-ends
  },
  hardscape: {
    baseKey: 'aggregate:paver-base', baseIn: null,   // standard assumption: 6" compacted base
    sandKey: 'sand:bedding', sandIn: null,           // standard assumption: 1" bedding sand
    borderWidthIn: null,                             // measured from drawing when present
  },
  screen: { courses: null, postSpacingFt: null, postEmbedIn: 24, postSection: '4x4' },
  mulch: { depthIn: null },
  rock: { depthIn: null },
  drain: { fittings: null },
  assume: { patioBorder: null, demolitionIsService: null, packagesCoverCount: null, compactedVolumes: null },
  irrigation: { include: false },
  lighting:   { include: false },
};

// Statuses for display/audit (keys are dotted paths).
export const RULE_STATUS = {
  'lumber.kerfIn': 'confirmed', 'lumber.extraAllowancePct': 'confirmed',
  'lumber.endTrimIn': 'default', 'lumber.minUsableOffcutIn': 'default',
  'bed.cornerRule': 'confirmed', 'bed.interlaceStart': 'default', 'bed.postEmbedIn': 'confirmed', 'bed.postTopBelowBedTopIn': 'confirmed',
  'bed.postStockFt': 'confirmed', 'bed.middleSupportOverFt': 'confirmed',
  'concrete.bagsPer6x6': 'confirmed', 'concrete.fourByFoursPerBag': 'confirmed',
  'soil.premiumTopIn': 'confirmed', 'soil.compostSqFtPerBag': 'confirmed',
  'trim.stockFt': 'confirmed', 'trellis.postStockFt': 'confirmed', 'trellis.topAboveBedIn': 'confirmed',
  'trellis.embedIn': 'confirmed', 'trellis.braceLengthIn': 'confirmed', 'trellis.slatSpacingIn': 'recorded',
  'path.gravelIn': 'confirmed', 'path.dgIn': 'confirmed', 'edging.spikeSpacingIn': 'confirmed',
};

// Lumber compatibility pools. Stock lengths = in-stock lengths for that product.
// specialOrderFt lengths are used ONLY when a required continuous piece exceeds all in-stock lengths.
export const LUMBER_GROUPS = {
  'lumber:cedartone:2x6':   { label: 'CedarTone 2×6',          actualIn: [1.5, 5.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [20] },
  'lumber:smooth-cedar:2x6':{ label: 'Smooth cedar 2×6',       actualIn: [1.5, 5.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [] },
  'lumber:rough-cedar:2x6': { label: 'Rough-sawn cedar 2×6',   actualIn: [1.5, 5.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [] },
  'lumber:cedartone:6x6':   { label: 'CedarTone 6×6',          actualIn: [5.5, 5.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:smooth-cedar:6x6':{ label: 'Smooth cedar 6×6',       actualIn: [5.5, 5.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:rough-cedar:6x6': { label: 'Rough-sawn cedar 6×6',   actualIn: [5.5, 5.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:cedartone:2x12':  { label: 'CedarTone 2×12',         actualIn: [1.5, 11.25],stockFt: [8, 10, 12, 16], specialOrderFt: [20] },
  'lumber:smooth-cedar:2x12':{ label: 'Smooth cedar 2×12',     actualIn: [1.5, 11.25],stockFt: [8, 12, 16], specialOrderFt: [20] },
  'lumber:rough-cedar:2x12':{ label: 'Rough-sawn cedar 2×12',  actualIn: [1.5, 11.25],stockFt: [8, 12, 16], specialOrderFt: [20] },
  'lumber:cedartone:4x4':   { label: 'CedarTone 4×4',          actualIn: [3.5, 3.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:smooth-cedar:4x4':{ label: 'Smooth cedar 4×4',       actualIn: [3.5, 3.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:rough-cedar:4x4': { label: 'Rough-sawn cedar 4×4',   actualIn: [3.5, 3.5],  stockFt: [8, 10, 12], specialOrderFt: [] },
  'lumber:cedartone:2x4':   { label: 'CedarTone 2×4',          actualIn: [1.5, 3.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [] },
  'lumber:rough-cedar:2x4': { label: 'Rough-sawn cedar 2×4',   actualIn: [1.5, 3.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [] },
  'lumber:cedartone:1x4':   { label: 'CedarTone 1×4 trim',     actualIn: [0.75, 3.5], stockFt: [16], specialOrderFt: [] },
  'lumber:rough-cedar:1x4': { label: 'Rough-sawn cedar 1×4 trim', actualIn: [0.75, 3.5], stockFt: [16], specialOrderFt: [] },
  'lumber:pt:4x4':          { label: 'Pressure-treated 4×4 (ground contact)', actualIn: [3.5, 3.5], stockFt: [8], specialOrderFt: [] },
  'lumber:pt:2x4':          { label: 'Pressure-treated 2×4',   actualIn: [1.5, 3.5],  stockFt: [8, 10, 12, 16], specialOrderFt: [] },
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = value;
}

function applySettings(target, settings) {
  for (const [k, v] of Object.entries(settings || {})) {
    if (k.includes('.')) setPath(target, k, v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') applySettings(target[k], v);
    else target[k] = v;
  }
}

// Answers to questions that map directly onto a rule path.
export const ANSWER_TO_RULE = {
  'q.corner-rule': 'bed.cornerRule',
  'q.interlace-start': 'bed.interlaceStart',
  'q.screw-rule': 'bed.screwsPerBoardEnd',
  'q.liner-lap': 'liner.lapIn',
  'q.staple-spacing': 'liner.stapleSpacingIn',
  'q.trim-screws': 'trim.screwSpacingIn',
  'q.braces-per-post': 'trellis.bracesPerPost',
  'q.brace-angle': 'trellis.braceAngleEnvelopeIn',
  'q.slat-spacing': 'trellis.slatSpacingMode',
  'q.slat-length': 'trellis.slatLengthIn',
  'q.edging-ends': 'edging.endSpikes',
  'q.compost-area': 'soil.compostAreaBasis',
  'q.end-trim': 'lumber.endTrimIn',
};

/**
 * Standard assumptions — the Corbett Method answers to details a drawing never shows.
 * Applied automatically (no questions for Corbett) unless a job answer or setting overrides them;
 * every one is listed on the estimate so it stays visible and changeable.
 * `ids` are question ids (or id prefixes ending in ':') that the assumption settles.
 */
export const ASSUMPTION_APPLIES_TO = {
  interlace: ['bed'], screws: ['bed'], supports: ['bed'], postfit: ['bed'], liner: ['bed'], staples: ['bed'], trimscrews: ['bed'], compost: ['bed'],
  braces: ['trellis'], slats: ['trellis'], mesh: ['trellis'], edging: ['edging'], hardscape: ['patio', 'stoop'], border: ['patio'],
  screens: ['screen', 'fence'], mulch: ['mulch'], rock: ['rock'], demo: ['demolition'], drain: ['drain'], compaction: ['path'], packages: [],
};
export const STANDARD_ASSUMPTIONS = [
  { key: 'interlace', ids: ['q.interlace-start'], set: { 'bed.interlaceStart': 'long' }, text: 'Interlaced corners start with the long walls running through on the bottom course.' },
  { key: 'screws', ids: ['q.screw-rule'], set: { 'bed.screwsPerBoardEnd': 3 }, text: '3 deck screws per board end at every corner and post (as in the corner photo).' },
  { key: 'supports', ids: ['q.support-layout', 'q.support-layout:', 'q.support-layout-L', 'q.support-vertical'], set: {}, text: 'Middle supports keep every wall span at 5 ft or less; the opposing vertical 2×4 runs from grade to 3.5" below the top (24").' },
  { key: 'postfit', ids: ['q.exact-fit:lumber:pt:4x4'], set: {}, text: 'Each 8 ft PT 4×4 gives one 48" bed post (two would be ⅛" short with the saw cut); the 47⅞" offcuts are kept for blocking.' },
  { key: 'liner', ids: ['q.liner-lap', 'q.liner-allowance'], set: { 'liner.lapIn': 6 }, text: 'Liner strips cut to the full 27.5" wall height and overlapped 6" where they meet.' },
  { key: 'staples', ids: ['q.staple-spacing'], set: { 'liner.stapleSpacingIn': 12 }, text: 'Liner stapled every 12" along the top edge before the trim goes on.' },
  { key: 'trimscrews', ids: ['q.trim-screws'], set: { 'trim.screwSpacingIn': 16 }, text: 'Trim screwed every 16" plus one at each end.' },
  { key: 'braces', ids: ['q.braces-per-post', 'q.brace-angle', 'q.brace-offcut'], set: { 'trellis.bracesPerPost': 2, 'trellis.braceStockFt': [8] }, text: 'Two 19" Y-braces per trellis post (19" = long point), cut from separate 6×6×8 stock because the 12 ft post offcut is too short.' },
  { key: 'slats', ids: ['q.slat-spacing', 'q.slat-length'], set: { 'trellis.slatSpacingMode': 'on-center', 'trellis.slatLengthIn': 24 }, text: '2×4 slats 24" long across the top of the paired headers, 12" on-center.' },
  { key: 'compost', ids: ['q.compost-area'], set: { 'soil.compostAreaBasis': 'inside' }, text: 'Compost check uses the inside soil area (the signed 12 bags are what gets bought).' },
  { key: 'edging', ids: ['q.edging-ends'], set: { 'edging.endSpikes': 1 }, text: 'Edging gets one extra spike at the end of every run.' },
  { key: 'hardscape', ids: ['q.patio-base', 'q.stoop-detail:'], set: { 'hardscape.baseIn': 6, 'hardscape.sandIn': 1 }, text: 'Patio and stoop step on a 6" compacted paver base with 1" bedding sand; Umbriano coping on the outer edge of the stoop wrap.' },
  { key: 'border', ids: ['q.patio-border'], set: { 'assume.patioBorder': 'proposal' }, text: 'Patio border is Unilock Copthorne (Basalt), 2 rows on 3 sides — the signed estimate (signed 9/30) is later than the drawing (9/18).' },
  { key: 'screens', ids: ['q.screen-construction'], set: { 'screen.courses': 8, 'screen.postSpacingFt': 6 }, text: 'AC screens and dog fence: 8 horizontal 2×6 courses (≈4 ft) of the box lumber on 4×4 posts at ≤6 ft, posts set 24" deep.' },
  { key: 'mulch', ids: ['q.mulch-depth:'], set: { 'mulch.depthIn': 2 }, text: 'Blue slate chips placed 2" deep.' },
  { key: 'rock', ids: ['q.rock-depth', 'q.rock-credit'], set: { 'rock.depthIn': 3 }, text: 'Dog-area rock 3" deep; existing rock is moved in first and only the shortfall is bought.' },
  { key: 'demo', ids: ['q.demo-detail'], set: { 'assume.demolitionIsService': true }, text: 'Demolition and hauling are the signed Site Prep service lines ($500 + $900) — no materials to buy.' },
  { key: 'drain', ids: ['q.drain-length', 'q.drain-fittings'], set: { 'drain.fittings': ['4" downspout adapter', '4" sump-line adapter', '4" tee', '4" pop-up emitter'] }, text: 'Drain tile runs along the side-yard fence line (route is not drawn) with a downspout adapter, sump adapter, tee and pop-up emitter.' },
  { key: 'mesh', ids: ['q.mesh-panel'], set: { 'trellis.meshAttachSpacingIn': 12 }, text: 'Welded mesh fills between posts from the bed top to the underside of the header, bought by coverage and cut to fit, fastened with galvanized fence staples every 12".' },
  { key: 'packages', ids: ['q.pkg:', 'q.package:'], set: { 'assume.packagesCoverCount': true }, text: 'Screws, staples, spikes, fabric and bulk materials: buy whatever box, roll or load covers the quantity shown.' },
  { key: 'compaction', ids: ['q.path-compaction'], set: { 'assume.compactedVolumes': true }, text: 'Gravel and DG volumes are in-place (compacted) cubic yards.' },
];

function isSet(v) { return v !== undefined && v !== null && v !== ''; }
function getPath(obj, dotted) { return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

/** Merge: DEFAULT_RULES ← shop standards ← job.settings ← selected scenario ← answered questions. */
export function resolveRules(job = {}, scenarioId = null, standards = null) {
  const rules = structuredClone(DEFAULT_RULES);
  if (standards) applySettings(rules, standards);
  applySettings(rules, job.settings);
  const scen = (job.scenarios || []).find(s => scenarioId ? s.id === scenarioId : s.selected);
  if (scen?.overrides?.settings) applySettings(rules, scen.overrides.settings);
  for (const [qid, ans] of Object.entries(job.answers || {})) {
    if (ANSWER_TO_RULE[qid] && ans && ans.value !== undefined && ans.value !== null && ans.value !== '') {
      setPath(rules, ANSWER_TO_RULE[qid], ans.value);
    }
  }
  // Standard assumptions fill whatever is still unset (job.settings.useStandardAssumptions=false turns them off).
  rules.assumptions = [];
  if (job.settings?.useStandardAssumptions !== false) {
    const answered = (id) => isSet(job.answers?.[id]?.value);
    for (const a of STANDARD_ASSUMPTIONS) {
      if (a.ids.every(id => !id.endsWith(':') && answered(id))) continue;
      for (const [path, v] of Object.entries(a.set)) if (!isSet(getPath(rules, path))) setPath(rules, path, structuredClone(v));
      rules.assumptions.push({ key: a.key, ids: a.ids, text: a.text });
    }
  }
  rules.irrigation.include = !!job.scope?.irrigation;
  rules.lighting.include = !!job.scope?.lighting;
  rules.scenarioId = scen?.id ?? null;
  return rules;
}

export function lumberGroups() { return LUMBER_GROUPS; }
