# The Corbett Method

Phone-first estimating for raised-bed gardens and landscapes:
**new job → upload drawing → analyze → review → answer real questions → shopping list, cutting guide, costs and daily build guides.**

This is a separate app from the "talk to Corbett" voice page in the parent folder; nothing there was changed.

## Run it

Requires Node 22.5+ (uses the built-in `node:sqlite`; no npm install needed) and, for PDF page images, poppler (`pdftoppm`, `pdfinfo`, `pdftotext`).

```bash
cd corbett-method
cp .env.example .env            # optional; or export the variables
npm run seed                    # loads the price catalog + the Theresa & Anders example job
npm run user:add -- --username corbett  --name Corbett  --role admin    # prompts for a password
npm run user:add -- --username courtney --name Courtney --role editor
npm start                       # http://127.0.0.1:8787
npm test                        # 79 automated tests
```

On a phone: open the site and use Share → Add to Home Screen (iOS), or Install (Android).
To reach it from a phone, run it behind HTTPS (e.g. a reverse proxy) with `HOST=0.0.0.0` and `COOKIE_SECURE=1`.

### Configuration (environment only — never in code or Git)

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Listen address (default 127.0.0.1:8787) |
| `DATA_DIR` | Database + uploaded drawings (default `./var`, git-ignored) |
| `COOKIE_SECURE=1` | Required when served over HTTPS |
| `ANTHROPIC_API_KEY` | Enables AI drawing analysis (server-side only). Without it, PDFs fall back to text-layer dimension labels for manual mapping |
| `ANTHROPIC_MODEL` | Optional model override |
| `PRICE_LOOKUP_HOSTS` | Optional, e.g. `www.menards.com`. Off when blank. Lookups only *propose* a dated price; a person confirms it |

Users are created only with `npm run user:add` on the server. The app never sends invitations or emails, never contacts suppliers by itself, and never places orders.

## Layout

```
engine/      pure estimating engine (no I/O): rules, geometry, takeoff, cut optimizer, consolidation, pricing, costs, guides, exports
server/      HTTP API, SQLite storage, auth/roles, revisions, uploads, drawing-analysis pipeline, price lookup
public/      phone UI (installable web app; no build step, no external scripts)
data/        seed price catalog (Menards 2026-02-19 sheet values) + Theresa & Anders acceptance job
docs/        CONTRACT (data model + API), ARCHITECTURE/COMPARISON, QUESTIONS (open items)
test/        node:test suites incl. acceptance tests for Theresa & Anders
```

Construction standards live in [`engine/rules.js`](engine/rules.js). Each value is marked *confirmed*, *recorded* or *default*; defaults raise a question until answered. Shop-wide standards can be overridden by an admin (More → Settings), per job, or per scenario.
