// Daily build guides: editable work packages. Supplies are taken from the SAME consolidated
// shopping rows (each purchase appears once, in the package where it is first needed).

const WP = [
  { id: 'wp1', title: 'Layout, grade, site preparation, demolition' },
  { id: 'wp2', title: 'Cut lumber and build beds' },
  { id: 'wp3', title: 'Set trellises, headers, braces, slats, mesh' },
  { id: 'wp4', title: 'Install liner and trim' },
  { id: 'wp5', title: 'Install irrigation and lighting' },
  { id: 'wp6', title: 'Fill soil and compost' },
  { id: 'wp7', title: 'Build paths, patio, stoops, and edging' },
  { id: 'wp8', title: 'Screens, planting, cleanup, and handover' },
];
export const WORK_PACKAGES = WP;

const ORDER = Object.fromEntries(WP.map((w, i) => [w.id, i]));
const earliest = list => [...list].filter(Boolean).sort((a, b) => (ORDER[a] ?? 99) - (ORDER[b] ?? 99))[0] || 'wp1';
const inch = v => `${Math.round(v * 1000) / 1000}"`;

function stepsFor(id, ctx) {
  const { types, rules, scope } = ctx;
  const has = t => types.has(t);
  const S = [];
  const add = (text, cond = true) => { if (cond) S.push(text); };
  switch (id) {
    case 'wp1':
      add('Confirm the approved drawing revision and selected scenario on site; walk the scope with the crew.');
      add('Call for utility locates before digging; confirm locate marks are clear of post holes and drain route.');
      add('Remove/dispose of items listed for demolition; relocate existing rock to the dog area before buying new rock.', has('demolition') || has('rock'));
      add('Lay out every bed, path, patio and stoop from the drawing (outside dimensions); string and paint lines.');
      add('Check grade across each bed footprint and mark the highest point — beds are built from the highest point.', has('bed'));
      add('Rough-grade path and patio areas to the required depth.', has('path') || has('patio'));
      break;
    case 'wp2':
      add('Cut wall boards per the cutting guide (board IDs below); label each piece with bed, course and wall.');
      add('Pre-drill all screw holes in wall boards.');
      add(`Starting at the highest grade point, set the bottom course level and square (check diagonals).`);
      add(`Build courses up to ${rules.bed?.courses ?? 5} × 2×6 (${rules.bed?.heightIn ?? 27.5}") interlacing corners per the approved corner detail (${rules.bed?.cornerRule === 'nominal' ? 'corner rule still to be confirmed' : rules.bed?.cornerRule}).`);
      add(`Set PT 4×4 posts at corners (except where a 6×6 trellis post replaces one): ${rules.bed?.postEmbedIn ?? 24}" embedment, tops ${rules.bed?.postTopBelowBedTopIn ?? 3.5}" below bed top.`);
      add('Set fast-setting concrete: 1 bag per 2 PT 4×4 posts.');
      add(`Runs over ${rules.bed?.middleSupportOverFt ?? 5}': middle 4×4 on one wall, PT 2×4 cross member to the opposite wall, vertical PT 2×4 screwed to every course on that opposite wall.`);
      add('Fasten with 3" deck screws per the confirmed screw pattern.');
      break;
    case 'wp3':
      add('Cut 6×6 trellis posts from 12\' stock per the cutting guide; never splice.');
      add(`Set trellis posts ${rules.trellis?.postInsetFromBoxEdgeIn ?? 15}" from the box edge, ${rules.trellis?.embedIn ?? 24}" embedment, top ${rules.trellis?.topAboveBedIn ?? 74}" above bed top; 1 bag concrete per 6×6.`);
      add('Plumb and brace posts until concrete sets; check post-to-post spacing against headers.');
      add('Install paired 2×12 headers (continuous lengths — 20\' headers are special order, never spliced).');
      add('Cut and install 6×6 Y-braces (19" finished) with angle cuts.');
      add('Install 2×4 slats at the confirmed spacing, then mesh panels with the specified hardware.');
      break;
    case 'wp4':
      add('Cut liner strips to full wall height from the 20×100 roll; walls only — never the bed bottom.');
      add('Staple liner to inside wall faces; lap joints per the confirmed lap.');
      add('Install matching 1×4 trim vertically against the inside face at the top of the bed, butt joints, to retain the liner.');
      break;
    case 'wp5':
      add('Irrigation: spigot Y splitter → Hunter BTT valve → 1" poly supply into each bed → ProTrade drip grid (12" emitters, 0.9 GPH), rows ~12" apart and 6" from edges, blow-off at the far end.', scope.irrigation);
      add('Lighting: ProTrade LL2 bed lights under the top board, spotlights as drawn, transformer sized to fixture load, cable and waterproof connectors.', scope.lighting);
      break;
    case 'wp6':
      add(`Fill basic organic soil below the top ${rules.soil?.premiumTopIn ?? 12}".`);
      add(`Fill premium organic soil in the top ${rules.soil?.premiumTopIn ?? 12}".`);
      add(`Spread cow compost (1 bag per ${rules.soil?.compostSqFtPerBag ?? 15} sq ft) and mix into the top layer.`);
      add('Record any settlement top-up actually needed (no settlement allowance is assumed).');
      break;
    case 'wp7':
      add(`Paths: ${rules.path?.gravelIn ?? 3}" landscape gravel base, landscape fabric, then ${rules.path?.dgIn ?? 1.5}" decomposed granite; compact.`, has('path'));
      add('Patio and stoops: build base per the confirmed patio/stoop base specification (kept separate from paths).', has('patio') || has('stoop'));
      add('Lay pavers, border rows and coping per the approved product (resolve border product conflict first).', has('patio') || has('stoop'));
      add(`Install black snap-edge only along marked boundaries and fences — not against boxes, foundations or existing pavers; spikes every ${rules.edging?.spikeSpacingIn ?? 18}".`, has('edging') || has('path'));
      add('Install drain tile and fittings along the confirmed route.', has('drain'));
      break;
    case 'wp8':
      add('Build 4\' AC screens and dog fence in matching lumber.', has('screen') || has('fence'));
      add('Place and plant perennials per the drawing.', has('planting'));
      add('Install mulch and rock to the confirmed depths.', has('mulch') || has('rock'));
      add('Clean up, haul debris, walk the job with the customer, record actual purchases and leftover stock.');
      break;
  }
  return S.map((text, i) => ({ id: `${id}.s${i + 1}`, text }));
}

