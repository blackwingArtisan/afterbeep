import { expect, test } from './fixtures';

test.beforeEach(async ({ request }) => {
  await request.post('/api/demo/reset');
});
test.afterEach(async ({ request }) => {
  await request.post('/api/demo/reset');
});

test('[MC 10.1, 10.2, 10.3, 10.4] the owner writes the greeting, sees the checks, and the next caller hears it', async ({ page }) => {
  await page.goto('/machine/call');
  await page.getByRole('link', { name: 'Change the greeting' }).click();
  await expect(page).toHaveURL(/\/machine\/greeting$/);

  const box = page.getByLabel('What callers hear');
  await expect(box).toHaveValue(/answering machine/);
  const checks = page.getByTestId('greeting-check');
  await expect(checks).toHaveCount(4);
  for (const check of await checks.all()) await expect(check).toHaveAttribute('data-pass', 'true');
  await expect(page.getByRole('button', { name: 'Play it as a caller' })).toBeEnabled();

  // A plain voicemail greeting fails three checks.
  await box.fill("Hi, you've reached Morgan. Leave a message.");
  await expect(page.locator('[data-testid="greeting-check"][data-pass="false"]')).toHaveCount(3);

  // A greeting that pretends to be a person cannot be saved.
  await box.fill("Hi, this is the receptionist at Hollow Creek. Leave your name, address and what's going on and we'll text you.");
  await expect(page.getByRole('alert')).toContainText('honest machine');
  await expect(page.getByRole('button', { name: 'Save greeting' })).toBeDisabled();

  await page.getByRole('button', { name: 'Use the suggested greeting' }).click();
  await expect(box).toHaveValue("You've reached Hollow Creek Plumbing & Appliance's answering machine. Morgan is on a job right now. Leave your name, address and what's going on after the beep, and you'll get a text with times we can come out.");
  await page.getByRole('button', { name: 'Save greeting' }).click();
  await expect(page.getByTestId('greeting-saved')).toContainText('The next caller hears it');

  // The next call plays the saved greeting.
  await page.getByRole('link', { name: 'Ring the machine to hear it in a call' }).click();
  await page.getByLabel('Skip the ring and greeting').uncheck();
  await page.getByRole('button', { name: 'Call the machine' }).click();
  await expect(page.locator('.sim-caption')).toContainText('Morgan is on a job right now', { timeout: 10_000 });
});
