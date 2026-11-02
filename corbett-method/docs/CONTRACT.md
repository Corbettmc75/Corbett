# The Corbett Method — internal contract (shared by all modules)

This file is the single source of truth for data shapes and module boundaries.
Units: **feet** (decimal) for site geometry, **inches** for lumber pieces/kerf,
**cents (integer)** for money. `null` always means *unknown* — never zero.

## 1. Job document (stored as JSON, versioned)

```js
Job = {
  id, projectKey,            // projectKey isolates customers/projects; never shared
  name, customer, address,
  status: 'draft'|'estimating'|'approved'|'building'|'done',
  sources: [{ id, fileId|null, kind:'drawing'|'proposal'|'price-sheet'|'other',
              title, revision, date, pages, notes }],
  scope: { irrigation:false, lighting:false, liner:true, trim:true },   // explicit include/exclude
  settings: { /* overrides of DEFAULT_RULES, dotted keys allowed e.g. 'lumber.kerfIn' */ },
  scenarios: [{ id, name, selected:bool, note, overrides:{ settings:{}, components:{ [id]: {patch} } } }],
  components: [Component],
  allowances: [Allowance],   // confirmed proposal quantities (soil, compost, plants…)
  answers: { [questionId]: { value, note, by, at } },   // resolved questions; survive reanalysis
  corrections: [{ id, componentId, path, value, by, at, note, locked:true }], // manual, survive reanalysis
  extractions: [{ id, fileId, at, model, status, summary }],  // raw AI output stored server-side only
  buildPlan: { packages: { [wpId]: { day:'', crew:'', notes:'', checklist:{ [stepId]: bool } } } },
  actuals: { purchases:[{ id, productKey, qty, totalCents, supplier, date, note }],
             leftovers:[{ id, productKey, lengthIn|null, qty, note }],
             costs:[{ id, category, totalCents, date, note }] },
  costInputs: { taxRatePct:null, deliveryCents:null, disposalCents:null,
                laborHours:null, laborRateCents:null, contingencyPct:null,
                serviceCharges:[{ label, cents, source }] },
  selling: { source, totalCents, lines:[{ activity, description, cents }] } // customer price — never material cost
}

Component = {
  id, type, name, scenarioId:null|'id', excluded:false,
  geometry: { kind:'rect', lengthFt, widthFt }
          | { kind:'polygon', points:[[x,y],...] }      // outside face, feet, any orientation
          | { kind:'line', lengthFt }
          | { kind:'area', areaSqFt }
          | null,                                       // null → missing dimension question
  props: { ... type specific (see §3) },
  provenance: { [fieldPath]: { basis:'drawing'|'calculation'|'default'|'proposal'|'manual',
                               ref:'text', confirmed:bool } },
  notes:''
}
Allowance = { id, productKey, qty, unit, componentId|null, source:{ kind:'proposal', ref }, confirmed:true, note }
```

Component `type` ∈ `bed, trellis, path, patio, stoop, screen, fence, planting, mulch, rock,
demolition, edging, drain, irrigation, lighting`.

## 2. Engine output