const TOOLS = {
  wp1: ['Tape measure (100\')', 'String line & stakes', 'Marking paint', 'Laser/line level', 'Shovels, wheelbarrow'],
  wp2: ['Circular/miter saw', 'Drill/driver + pilot bits', 'Post-hole digger', 'Level (4\')', 'Framing square', 'Clamps'],
  wp3: ['Post-hole digger', 'Beam/circular saw for 6×6', 'Ladders', 'Level', 'Temporary braces', 'Drill/driver'],
  wp4: ['Utility knife', 'Stapler', 'Miter saw', 'Drill/driver'],
  wp5: ['Poly cutter', 'Punch tool', 'Wire strippers', 'Multimeter'],
  wp6: ['Wheelbarrows', 'Rakes', 'Skid steer/buggy if available'],
  wp7: ['Plate compactor', 'Screed rails', 'Rubber mallet', 'Saw for pavers', 'Rakes'],
  wp8: ['Shovels', 'Saw & drill for panels', 'Broom, blower'],
};
const CHECKS = {
  wp1: ['Layout matches drawing dimensions (outside measurements)', 'High point of each bed marked', 'Locates cleared'],
  wp2: ['Every bed level and square (diagonals equal)', 'Posts 3.5" below top, plumb', 'No spliced wall boards', 'Cut list pieces all used or labeled as offcut'],
  wp3: ['Posts plumb, at height, concrete set', 'Headers continuous and level', 'Brace/slat spacing per confirmed rule'],
  wp4: ['Liner covers full wall height on every wall, no bottom liner', 'Trim tight with butt joints'],
  wp5: ['Pressure/flow test; blow-off accessible', 'Light load ≤ transformer rating'],
  wp6: ['Premium layer is the top 12"', 'Compost bags count matches list'],
  wp7: ['Layer depths verified before next layer', 'Edging only on eligible runs'],
  wp8: ['Plant counts match list', 'Site clean; actuals recorded'],
};

