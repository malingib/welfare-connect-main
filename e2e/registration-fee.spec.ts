import { expect, test } from '@playwright/test';

const username = process.env.PLAYWRIGHT_ADMIN_USERNAME!;
const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD!;

test('registration fee UI submits checked deduction parameters', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  let insertPayload: Record<string, unknown> | null = null;
  await page.route('**/rest/v1/rpc/member_number_exists', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'false' });
  });
  await page.route('**/rest/v1/rpc/insert_member', async (route) => {
    insertPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, id: '00000000-0000-4000-8000-000000000001' }),
    });
  });

  await page.goto('/members/new');
  await expect(page.getByRole('heading', { name: 'Registration Payment' })).toBeVisible({ timeout: 20000 });

  const feeInput = page.getByLabel('Registration Fee (KES)*');
  await expect(feeInput).toBeVisible();
  await expect(feeInput).toHaveValue(/\d+/, { timeout: 20000 });
  const displayedFee = Number(await feeInput.inputValue());
  expect(displayedFee).toBeGreaterThan(0);

  const feePaid = page.getByRole('checkbox', { name: 'Fee Payment Status' });
  await feePaid.click();
  await expect(feePaid).toBeChecked();

  await page.getByLabel('Full Name*').fill('Registration UI Test');
  await page.getByText('Select gender').click();
  await page.getByRole('option', { name: 'Male', exact: true }).click();
  await page.getByPlaceholder('Select date of birth').fill('1990-01-01');
  await page.getByLabel('National ID Number*').fill(`UI-${Date.now()}`);

  await page.getByText('Select residence').click();
  await page.getByRole('option').first().click();

  await page.getByLabel('Name*', { exact: true }).fill('Next of Kin');
  await page.getByText('Select relationship').click();
  await page.getByRole('option', { name: 'Friend', exact: true }).click();
  await page.getByLabel('Phone Number*', { exact: true }).fill('0712345678');

  await page.getByRole('button', { name: 'Register Member' }).click();
  await expect.poll(() => insertPayload, { timeout: 20000 }).not.toBeNull();
  expect(insertPayload?.p_fee_paid).toBe(true);
  expect(Number(insertPayload?.p_registration_fee)).toBe(displayedFee);
});
