# Requirements: Voice invoicing

## Introduction
After a job, the owner says the invoice out loud. AfterBeep turns the words into line items, checks every price against the owner's own past invoices, computes tax and totals in code, and sends the invoice only after the owner approves the exact total. This spec covers parsing, the price book, the hold-and-decide flow, the confirm screen, sending and the customer invoice page.

## Glossary
- **Line item**: description, kind (part, labor, fee), quantity, unit, unit price, taxable flag.
- **Price book**: per item, the history of prices the owner has charged, built from past invoices.
- **Outlier**: a spoken price more than 40% away from the item's median past price.
- **Hold**: a line that blocks sending until the owner decides a price.
- **Approved total**: the grand total shown to the owner at the moment they press Approve.

## Requirement 1: Speech to line items
**User story:** As an owner, I want to say the invoice the way I talk, so that I can bill from the truck.

1.1 WHEN the owner dictates or types an invoice THE SYSTEM SHALL split it into line items at sentence and comma boundaries.
1.2 THE SYSTEM SHALL read spoken numbers, including price shorthand such as "three twenty-nine" and "sixty-two fifty", and quantities such as "two hours" and "an hour and a half".
1.3 WHEN a spoken price could be read more than one way THE SYSTEM SHALL keep every reading as an alternative.
1.4 WHEN the first phrase has no numbers and other lines follow THE SYSTEM SHALL use it as the invoice title.
1.5 THE SYSTEM SHALL classify each line as part, labor or fee and set its unit to each, hour or flat.
1.6 WHEN the owner says "taxed" or "no tax" for a line THE SYSTEM SHALL set that line's taxable flag; otherwise parts SHALL be taxable, fees SHALL NOT, and labor SHALL follow the business setting.
1.7 THE SYSTEM SHALL never let a language model perform arithmetic; all amounts SHALL be computed by code.

## Requirement 2: Money in integer cents
**User story:** As an owner, I want totals that are exactly right, so that I never send a bill that is off by a cent.

2.1 THE SYSTEM SHALL store every amount as an integer number of cents and every quantity in hundredths.
2.2 THE SYSTEM SHALL compute each line amount as quantity times unit price, rounded half away from zero to the cent.
2.3 THE SYSTEM SHALL apply the state base sales tax rate once to the sum of taxable lines, rounded half away from zero.
2.4 THE SYSTEM SHALL compute the grand total as subtotal plus tax.

## Requirement 3: Price book
**User story:** As an owner, I want my own past prices to catch slips of the tongue, so that I do not undercharge.

3.1 THE SYSTEM SHALL build the price book from the owner's sent and past invoices, matching items by normalised name and synonyms.
3.2 WHEN a line has no spoken price and the item is in the price book THE SYSTEM SHALL fill the usual price and say so.
3.3 WHEN a spoken price has an alternative reading that matches the price book THE SYSTEM SHALL use that reading and note the choice.
3.4 IF a spoken price is an outlier for the item THEN THE SYSTEM SHALL hold the line and offer "keep what I said" and "use usual price".
3.5 IF a line has no price and no history THEN THE SYSTEM SHALL hold the line until the owner types a price.
3.6 WHEN an item has no history THE SYSTEM SHALL mark it as new and SHALL NOT hold it for that reason alone.
3.7 THE SYSTEM SHALL compare prices only between compatible units (hourly with hourly, per-item with per-item).
3.8 WHEN an invoice is sent THE SYSTEM SHALL add its lines to the price book.

## Requirement 4: Confirm and send
**User story:** As an owner, I want to see and approve the exact total, so that nothing goes out that I did not agree to.

4.1 WHILE any line is held THE SYSTEM SHALL disable sending and show which lines need a decision.
4.2 THE SYSTEM SHALL let the owner edit description, quantity, price and taxable flag, and remove a line, recomputing totals each time.
4.3 THE SYSTEM SHALL prefill the customer from the job being invoiced.
4.4 WHEN the owner approves THE SYSTEM SHALL send the approved total with the lines, recompute the total on the server and send only if they are equal.
4.5 IF the recomputed total differs from the approved total THEN THE SYSTEM SHALL refuse with a total-mismatch error and send nothing.
4.6 IF any line is still held on the server THEN THE SYSTEM SHALL refuse with a needs-decision error.
4.7 IF the job has already been invoiced THEN THE SYSTEM SHALL refuse a second invoice.
4.8 WHEN an invoice is sent THE SYSTEM SHALL assign the next invoice number, mark the job invoiced, and record the provider reference.

## Requirement 5: Delivery
**User story:** As a customer, I want a clear invoice with a link to pay, so that I can settle it from my phone.

5.1 WHILE the local invoice provider is selected THE SYSTEM SHALL put a message with the invoice link in the outbox addressed to the customer's email or phone.
5.2 THE SYSTEM SHALL serve a customer invoice page showing business, number, date, job, lines, tax and amount due.
5.3 WHILE the Stripe provider is selected THE SYSTEM SHALL create a customer, invoice items and an invoice in test mode, finalize it and send it.
5.4 IF Stripe's invoice total differs from the approved total THEN THE SYSTEM SHALL void the Stripe invoice and report a provider error.
5.5 IF the Stripe key is not a test-mode key THEN THE SYSTEM SHALL refuse to start the Stripe provider.
