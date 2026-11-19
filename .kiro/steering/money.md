---
inclusion: fileMatch
fileMatchPattern: "src/domain/**"
---
# Money rules

These rules apply to every file in the domain layer. Invoices go to real customers, so a wrong cent is a real bug.

## Amounts
- Every amount is an integer number of cents (`Cents`). Quantities are stored with at most two decimals and multiplied as hundredths (`quantityToHundredths`). No floating-point sums.
- A line amount is quantity times unit price, rounded half away from zero to the cent (`lineAmountCents`).
- Tax is the state base rate applied once to the sum of taxable lines, rounded half away from zero (`computeTotals`). Never tax line by line.
- The total is subtotal plus tax. Nothing else adds to it.

## Who does arithmetic
- Code does all arithmetic. A language model may read words; it never computes, rounds or totals.
- The server recomputes every total from the lines and sends only when it equals the exact total the owner approved. Client-supplied totals are ignored.

## Holds
An invoice with a held line cannot be sent. A line is held when:
- the spoken price is more than 15% below or 25% above the usual price for that item and unit (`BELOW_USUAL_TOLERANCE`, `ABOVE_USUAL_TOLERANCE`);
- it has no price and no history;
- a price has more than one reading and no history settles it;
- it holds a number that is neither its quantity nor its price;
- the quantity is above the item's limit (`quantityLimit`): for labor, the larger of 12 hours and twice the most ever billed; for items with history, the larger of 3 and twice the most ever billed; for new items, 10.

Prices compare only between compatible units (hourly with hourly, each with each).

## Tests
Any change to a rule above needs a unit test in `tests/unit/domain-invoice.test.ts` whose title names the requirement, for example `[VI 3.4]`.
