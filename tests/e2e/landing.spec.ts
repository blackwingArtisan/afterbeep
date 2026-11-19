import { expect, test } from '@playwright/test';

test('[MC 6.2] landing page sells the product and opens the machine', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AfterBeep got the job');
  await expect(page.getByText('Why now')).toBeVisible();
  await expect(page.locator('.hero')).toContainText('about $740 of work a month walks to the next name on the list');
  await expect(page.locator('.hero')).toContainText("It says it's a machine");
  await expect(page.getByTestId('tuesday')).toContainText('2 jobs booked, $557 of booked work, $35 caught');
  await expect(page.locator('#pricing')).toContainText('$39');
  await expect(page.locator('#pricing')).toContainText('14-day free trial');

  await page.getByRole('link', { name: 'Try the machine' }).click();
  await expect(page).toHaveURL(/\/machine$/);
  await expect(page.getByTestId('inbox-title')).toContainText(/You have \w+ new messages/);
  await expect(page.getByTestId('cassette').filter({ hasText: 'Priya Natarajan' })).toContainText('88 Hollow Pine Road');
});

test('the payback estimate shows its assumptions and moves with them', async ({ page }) => {
  await page.goto('/');
  const payback = page.getByTestId('payback');
  await expect(payback).toContainText('assumption');
  await expect(payback.getByTestId('payback-month')).toContainText('$740');
  await expect(payback.getByTestId('payback-times')).toContainText('18×');
  await payback.getByLabel(/Calls you miss a week/).fill('10');
  await expect(payback.getByTestId('payback-month')).toContainText('$1,490');
});

test('theme toggle switches between graveyard shift and daylight', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Daylight/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('[MC 7.9] the hero machine plays itself once a session, and never under reduced motion', async ({ page, browser }) => {
  await page.goto('/');
  const readout = page.getByTestId('device-readout');
  await expect(readout).toContainText('Texted back to (614) 555-0134', { timeout: 15_000 });
  // The cold open ends on the carbon copies holding "fifteen" at the usual $50.
  await expect(page.getByTestId('device-slip')).toContainText('On hold', { timeout: 10_000 });
  await page.reload();
  await page.waitForTimeout(1_500);
  await expect(readout).toContainText('Press Play');

  const still = await browser.newPage({ reducedMotion: 'reduce' });
  await still.goto('/');
  await still.waitForTimeout(1_500);
  await expect(still.getByTestId('device-readout')).toContainText('Press Play');
  await expect(still.getByTestId('device-vu')).toBeVisible();
  await still.close();
});
