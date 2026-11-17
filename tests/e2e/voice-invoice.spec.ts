import { expect, test } from '@playwright/test';

test('a spoken invoice is held on a wrong price and sent only at the approved total', async ({ page }) => {
  await page.goto('/machine/invoice');
  await expect(page.getByLabel('Job')).toContainText('Wendell Ashgrove');

  await page.getByRole('button', { name: /Belt at the wrong price/ }).click();
  await expect(page.getByLabel('What you said')).toHaveValue(/Dryer belt fifteen/);
  await page.getByRole('button', { name: 'Line it up' }).click();

  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await expect(draft).toContainText('You said $15.00, but you usually charge $50.00 (4 past invoices).');
  await expect(page.getByRole('button', { name: /Decide the held prices/ })).toBeDisabled();

  await draft.getByRole('button', { name: 'Use usual $50.00' }).click();
  await expect(draft.getByTestId('draft-state')).toHaveText('Ready');
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