```js
Estimate = {
  jobId, version, scenarioId, generatedAt, rulesHash,
  metrics:   { [componentId]: { outsideAreaSqFt, insideAreaSqFt, perimeterFt, insidePerimeterFt, ... } },
  requirements: [Requirement],
  pieces:       [Piece],
  cutPlans:     { [groupKey]: { reviewed: CutPlan, nominal: CutPlan } },
  shopping:     [ShoppingRow],
  unresolved:   [Question],          // open questions only, concise
  reconciliations: [{ id, label, confirmedQty, calculatedQty, unit, basis, note }],
  costs:        CostSummary,
  guides:       [WorkPackage],
  audit:        [{ productKey, rowQty, from:[{ requirementId|pieceId|boardId, componentId, basis, ref, formula }] }]
}

Requirement = {
  id, productKey, qty, unit,           // unit ∈ ea|bag|cy|cf|sqft|lf|roll|board|box
  componentId, label, role,
  basis: 'drawing'|'calculation'|'default'|'proposal'|'manual',
  formula: 'human readable',  refs:['rule:concrete.bagsPer6x6', 'drawing:…'],
  status: 'ok'|'provisional'|'unresolved',
  questionIds: [],
  workPackage: 'wp1'..'wp8',
  allowanceEligible: bool              // false for fixtures, trellis posts, headers, proposal allowances
}

Piece = {                               // one finished lumber piece
  id, groupKey,                         // e.g. 'lumber:cedartone:2x6' (compatibility pool)
  lengthIn,                             // reviewed finished length incl. angle-cut envelope
  nominalLengthIn,                      // nominal (outside-dimension) length for nominal procurement
  label, componentId, role,             // e.g. 'Upper L – course 3 – wall A'
  allowedStockFt: null | [8],           // per-piece restriction (PT bed posts → [8]; trellis posts → [12])
  mustBeContinuous: true,               // never spliced
  allowanceEligible: bool,
  workPackage, status:'ok'|'provisional', questionIds:[]
}

CutPlan = {
  groupKey, mode:'reviewed'|'nominal', kerfIn, endTrimIn,
  boards: [{ id:'B-2x6-01', productKey, stockLengthFt, specialOrder, reason?,
             cuts:[{ pieceId, label, componentId, lengthIn }],
             sawLossIn, offcutIn, usableOffcutIn, wasteIn, notes:[] }],
  infeasible: [{ pieceId, label, reason }],     // e.g. longer than any permitted stock
  conflicts:  [{ text, pieceIds, suggestion }], // e.g. exact-fit 48"+48" on 96" with kerf
  proof: 'optimal'|'best-found', objective:'waste'|'cost', stats:{ purchasedIn, requiredIn, nodes }
}

ShoppingRow = {
  productKey, name, category,
  baseQty, allowanceQty, totalQty, unit,     // unit is the purchase unit (board, bag, cy, roll…)
  packageSize, packageUnit,
  unitPriceCents|null, extendedCents|null,
  supplier|null, priceDate|null, priceSource|null, priceType:'material',
  status: 'ok'|'provisional'|'unresolved'|'missing_price',
  issues: [questionId], requirementIds:[], boardIds:[]
}

Question = { id /* stable, e.g. 'q.corner-rule' or 'q.price:lumber:pt:4x4:8' */,
  type:'missing_dimension'|'construction_detail'|'product_spec'|'missing_price'|'scope_conflict',
  text /* one concise question */, componentIds:[], productKeys:[], provisional /* what we assumed meanwhile */,
  status:'open'|'answered' }

CostSummary = { materialsCents|null, materialsKnownCents, missingPriceCount,
  taxCents|null, deliveryCents|null, disposalCents|null, laborCents|null,
  serviceChargesCents|null, contingencyCents|null, internalTotalCents|null,
  sellingPriceCents|null, notes:[] }

WorkPackage = { id:'wp1', title, steps:[{ id, text }], supplies:[{ productKey, name, qty, unit, note }],
  boards:[boardId], tools:[], checks:[], day, crew, notes, checklist }
```

## 3. Component props (type specific)

* **bed**: `{ courses:5, heightIn:27.5, material:'cedartone'|'smooth-cedar'|'rough-cedar'|..., liner:true, trim:true }`
  geometry = outside face polygon/rect.
* **trellis**: `{ bedId, edge:[[x1,y1],[x2,y2]] | null, lengthFt, posts, headerCount:2, headerLengthFt,
  material, mesh:{ spec, panelProductKey|null }, slatLengthIn|null, slatSpacingIn:12, bracesPerPost|null }`
* **path**: `{ layers:'standard' }` geometry area/rect/polygon.
* **patio / stoop**: `{ product, color, border:{ product, rows, sides }, coping:{ product, color }, base:null }`
* **screen / fence**: `{ heightFt, material }` geometry line.
* **planting**: `{ plants:[{ name, qty }] }`; **mulch**: `{ product, depthIn|null }`;
* **rock**: `{ product, depthIn|null, relocatedCreditCf|null }`;
* **demolition**: `{ items:[text], thicknessIn|null, material|null }`;
* **edging**: `{ runs:[{ lengthFt|null, ref }] }`; **drain**: `{ diameterIn:4, lengthFt|null, fittings:[] }`

## 4. Module boundaries (ES modules, Node 22, no runtime deps)

