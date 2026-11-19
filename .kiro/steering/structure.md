---
inclusion: always
---
# Project structure

```
.kiro/                 steering, specs, hooks and MCP settings (this folder)
.github/workflows/      CI: typecheck, spec coverage, unit and end-to-end tests
scripts/               spec-coverage.ts: every EARS criterion must be named by a test; eval-extractor.ts and
                       transcribe-sample.ts score and spot-check extraction (paid paths are switched off by default)
src/
  domain/              pure business logic, fully unit tested
    money.ts           cents, formatting, rounding
    spoken-numbers.ts  "three twenty-nine" -> 329, "sixty-two fifty" -> 62.50
    invoice-parser.ts  spoken invoice -> draft line items
    price-book.ts      price history and outlier checks
    tax.ts             state base rates, invoice totals
    voicemail-rules.ts rule-based extraction of name, number, address, job, urgency
    slots.ts           open appointment slots from hours and booked jobs
    kept.ts            "Kept this week": calls, texts, bookings and amounts caught
    graveyard.ts       which unreturned hang-ups can be raised from the dead
    spanish.ts         detects Spanish voicemails and maps trade phrases to English for the rules
    payback.ts         the landing page payback estimate
    types.ts           shared domain types
  adapters/
    transcriber/  extractor/  sms/  invoices/  store/
      types.ts         the port interface
      local.ts         free default implementation
      aws.ts|stripe.ts real implementation (not executed in tests)
    index.ts           selects implementations from env
  server/
    app.ts             Hono app factory (dependencies injected)
    services/          voicemail pipeline, booking, invoicing, revive (raise the dead)
    seed.ts            the demo business, past invoices and sample voicemails
    main.ts            Node entry point
  client/
    pages/             one file per route
    components/        cassette, message light, tape deck, etc.
    styles/            tokens.css and global styles
infra/template.yaml    SAM template for the real phone path (validated in CI)
infra/connect/         Amazon Connect contact flow, hand-off Lambda and wiring notes
tests/
  unit/                Vitest
  e2e/                 Playwright
  aws/                 live AWS checks, skipped unless AFTERBEEP_AWS_TEST=1
```

## Conventions
- File names are kebab-case. React components are PascalCase.
- A route handler validates input with zod, calls one service function, and returns JSON. No business logic in handlers.
- Services take their dependencies (store, adapters, clock, id generator) as arguments.
- Tests live beside the layer they test, under `tests/unit/<layer>-*.test.ts`.