export function buildGuides(est, job = {}) {
  const rules = est.rules || {};
  const scope = { irrigation: !!job.scope?.irrigation, lighting: !!job.scope?.lighting };
  const comps = (job.components || []).filter(c => !c.excluded);
  const types = new Set(comps.map(c => c.type));
  const reqById = new Map((est.requirements || []).map(r => [r.id, r]));
  const boardById = new Map();
  for (const plans of Object.values(est.cutPlans || {})) for (const b of plans.reviewed?.boards || []) boardById.set(b.id, b);

  const supplies = Object.fromEntries(WP.map(w => [w.id, []]));
  const boardsByWp = Object.fromEntries(WP.map(w => [w.id, []]));

  for (const row of est.shopping || []) {
    if (row.boardIds?.length) {
      const counts = new Map();
      for (const bid of row.boardIds) {
        const b = boardById.get(bid);
        const wp = earliest((b?.cuts || []).map(c => c.workPackage));
        counts.set(wp, (counts.get(wp) || 0) + 1);
        boardsByWp[wp].push(bid);
      }
      const first = earliest([...counts.keys()]);
      for (const [wp, n] of counts) {
        const extra = wp === first ? (row.allowanceQty || 0) : 0;
        supplies[wp].push({ productKey: row.productKey, name: row.name, qty: n + extra, unit: row.unit,
          note: extra ? `includes ${extra} extra-allowance board(s)` : '' });
      }
      continue;
    }
    const reqs = (row.requirementIds || []).map(id => reqById.get(id)).filter(Boolean);
    const wps = [...new Set(reqs.map(r => r.workPackage || 'wp1'))];
    const first = earliest(wps.length ? wps : ['wp8']);
    let split = null;
    if (wps.length > 1 && row.baseQty != null && Number.isInteger(row.baseQty)) {
      const per = new Map();
      for (const r of reqs) per.set(r.workPackage, (per.get(r.workPackage) || 0) + (r.qty ?? NaN));
      const rounded = [...per.entries()].map(([wp, q]) => [wp, Math.ceil(q - 1e-9)]);
      if (rounded.every(([, q]) => Number.isFinite(q)) && rounded.reduce((a, [, q]) => a + q, 0) === row.baseQty) split = rounded;
    }
    if (split) {
      for (const [wp, q] of split) supplies[wp].push({ productKey: row.productKey, name: row.name,
        qty: q + (wp === first ? row.allowanceQty || 0 : 0), unit: row.unit, note: '' });
    } else {
      const also = wps.filter(w => w !== first);
      supplies[first].push({ productKey: row.productKey, name: row.name, qty: row.totalQty, unit: row.unit,
        note: [row.totalQty == null ? 'quantity unresolved' : '', also.length ? `also used in ${also.join(', ')}` : ''].filter(Boolean).join('; ') });
    }
  }

  const saved = job.buildPlan?.packages || {};
  return WP.map(w => {
    const steps = stepsFor(w.id, { types, rules, scope });
    const s = saved[w.id] || {};
    const inScope = w.id !== 'wp5' || scope.irrigation || scope.lighting || supplies[w.id].length > 0;
    const boards = boardsByWp[w.id];
    const cutInstructions = boards.map(id => {
      const b = boardById.get(id);
      return { boardId: id, text: `${id} (${b.stockLengthFt}'${b.specialOrder ? ', special order' : ''}): ` +
        b.cuts.map(c => `${inch(c.lengthIn)} ${c.label}`).join(' · ') +
        ` — offcut ${inch(b.offcutIn)}${b.usableOffcutIn ? ' (keep)' : ' (waste)'}` };
    });
    return {
      id: w.id, title: w.title, status: inScope ? 'planned' : 'not-in-scope',
      steps: inScope ? steps : [{ id: `${w.id}.s0`, text: 'Not in scope for this job (excluded on drawing/proposal).' }],
      supplies: inScope ? supplies[w.id] : [], boards: inScope ? boards : [], cutInstructions: inScope ? cutInstructions : [],
      tools: inScope ? TOOLS[w.id] : [], checks: inScope ? CHECKS[w.id] : [],
      day: s.day ?? '', crew: s.crew ?? '', notes: s.notes ?? '',
      checklist: Object.fromEntries(steps.map(st => [st.id, !!s.checklist?.[st.id]])),
    };
  });
}
