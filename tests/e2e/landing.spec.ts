import { expect, test } from '@playwright/test';

test('[MC 6.2] landing page sells the product and opens the machine', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AfterBeep got the job');
  await expect(page.getByText('Why now')).toBeVisible();
  await expect(page.locator('#pricing')).toContainText('$39');
  await expect(page.locator('#pricing')).toContainText('14-day free trial');

  await page.getByRole('link', { name: 'Try the machine' }).click();
  await expect(page).toHaveURL(/\/machine$/);
  await expect(page.getByTestId('inbox-title')).toContainText(/You have \w+ new messages/);
  await expect(page.getByTestId('cassette').filter({ hasText: 'Priya Natarajan' })).toContainText('88 Hollow Pine Road');
});

test('theme toggle switches between graveyard shift and daylight', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Daylight/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
