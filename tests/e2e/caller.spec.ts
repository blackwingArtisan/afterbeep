import { expect, test } from './fixtures';

test('[MC 5.1, 5.9] the caller booking page works on a phone', async ({ page, request }) => {
  const res = await request.post('/api/calls', {
    data: { from: '+16145550110', transcript: 'Hi, this is Sam Rowe at 12 Willow Street. The upstairs toilet keeps running. No rush.' },
  });
  expect(res.status()).toBe(201);
  const { message } = (await res.json()) as { message: { bookingToken: string } };

  await page.goto(`/book/${message.bookingToken}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Sam');
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
  await page.getByRole('radio').nth(1).click();
  await page.getByRole('button', { name: /^Book / }).click();
  await expect(page.getByTestId('booked')).toBeVisible();
});

test('[MC 5.8] a bad booking link still shows the business and a call button', async ({ page }) => {
  await page.goto('/book/not-a-real-token');
  const card = page.getByTestId('bad-link');
  await expect(card).toContainText('Hollow Creek Plumbing & Appliance');
  await expect(card.getByRole('link', { name: /Call \(614\) 555-0142/ })).toHaveAttribute('href', 'tel:+16145550142');
});

test('[VI 5.8] a bad invoice link gives up the ghost but still offers a call', async ({ page }) => {
  await page.goto('/i/not-a-real-invoice');
  const card = page.getByTestId('bad-invoice');
  await expect(card).toContainText('This invoice has given up the ghost');
  await expect(card.getByRole('link', { name: /Call \(614\) 555-0142/ })).toHaveAttribute('href', 'tel:+16145550142');
});

test('on a phone the machine header stays on one row, with theme and reset in a menu', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout only');
  await page.goto('/machine');
  const header = page.locator('.machine-top .machine-actions');
  const story = header.getByRole('link', { name: 'Demo the whole story' });
  expect(await story.innerText()).toBe('Demo');
  const rows = await header.evaluate((el) => new Set([...el.children].filter((c) => (c as HTMLElement).offsetParent).map((c) => Math.round(c.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);
  await page.getByTestId('more-menu').locator('summary').click();
  await expect(page.getByTestId('more-menu').getByRole('button', { name: 'Reset demo' })).toBeVisible();
  for (const key of await page.locator('.keys-row .key').all()) {
    expect(await key.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});
