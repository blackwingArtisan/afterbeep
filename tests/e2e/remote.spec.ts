import { expect, test, type APIRequestContext, type Page } from './fixtures';

const SLIP = 'Dryer belt fifteen, taxed. One hour labor at eighty-five. Trip charge.';

async function callMachine(page: Page) {
  await page.goto('/machine');
  await page.getByRole('navigation', { name: 'Machine' }).getByRole('link', { name: 'Remote' }).click();
  await expect(page).toHaveURL(/\/machine\/remote$/);
  await page.getByRole('button', { name: /Call (your machine|again)/ }).click();
}

const tape = (page: Page) => page.getByTestId('remote-tape');
const key = (page: Page, k: string) => page.getByRole('group', { name: 'Keypad' }).getByRole('button', { name: k, exact: true });

async function quietInbox(request: APIRequestContext) {
  const { messages } = (await (await request.get('/api/messages')).json()) as { messages: { id: string; status: string }[] };
  for (const m of messages.filter((x) => x.status === 'new')) {
    await request.post(`/api/messages/${m.id}/status`, { data: { status: 'heard' } });
  }
}

test('[RR 1.1, 1.3, 1.5, 1.6, 12.3, 12.4, 12.1, 12.10, 12.12] a wrong code three times ends the call without reading anything', async ({ page }) => {
  await callMachine(page);
  await expect(tape(page)).toContainText('This is the answering machine for Hollow Creek Plumbing');
  await expect(page.getByTestId('remote-demo-code')).toContainText('427');
  // Every key is at least 56 px square, so it works one-handed (RR 12.12).
  for (const k of ['0', '1', '5', '9', '*', '#']) {
    const box = await key(page, k).boundingBox();
    expect(box!.width, k).toBeGreaterThanOrEqual(56);
    expect(box!.height, k).toBeGreaterThanOrEqual(56);
  }

  // The computer keyboard presses the keys too.
  for (const k of ['1', '1', '1']) await page.keyboard.press(k);
  await expect(tape(page)).toContainText('That code is not right.');
  await page.keyboard.press('2');
  await page.keyboard.press('*'); // clears the digit
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await expect(tape(page).getByText('That code is not right.')).toHaveCount(2);
  for (const k of ['3', '3', '3']) await key(page, k).click();
  await expect(tape(page)).toContainText('Goodbye.');
  await expect(page.getByTestId('remote-tape')).not.toContainText('new message');
  await expect(key(page, '1')).toBeDisabled();
});

test('[RR 1.1, 1.2, 3.1, 4.1, 5.1, 5.4, 6.2, 8.1, 8.3, 12.1, 12.2, 12.4, 12.7, 12.9, 12.11] key the code, hear, text, erase, say the invoice, and get a held draft', async ({ page, request }) => {
  await quietInbox(request);
  const calls = [
    { from: '+16145550166', transcript: 'Hi, this is Dana Whitfield. My kitchen faucet drips all day. I am at 12 Maple Street. Call me back.' },
    {
      from: '+16145550167',
      transcript:
        'This is Hector Vance. My furnace quit and it is twenty degrees out with a baby at home. I am at 41 Lantern Hill Drive. Please hurry.',
    },
  ];
  for (const data of calls) expect((await request.post('/api/calls', { data })).status()).toBe(201);
  const outboxBefore = ((await (await request.get('/api/outbox')).json()) as { outbox: { kind: string }[] }).outbox;

  await callMachine(page);
  await expect(page.getByTestId('lcd-count')).toHaveText('02');
  await key(page, '4').click();
  await key(page, '2').click();
  await key(page, '7').click();
  await expect(tape(page)).toContainText('You have 2 new messages.');
  await expect(tape(page)).toContainText('Message 1 of 2. Emergency.');

  await key(page, '1').click();
  await expect(tape(page).locator('[data-who="caller"]')).toContainText('furnace quit');
  await key(page, '2').click();
  // The call itself was texted back a moment ago, so the machine sends nothing a second time.
  await expect(tape(page)).toContainText('That caller was texted a moment ago.');
  const outbox = ((await (await request.get('/api/outbox')).json()) as { outbox: unknown[] }).outbox;
  expect(outbox.length).toBe(outboxBefore.length);

  await key(page, '#').click();
  await expect(tape(page)).toContainText('Message 2 of 2.');
  await key(page, '9').click();
  await expect(tape(page)).toContainText('Press 9 again to erase it.');
  await key(page, '9').click();
  await expect(tape(page)).toContainText('Erased.');
  await expect(tape(page)).toContainText('After the beep, say your invoice.');
  // Each line is sized to its text, and the transcript is scrolled to the newest prompt.
  const lineHeights = await tape(page).locator('.remote-line').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.max(...lineHeights)).toBeLessThan(200);
  await expect.poll(() => tape(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);

  const { messages } = (await (await request.get('/api/messages')).json()) as { messages: { from: string; status: string }[] };
  expect(messages.find((m) => m.from === '+16145550166')).toBeUndefined();
  expect(messages.find((m) => m.from === '+16145550167')?.status).toBe('heard');

  await page.getByLabel('Say your invoice').fill(SLIP);
  await page.getByRole('button', { name: /Give it to the machine/ }).click();
  await expect(tape(page)).toContainText('Your invoice is a draft. Nothing goes out until you approve the total.');
  await expect(tape(page)).not.toContainText('$');
  // Hearing one and erasing the other leaves nothing new; the header count refreshes when the call ends (RR 12.11).
  await expect(page.getByTestId('lcd-count')).toHaveText('00');

  await page.getByTestId('open-draft').click();
  await expect(page).toHaveURL(/\/machine\/invoice$/);
  await expect(page.getByLabel('What you said')).toHaveValue(SLIP);
  await page.getByRole('button', { name: 'Line it up' }).click();
  const draft = page.getByTestId('draft');
  await expect(draft.getByTestId('draft-state')).toHaveText('On hold');
  await expect(page.getByRole('button', { name: /Settle the held lines/ })).toBeDisabled();

  const after = ((await (await request.get('/api/outbox')).json()) as { outbox: { kind: string }[] }).outbox;
  expect(after.filter((o) => o.kind === 'invoice').length).toBe(outboxBefore.filter((o) => o.kind === 'invoice').length);
});
