import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/api/demo/reset');
});
test.afterEach(async ({ request }) => {
  await request.post('/api/demo/reset');
});

test('[MC 6.6, 7.7, 7.10, 8.2, 8.5] [VI 5.7, 5.9] the whole story runs from a missed call to a paid invoice and raises the dead', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Demo the whole story/ }).click();
  await expect(page).toHaveURL(/\/machine\/call\?story=1$/);

  // The call starts on its own and skips the ring and greeting.
  const result = page.getByTestId('sim-result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result).toContainText('June Calloway');
  await expect(result).toContainText('27 Larkspur Lane');
  await expect(page.getByTestId('texted-stamp')).toBeVisible();
  await expect(page.getByTestId('sim-phone')).toContainText('Hi June');
  await expect(page.getByTestId('story-bar')).toContainText('step 2 of 4');

  await page.getByTestId('story-next').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi June');
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: /^Book / }).click();
  await expect(page.getByTestId('booked')).toContainText("You're on the schedule, June");

  await page.getByTestId('story-next').click();
  await expect(page).toHaveURL(/\/machine\/invoice\?/);
  await expect(page.getByLabel('Job')).toContainText('June Calloway');
  await expect(page.getByLabel('What you said')).toHaveValue(/Dryer belt fifteen/);
  await page.getByRole('button', { name: 'Line it up' }).click();

  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await draft.getByRole('button', { name: 'Use usual $50.00' }).click();
  await page.getByRole('button', { name: /Approve and send/ }).click();

  const sent = page.getByTestId('invoice-sent');
  await expect(sent).toContainText(/Invoice HC-\d+ is out/);
  await expect(page.getByTestId('sent-stamp')).toBeVisible();
  await expect(sent).toContainText('Hi June, here is invoice');

  // The finale counts up what the story kept, and the carbon copies print with their price checks.
  await expect(page.getByTestId('story-bar')).toContainText('complete');
  const finale = page.getByTestId('story-finale');
  await expect(finale.getByTestId('finale-booked')).toHaveText('01');
  await expect(finale.getByTestId('finale-billed')).toHaveText('$182.88');
  await expect(finale.getByTestId('finale-caught')).toHaveText('$35.00');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('carbon-set')).toBeVisible();
  await expect(page.getByTestId('carbon-stamp').first()).toHaveText('Caught: heard $15.00, billed $50.00');
  await page.emulateMedia({ media: 'screen' });

  // June pays, and PAID slams down.
  await finale.getByTestId('pay-as-customer').click();
  await page.getByRole('button', { name: 'Pay $182.88' }).click();
  await expect(page.getByTestId('paid-stamp')).toBeVisible();
  await expect(page.getByTestId('customer-invoice')).toContainText('Paid in full');

  // One more thing: last week's hang-ups wait in the graveyard, and one press raises them.
  await page.getByRole('link', { name: 'Back to the machine' }).click();
  const graveyard = page.getByTestId('graveyard');
  await expect(graveyard).toContainText('One more thing');
  await expect(graveyard.getByTestId('ghost')).toHaveCount(5);
  await graveyard.getByTestId('raise-dead').click();
  await expect(graveyard.getByTestId('raise-result')).toContainText('Raised 5.');
  await expect(graveyard).toContainText('The dead have risen.');
  // Each raised cassette takes a TEXTED stamp.
  await expect(graveyard.getByTestId('ghost-stamp')).toHaveText(['Texted', 'Texted', 'Texted', 'Texted', 'Texted']);

  await page.goto('/machine');
  await expect(page.getByTestId('kept-booked')).toHaveText('02');
  await expect(page.getByTestId('kept-jobs')).toHaveText('$557');
  await expect(page.getByTestId('kept-payback')).toContainText('14×');
  await expect(page.getByTestId('kept-caught')).toHaveText('$35');
});

test('[MC 7.8] the hero machine plays a missed call and shows the price check', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const device = page.getByTestId('device');
  await device.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('device-readout')).toContainText('Texted back to (614) 555-0134');
  await expect(page.getByTestId('device-readout')).toContainText('88 Hollow Pine Road');

  await device.getByRole('button', { name: 'Bill' }).click();
  await expect(page.getByTestId('device-slip')).toContainText('On hold');
  await expect(page.getByTestId('device-slip')).toContainText('You always charge $50 for a dryer belt');

  await device.getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/book\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/^Hi /);
});

test('[MC 8.7] the graveyard stays still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/machine');
  const graveyard = page.getByTestId('graveyard');
  await expect(graveyard.getByTestId('ghost')).toHaveCount(5);
  const still = async () =>
    graveyard.evaluate((el) =>
      [el, ...el.querySelectorAll('.ghost, .ghost-cassette, .ghost-stamp')].flatMap((node) => [getComputedStyle(node).animationName, getComputedStyle(node, '::before').animationName]),
    );
  expect(new Set(await still())).toEqual(new Set(['none']));
  await graveyard.getByTestId('raise-dead').click();
  await expect(graveyard.getByTestId('ghost').first()).toHaveClass(/risen/);
  expect(new Set(await still())).toEqual(new Set(['none']));
});
