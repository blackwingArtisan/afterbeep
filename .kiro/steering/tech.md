---
inclusion: always
---
# Tech stack and engineering rules

## Stack
- TypeScript everywhere, `strict` on. Node 24+.
- Client: React 19 single-page app built with Vite. React Router for pages. Plain CSS with design tokens (CSS custom properties); no UI framework.
- Server: Hono on Node (`@hono/node-server`). JSON API under `/api`. The same process serves the built client.
- Validation: zod at every trust boundary (HTTP bodies, model output, adapter responses).
- Tests: Vitest for unit and API tests (Hono `app.request`), Playwright for end-to-end tests against the production build.
- Deploy target (free): a single Render free-tier web service (`npm run build && npm start`). Not deployed from this repo.

## Adapters
Each external service is an interface in `src/adapters/<name>/types.ts` with two implementations:
- `local`: deterministic, free, used by default and by every test.
- `aws` / `stripe`: the real path, written and type-checked, selected only by env var, never called in tests.

| Port | Local (default) | Real | Env var |
|---|---|---|---|
| Transcriber | passes through the browser transcript (Web Speech API) or sample text | Amazon Transcribe | `AFTERBEEP_TRANSCRIBER=local\|aws` |
| Extractor | rule-based parser | Amazon Bedrock (Converse API, tool-shaped JSON) | `AFTERBEEP_EXTRACTOR=rules\|bedrock` |
| SMS | outbox file | Amazon End User Messaging SMS | `AFTERBEEP_SMS=outbox\|aws` |
| Invoices | outbox + hosted invoice page | Stripe Invoicing (test mode) | `AFTERBEEP_INVOICES=local\|stripe` |
| Store | JSON file (or memory in tests) | same interface, swap for DynamoDB later | `AFTERBEEP_DATA_DIR` |

Real adapters are loaded with dynamic `import()` so the default path never loads an AWS or Stripe SDK.

## Money
- Integer cents only. Never store or sum floats.
- Line amount = round(quantity x unit price) with half-up rounding to the cent; tax = round(taxable subtotal x rate) once per invoice.
- Tax rate = the business's state base rate unless the owner sets an override.

## Code rules
- Domain logic in `src/domain` is pure: no I/O, no Date.now() (pass `now`), no randomness (pass ids).
- Small modules, named exports, no default exports except React pages.
- No secrets in the repo. Sample data uses invented names, 555-01xx phone numbers and example.com emails.
- Every commit passes `npm run check` (typecheck + unit tests) and `npm run test:e2e` from a clean checkout.

## Ports
Local dev and tests use ports 3110-3119: Vite dev 3110, API dev 3111, e2e production server 3112.
