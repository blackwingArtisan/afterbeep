import { expect, test } from '@playwright/test';

test('a missed call becomes a booked job', async ({ page, request }) => {
  const before = ((await (await request.get('/api/messages')).json()) as { newCount: number }).newCount;
  await page.goto('/machine/call');
  await page.getByRole('radio', { name: /Furnace out overnight/ }).click();
  await expect(page.getByLabel('Caller ID')).toHaveValue('(614) 555-0163');

  await page.getByRole('button', { name: 'Call the machine' }).click();
  // Skip the ring and the greeting.
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: 'Skip to the beep' });
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    await page.waitForTimeout(150);
  }

  const result = page.getByTestId('sim-result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result).toContainText('Hector Alvarez');
  await expect(result).toContainText('41 Lantern Hill Drive');
  await expect(result).toContainText('(614) 555-0163');

  await page.getByRole('link', { name: /Open the text as the caller/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Hector');
  await expect(page.getByLabel('Address for the visit')).toHaveValue('41 Lantern Hill Drive');
  const firstSlot = page.getByRole('radio').first();
  await firstSlot.click();
  await page.getByRole('button', { name: /^Book / }).click();
  await expect(page.getByTestId('booked')).toContainText("You're on the schedule, Hector");

  await page.goto('/machine/schedule');
  await expect(page.getByTestId('job').filter({ hasText: 'Hector Alvarez' })).toContainText('41 Lantern Hill Drive');

  await page.goto('/machine');
  await expect(page.getByTestId('lcd-count')).toHaveText(String(before + 1).padStart(2, '0'));
  const tape = page.getByTestId('cassette').filter({ hasText: 'Hector Alvarez' });
  await expect(tape.getByTestId('booking-status')).toContainText('Booked');

  await page.goto('/machine/outbox');
  await expect(page.getByTestId('outbox-item').first()).toContainText("You're booked, Hector");
});

test('a hang-up is filed but nobody is texted', async ({ page, request }) => {
  const outboxBefore = ((await (await request.get('/api/outbox')).json()) as { outbox: unknown[] }).outbox.length;
  const res = await request.post('/api/calls', { data: { from: '+16145550191', transcript: 'uh hello? hello? nobody there' } });
  expect(res.status()).toBe(201);

  await page.goto('/machine');
  const tape = page.getByTestId('cassette').filter({ hasText: '(614) 555-0191' });
  await expect(tape.getByTestId('booking-status')).toContainText('No text sent: the message had no name, address or job in it.');
  const outboxAfter = ((await (await request.get('/api/outbox')).json()) as { outbox: unknown[] }).outbox.length;
  expect(outboxAfter).toBe(outboxBefore);
});

test('new emergencies sit at the top of the inbox with a call-back strip', async ({ page, request }) => {
  const res = await request.post('/api/calls', {
    data: {
      from: '+16145550188',
      transcript: "This is Dana Whitfield at 40 Elm Street. Our furnace quit, it's twenty degrees out and we have a baby at home.",
    },
  });
  expect(res.status()).toBe(201);

  await page.goto('/machine');
  await expect(page.getByTestId('call-now')).toContainText('Dana Whitfield');
  await expect(page.getByTestId('call-now').getByRole('link', { name: /Dana Whitfield/ })).toHaveAttribute('href', 'tel:+16145550188');
  await expect(page.getByTestId('cassette').first()).toContainText('Emergency');
  const dana = page.getByTestId('cassette').filter({ hasText: 'Dana Whitfield' });
  await expect(dana).toContainText('Heating: no heat, freezing');
});