| Module | Exports |
|---|---|
| `engine/rules.js` | `DEFAULT_RULES`, `resolveRules(job, scenarioId)`, `lumberGroups` |
| `engine/products.js` | `PRODUCTS` (definitions), `productName(key)`, `lumberProductKey(groupKey, ft)` |
| `engine/geometry.js` | `toPolygon(geom)`, `area`, `perimeter`, `edges`, `insetPolygon(poly, t)`, `corners(poly)` (convex/reflex), `opposingPairs(poly)` |
| `engine/components/*.js` | `takeoff(component, ctx) → { requirements, pieces, questions, metrics }` |
| `engine/takeoff.js` | `buildTakeoff(job, rules) → { requirements, pieces, questions, metrics, reconciliations }` |
| `engine/cutopt.js` | `optimizeGroup({ groupKey, pieces, stock, kerfIn, endTrimIn, minUsableOffcutIn, objective, mode })` |
| `engine/consolidate.js` | `consolidate({ requirements, cutPlans, rules }) → ShoppingRow[]` (unpriced) |
| `engine/pricing.js` | `priceRows(rows, catalog, opts)`, `matchPrice(productKey, catalog)` (material prices only) |
| `engine/costs.js` | `computeCosts(rows, job, rules)` |
| `engine/guides.js` | `buildGuides(estimate, job)` |
| `engine/estimate.js` | `estimateJob(job, { catalog, standards }) → Estimate` (orchestrator) |
| `engine/exports.js` | `shoppingCsv(est)`, `cutListCsv(est)`, `jobPackHtml(est, job)` |

`ctx` passed to component takeoffs = `{ job, rules, components, componentsById, scope }`.

## 5. Product keys

`category:line:spec[:length]`, e.g.
`lumber:cedartone:2x6:16`, `lumber:pt:4x4:8`, `concrete:fast-set:50lb`, `soil:basic-organic`,
`soil:premium-organic`, `compost:cow:1cf`, `liner:6mil-black:20x100`, `edging:snap-edge:8ft`,
`edging:spike:10in`, `screw:deck:3in`, `staple:liner`, `screw:trim`, `plant:karl-foerster`, …
Lumber pool `groupKey` = key without length (`lumber:cedartone:2x6`). Different species,
treatment, cross-section, grade or finish ⇒ different groupKey ⇒ never pooled.

## 6. HTTP API (JSON, cookie session, CSRF header `X-CSRF` on mutations)

```
POST /api/login {username,password} · POST /api/logout · GET /api/me
GET  /api/jobs · POST /api/jobs {name,customer,projectKey?}
GET  /api/jobs/:id → {job, version, updatedAt, updatedBy}
PUT  /api/jobs/:id {job}  header If-Match: <version>  → 200 {version} | 409 {version, updatedBy, updatedAt}
GET  /api/jobs/:id/revisions · GET /api/jobs/:id/revisions/:v
POST /api/jobs/:id/files  (raw body; headers Content-Type, X-Filename) → {fileId, pages, kind}
GET  /api/files/:id · GET /api/files/:id/pages/:n.png
POST /api/jobs/:id/analyze {fileId} → {extractionId}
GET  /api/extractions/:id → {status:'queued'|'running'|'done'|'error', stage, progress, error, proposal}
POST /api/jobs/:id/extractions/:eid/apply {accept:[itemId], edits:{}} → {version}
GET  /api/jobs/:id/estimate?scenario=ID → Estimate
GET  /api/jobs/:id/export/shopping.csv | cutlist.csv | jobpack.html
GET  /api/catalog · POST /api/catalog (upsert entry) · DELETE /api/catalog/:id · POST /api/catalog/import (CSV text)
GET  /api/standards · PUT /api/standards {settings} (admin)
GET  /api/jobs/:id/audit
```
Roles: `admin` (Corbett), `editor` (Courtney), `viewer`. Users are created with
`npm run user:add` on the server — no invitations are ever sent.

## 7. Catalog entry

```js
{ id, productKey, supplier, store, sku|null, spec, packageSize, packageUnit,
  unitPriceCents, unitBasis, priceDate, source:{ file, page|null, url|null },
  priceType:'material'|'service'|'selling', notes }
```
Only `priceType:'material'` may price a ShoppingRow. A price matches only an identical productKey.
