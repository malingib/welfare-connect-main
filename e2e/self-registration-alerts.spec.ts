import { expect, test } from '@playwright/test';

const adminUsername = process.env.PLAYWRIGHT_ADMIN_USERNAME!;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD!;
const applicantPhone = '0799565035';

test('public self-registration submits the required member and notification payload', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route('**/functions/v1/api-membership-applications', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        application: { application_reference: 'APP-E2E001' },
      }),
    });
  });

  await page.goto('/apply');
  await page.getByLabel('Full name as it appears on National ID *').fill('E2E Test Applicant');
  await page.getByLabel('National ID number *').fill(`E2E-${Date.now()}`);
  await page.getByLabel('Date of birth *').fill('1990-01-01');
  await page.locator('select[name="gender"]').selectOption({ label: 'Male' });
  await page.getByLabel('Phone number (Safaricom) *').fill(applicantPhone);
  await page.locator('select[name="village"]').selectOption({ label: 'Malanga - Malanga' });
  await page.getByLabel('Full name *').fill('E2E Next of Kin');
  await page.getByLabel('Relationship *').fill('Sibling');
  await page.getByLabel('Phone number *').fill('0712345678');
  await page.getByRole('checkbox', { name: /I declare that the information provided is true/i }).check();
  await page.getByRole('button', { name: 'Submit application' }).click();

  await expect(page.getByText('Application received')).toBeVisible();
  await expect.poll(() => submittedPayload).not.toBeNull();
  expect(submittedPayload?.action).toBe('submit');
  expect(submittedPayload?.phone_number).toBe(applicantPhone);
  expect(submittedPayload?.declaration_accepted).toBe(true);
  expect(submittedPayload?.residence_status).toBe('resident');
}
);

test('SMS settings saves selected admin recipients for member alerts', async ({ page }) => {
  let savedPayload: Record<string, unknown> | null = null;

  await page.route('**/functions/v1/api-sms-alert-settings**', async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    if (payload.action === 'list') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: [] }) });
      return;
    }
    savedPayload = payload;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ setting: { trigger_key: payload.trigger_key, admin_user_ids: payload.admin_user_ids, is_active: true } }),
    });
  });
  await page.route('**/functions/v1/api-users-admin**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users: [{ id: 'admin-e2e', name: 'E2E Admin', username: 'e2e', role: 'secretary', is_active: true, member_id: 'member-e2e', phone_number: '254799565035' }] }),
    });
  });

  await page.goto('/login');
  await page.fill('input[name="username"]', adminUsername);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'SMS' }).click();
  await page.getByRole('tab', { name: 'Member Alert Recipients' }).click();
  await expect(page.getByText('Registration submitted')).toBeVisible({ timeout: 20000 });
  await page.getByRole('checkbox', { name: /E2E Admin secretary/i }).first().check();
  await page.getByRole('button', { name: 'Save recipients' }).first().click();
  await expect.poll(() => savedPayload).not.toBeNull();
  expect(savedPayload?.trigger_key).toBe('registration_submitted');
  expect(savedPayload?.admin_user_ids).toEqual(['admin-e2e']);
});
