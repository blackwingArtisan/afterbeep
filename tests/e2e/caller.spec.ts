import { expect, test } from '@playwright/test';

test('the caller booking page works on a phone', async ({ page, request }) => {
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

test('a bad booking link still shows the business and a call button', async ({ page }) => {
  await page.goto('/book/not-a-real-token');
  const card = page.getByTestId('bad-link');
  await expect(card).toContainText('Hollow Creek Plumbing & Appliance');
  await expect(card.getByRole('link', { name: /Call \(614\) 555-0142/ })).toHaveAttribute('href', 'tel:+16145550142');
});
