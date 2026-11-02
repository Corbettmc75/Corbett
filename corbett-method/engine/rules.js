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
  rules.irrigation.include = !!job.scope?.irrigation;
  rules.lighting.include = !!job.scope?.lighting;
  rules.scenarioId = scen?.id ?? null;
  return rules;
}

export function lumberGroups() { return LUMBER_GROUPS; }
