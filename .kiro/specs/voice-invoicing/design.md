# Design: Voice invoicing

## Overview
The browser turns speech into text (Web Speech API). Everything after that is deterministic code: a parser reads the words into line items, the price book checks them, and the money module computes totals. The server repeats the same computation before sending, so the client cannot change what is charged.

```
Mic -> Web Speech API -> text -> POST /api/invoices/draft
                                  parseInvoiceSpeech -> quoteLines(priceBook, taxRate) -> lines + checks + totals
Owner edits / decides holds -> POST /api/invoices/quote (recompute after every change)
Owner approves $T -> POST /api/invoices/send { lines, customer, approvedTotalCents: T }
                     server: quoteLines again -> blocked? 422 : total != T ? 409 : InvoiceProvider.send
                     -> outbox message or Stripe invoice -> /i/:id customer page
```

## Components
| Component | File | Responsibility |
|---|---|---|
| Money | `src/domain/money.ts` | Cents, hundredths, rounding, formatting |
| Spoken numbers | `src/domain/spoken-numbers.ts` | Number words to counts and candidate prices |
| Tax | `src/domain/tax.ts` | State base rates in thousandths of a percent; totals |
| Parser | `src/domain/invoice-parser.ts` | Segments, quantity, unit, kind, taxable, title |
| Price book | `src/domain/price-book.ts` | History per item, matching, outlier checks |
| Draft | `src/domain/invoice-draft.ts` | Fill, settle alternatives, check, total |
| Service | `src/server/services/invoicing.ts` | Draft, quote, send gate, public view |
| Providers | `src/adapters/invoices/*` | Local outbox provider, Stripe Invoicing |
| UI | `src/client/pages/VoiceInvoice.tsx`, `CustomerInvoice.tsx`, `PriceBook.tsx` | Dictation, paper invoice, holds, approve |

## Data models
```ts
interface InvoiceLine {
  id: string;
  description: string;
  kind: 'part' | 'labor' | 'fee';
  quantity: number;               // two decimals at most; stored as hundredths in math
  unit: 'each' | 'hour' | 'flat';
  unitPriceCents: number;
  taxable: boolean;
  priceSource: 'spoken' | 'price-book' | 'owner';
  heard: string;                  // the words this line came from
  alternativesCents: number[];    // other readings of the spoken price
  confirmedPriceCents: number | null; // owner decided this price; releases a hold
  note: string | null;
}

interface PriceCheck {
  lineId: string;
  status: 'ok' | 'filled' | 'new-item' | 'outlier' | 'confirmed' | 'missing-price';
  blocking: boolean;
  usualCents: number | null;
  historyCount: number;
  message: string;
  options: Array<{ label: string; cents: number }>;
}

interface InvoiceTotals { subtotalCents: number; taxableCents: number; taxRateMilli: number; taxCents: number; totalCents: number }
```

## Money rules
- `lineAmountCents = roundDiv(quantityHundredths * unitPriceCents, 100)`.
- `taxCents = roundDiv(taxableCents * taxRateMilli, 100000)`; 5.75% is stored as `5750`.
- `roundDiv` rounds half away from zero using integer arithmetic only.

## Price book rules
- Item key: lower case, stop words removed, singular, synonyms (labour to labor, fee to charge, service call to trip charge).
- Match: exact key, else Jaccard similarity of words at least 0.5; labor lines match the labor entry.
- Outlier: `|spoken - median| / median > 0.4` with compatible units. Ambiguous spoken prices pick the reading closest to the median when it is not an outlier.

## Send gate
| Check | Result |
|---|---|
| Body fails schema | 400 `invalid-request` |
| Any blocking check after server recompute | 422 `needs-decision` with checks |
| `approvedTotalCents !== totals.totalCents` | 409 `total-mismatch` with server total |
| Job already invoiced | 409 `already-invoiced` |
| Provider throws | 503 `provider-failed`, nothing stored |
| Otherwise | 201 with invoice; number `HC-<n>`; price book grows |

## Providers
| Provider | Env | Behaviour |
|---|---|---|
| `LocalInvoiceProvider` | `AFTERBEEP_INVOICES=local` (default) | Outbox message with `/i/:id` link |
| `StripeInvoiceProvider` | `AFTERBEEP_INVOICES=stripe`, `STRIPE_SECRET_KEY=sk_test_...` | Customer, invoice items in cents, tax as its own item, finalize, compare the finalized total, send or void |

## Testing strategy
- Unit: spoken numbers (22 cases), rounding, tax for every rate path, parser on the sample scripts and edge cases, price book matching, outliers and alternatives.
- API: the hold returns 422, a tampered total returns 409, the approved total sends HC-1016 at $182.88, the price book grows after sending.
- End to end: say the slip script, see the hold, pick the usual price, approve $182.88, open the customer page, see it in the outbox and price book.
