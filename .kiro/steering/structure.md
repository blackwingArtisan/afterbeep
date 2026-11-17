---
inclusion: always
---
# Project structure

```
.kiro/                 steering, specs and hooks (this folder)
src/
  domain/              pure business logic, fully unit tested
    money.ts           cents, formatting, rounding
    spoken-numbers.ts  "three twenty-nine" -> 329, "sixty-two fifty" -> 62.50
    invoice-parser.ts  spoken invoice -> draft line items
    price-book.ts      price history and outlier checks
    tax.ts             state base rates, invoice totals
    voicemail-rules.ts rule-based extraction of name, number, address, job, urgency
    slots.ts           open appointment slots from hours and booked jobs
    types.ts           shared domain types
  adapters/
    transcriber/  extractor/  sms/  invoices/  store/
      types.ts         the port interface
      local.ts         free default implementation
      aws.ts|stripe.ts real implementation (not executed in tests)
    index.ts           selects implementations from env
  server/
    app.ts             Hono app factory (dependencies injected)
    services/          voicemail pipeline, booking, invoicing
    seed.ts            the demo business, past invoices and sample voicemails
    main.ts            Node entry point
  client/
    pages/             one file per route
    components/        cassette, message light, tape deck, etc.
    styles/            tokens.css and global styles
infra/connect/         Amazon Connect contact flow and wiring notes for the real phone path
tests/
  unit/                Vitest
  e2e/                 Playwright
```

## Conventions
- File names are kebab-case. React components are PascalCase.
- A route handler validates input with zod, calls one service function, and returns JSON. No business logic in handlers.
- Services take their dependencies (store, adapters, clock, id generator) as arguments.
- Tests live beside the layer they test, under `tests/unit/<layer>-*.test.ts`.
