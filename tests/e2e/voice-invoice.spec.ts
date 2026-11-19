import { expect, test } from './fixtures';

test('[VI 3.4, 3.8, 3.12, 4.1, 4.3, 5.2] a spoken invoice is held on a wrong price and sent only at the approved total', async ({ page }) => {
  await page.goto('/machine/invoice');
  await expect(page.getByLabel('Job')).toContainText('Wendell Ashgrove');

  await page.getByRole('button', { name: /Belt at the wrong price/ }).click();
  await expect(page.getByLabel('What you said')).toHaveValue(/Dryer belt fifteen/);
  await page.getByRole('button', { name: 'Line it up' }).click();

  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await expect(draft).toContainText('You said $15.00, but you usually charge $50.00 (4 past invoices).');
  // The owner's own four carbon copies fan out under the held line, with the heard price scrawled on top.
  const fan = draft.getByTestId('carbon-fan');
  await expect(fan.locator('.carbon-fan-slip')).toHaveCount(4);
  await expect(fan.locator('.carbon-fan-amt')).toHaveText(['$50.00', '$52.00', '$50.00', '$49.50']);
  await expect(fan.locator('.carbon-fan-scrawl')).toHaveText('$15?');
  await expect(page.getByRole('button', { name: /Settle the held lines/ })).toBeDisabled();

  await draft.getByRole('button', { name: 'Use usual $50.00' }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');
  await expect(draft.getByTestId('carbon-fan')).toHaveCount(0);
  await expect(draft.getByTestId('total')).toHaveText('$182.88');
  await expect(page.getByLabel('Customer name')).toHaveValue('Wendell Ashgrove');

  await page.getByRole('button', { name: 'Approve and send $182.88' }).click();
  const sent = page.getByTestId('invoice-sent');
  await expect(sent).toContainText('Invoice HC-1016 is out: $182.88');

  await page.getByRole('link', { name: /See what Wendell sees/ }).click();
  const invoice = page.getByTestId('customer-invoice');
  await expect(invoice).toContainText('Hollow Creek Plumbing & Appliance');
  await expect(invoice.getByTestId('amount-due')).toHaveText('$182.88');
  await expect(invoice).toContainText('Dryer belt');

  await page.goto('/machine/outbox');
  await expect(page.getByTestId('outbox-item').first()).toContainText('invoice HC-1016');

  await page.goto('/machine/prices');
  await expect(page.getByRole('row', { name: /Dryer belt/ })).toContainText('5');
});

test('[VI 1.8, 3.10] two items joined by "and" become two lines, and a misheard quantity is held', async ({ page }) => {
  await page.goto('/machine/invoice');
  const speech = page.getByLabel('What you said');
  const draft = page.getByTestId('draft');

  await speech.fill('water heater element ninety nine dollars and a thermostat for forty, one hour labor at eighty five');
  await page.getByRole('button', { name: 'Line it up' }).click();
  await expect(draft.getByTestId('line')).toHaveCount(3);
  await expect(draft.getByTestId('line').nth(1)).toContainText('Thermostat');
  await expect(draft.getByTestId('line').nth(1)).toContainText('1 ea x $40.00');
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');

  await speech.fill('forty water heater elements at eighty nine');
  await page.getByRole('button', { name: 'Line it up' }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await expect(draft).toContainText('That is a quantity of 40 at $89.00. Your most on one invoice is 2.');
  await expect(page.getByRole('button', { name: /Settle the held lines/ })).toBeDisabled();
  await draft.getByRole('button', { name: 'Make it 1' }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');
  await expect(draft.getByTestId('line').first()).toContainText('1 ea x $89.00');
});

test('[VI 3.11] an ambiguous price with no history waits for the owner to pick a reading', async ({ page }) => {
  await page.goto('/machine/invoice');
  await page.getByLabel('What you said').fill('dryer repair, part three twenty-nine taxed, two hours labor at eighty-five');
  await page.getByRole('button', { name: 'Line it up' }).click();
  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await expect(draft).toContainText('That could be $329.00 or $3.29');
  await draft.getByRole('button', { name: "It's $3.29" }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');
  await expect(draft.getByTestId('line').first()).toContainText('$3.29');
});

test('[VI 3.4] a labor rate well below the usual rate is held until the owner keeps it', async ({ page }) => {
  await page.goto('/machine/invoice');
  await page.getByLabel('What you said').fill('two hours labor at sixty');
  await page.getByRole('button', { name: 'Line it up' }).click();
  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  // Earlier tests send invoices that join the history, so the count is not fixed here.
  await expect(draft).toContainText(/You said \$60\.00\/hr, but you usually charge \$85\.00\/hr \(\d+ past invoices\)\./);
  await expect(draft).not.toContainText('Matches your usual');
  await draft.getByRole('button', { name: 'Keep $60.00/hr' }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');
  await expect(draft).toContainText('You confirmed $60.00/hr (usually $85.00/hr).');
});
