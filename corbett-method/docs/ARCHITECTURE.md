# Architecture, choices and honest limits

## Pipeline

```
drawing (PDF/PNG/JPEG) ──► server/extract ──► proposal (components, dimension labels, notes, questions)
                                              │  human review screen: accept / edit / reject
                                              ▼
job document (versioned) ── components + provenance, allowances, answers, locked corrections, scenarios
                                              │
                         engine/estimateJob (pure function of job + catalog + standards)
   takeoff ─► lumber pieces + requirements ─► cut optimizer per compatible pool ─► consolidated rows
          ─► pricing (material-only, exact product match) ─► costs ─► daily work packages ─► exports
```

* **The engine is a pure function.** Nothing is stored between jobs and nothing is shared, so one project's numbers can't leak into another (a test covers this). The same job always produces the same estimate, and every shopping row carries an audit trail back to its requirements, boards, pieces, rules and drawing labels.
* **Storage** is SQLite. Jobs keep every saved revision, and saves are compare-and-set on a version number. A stale phone gets a 409 that says who saved and when; it is never silently overwritten.
* **Re-analysis** replaces only components that came from an earlier analysis. Answers, locked manual corrections, allowances, the price catalog and shop standards are never touched by uploads.
* **Drawings are data.** The analysis prompt treats drawing text as untrusted, the model output is schema-validated and clamped, and the UI and exports escape everything they display.

## Cut optimization

* Pieces are pooled only within one product line (species/treatment, cross-section and grade). CedarTone 2×6 and rough-sawn cedar 2×6 are never mixed.
* **Fit rule.** On a board of length L, the pieces' total length plus one kerf for every cut plus any end trim must be ≤ L. A piece that exactly uses up the board needs no final cut. That is why 96″+96″ can't be cut from a 16′ board, two 48″ PT posts can't be cut from an 8′ board, and one 144″ header can be cut from a 12′ board.
* **Search.** An exact branch-and-bound search, seeded with greedy packings and pruned by a lower bound, runs with a node budget so the result is repeatable. A plan is labelled **"Proven minimum"** only when the search finishes or reaches the lower bound; otherwise it shows **"Best plan found."** For Theresa & Anders, every lumber pool is proven except CedarTone 2×6, which is "best plan found."
* **Stock rules** are enforced per piece:
  * PT 4×4 bed posts come from 8′ stock only.
  * Trellis posts come from 12′ stock.
  * 1×4 trim comes from 16′ stock.
  * Special-order 20′ boards are opened only for pieces longer than any in-stock board. Their offcuts are reused, and they get no extra allowance.
  * Pieces are never spliced. The one exception is trim, which uses butt joints by design.
* **Allowance.** The 15% extra is added once per consolidated product row, counting only eligible boards, and is shown separately. Trellis posts, headers, braces and special-order boards are never inflated. Provisional boards (for example, braces whose count isn't confirmed yet) are listed in their own row.
* **Nominal vs reviewed.** The *nominal* view (outside dimensions, no kerf) is for comparing orders; the *reviewed* view is what gets cut and bought. Example: a 5×8 bed with five courses comes to 5×16′ + 5×10′ nominal and 4×16′ + 5×10′ + 2×8′ reviewed. Both are 130 ft, and the reviewed plan is proven and physically fits.
* **Cost objective.** It is available only when every candidate stock length has a price. If minimizing waste and minimizing cost give different orders, both are shown with the tradeoff.

## Prices

* Catalog entries record supplier, store, product key and specification, package, unit basis, date, source (file, page or URL) and `priceType`.
* Only `material` prices with an *identical* product key price a row. Service and selling rates (the Greenworks/HGG soil rates, proposal line items) are stored and labelled but never treated as material cost.
* A missing price is `null`, shown as "unknown", and the total is reported as incomplete.
* The optional price lookup reads only the price that a product page publishes in its machine-readable data. It returns a dated candidate that a person must confirm, and it reports blocks or failures instead of guessing.

## Comparison with the existing calculator

I could not inspect the existing calculator's source or signed-in data, so I can't make a feature-by-feature comparison. What this implementation does differently, by design:

* **Strengths:**
  * Purchasable products, not finished pieces or total footage.
  * Kerf-correct, provable cutting plans with board IDs.
  * Full provenance for every quantity.
  * Confirmed proposal quantities are kept, with the geometry check shown alongside for reconciliation.
  * Specific, typed questions instead of "needs measurements."
  * Shared jobs with conflict protection and revision history.
  * No API keys in the browser.
* **Limitations:**
  * AI analysis has not been exercised against the live API in this environment (no key available). The no-key text-layer fallback was verified on the Theresa & Anders PDF.
  * Image-only drawings need the key.
  * Hardscape (patio, stoops, border), screens and fence, mulch, rock, drain and edging produce questions rather than quantities until their dimensions or construction details are supplied.
  * Bed support layouts for runs over 10 ft and the L beds are provisional.
  * The CedarTone 2×6 pool on large jobs may be "best plan found" rather than proven optimal.
  * Most non-lumber prices are missing until a price sheet is imported.
  * Not yet verified: live supplier lookups (Menards was unreachable from this environment), phone install on a real device (only emulated in Playwright), and multi-user use over a real network.
