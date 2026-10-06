import { expect, test } from '@playwright/test';

test.describe('LIVE self-registration and SMS smoke test', () => {
  test.skip(!process.env.LIVE_SMS_E2E, 'Set LIVE_SMS_E2E=1 to run live SMS smoke test');

  test('submits, approves, and activates a new member using the live SMS path', async ({ page, context }) => {
    const phone = '0799565035';
    const nationalId = `LIVE-E2E-${Date.now()}`;
    const observedRequests: Array<Record<string, unknown>> = [];
    page.on('request', (request) => {
      if (request.url().includes('/functions/v1/api-membership-applications')) {
        try { observedRequests.push(request.postDataJSON() as Record<string, unknown>); } catch { /* ignore preflight */ }
      }
    });

    await page.goto('/apply');
    await page.getByLabel('Full name as it appears on National ID *').fill('Live E2E Test Member');
    await page.getByLabel('National ID number *').fill(nationalId);
    await page.getByLabel('Date of birth *').fill('1990-01-01');
    await page.locator('select[name="gender"]').selectOption({ label: 'Male' });
    await page.getByLabel('Phone number (Safaricom) *').fill(phone);
    await page.locator('select[name="village"]').selectOption({ label: 'Malanga - Malanga' });
    await page.getByLabel('Full name *').fill('Live E2E Next of Kin');
    await page.getByLabel('Relationship *').fill('Sibling');
    await page.getByLabel('Phone number *').fill('0712345678');
    await page.getByRole('checkbox', { name: /I declare that the information provided is true/i }).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Application received')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => observedRequests.find((request) => request.action === 'submit')).toBeTruthy();

    const admin = await context.newPage();
    await admin.goto('/login');
    await admin.fill('input[name="username"]', process.env.PLAYWRIGHT_ADMIN_USERNAME!);
    await admin.fill('input[name="password"]', process.env.PLAYWRIGHT_ADMIN_PASSWORD!);
    await admin.click('button[type="submit"]');
    await admin.waitForURL('**/dashboard', { timeout: 30000 });
    await admin.goto('/applications');
    const application = admin.locator('div.rounded-lg.border.p-4').filter({ hasText: nationalId }).first();
    await expect(application).toBeVisible({ timeout: 30000 });
    await application.getByRole('button', { name: 'Approve and request payment' }).click();
    await expect(application.getByText('payment reference', { exact: false })).toBeVisible({ timeout: 30000 });
    const activationDialog = admin.once('dialog', (dialog) => dialog.accept());
    await application.getByRole('button', { name: 'Confirm payment and activate' }).click();
    await activationDialog;
    await expect(application).toContainText('activated', { timeout: 30000 });

    const submitRequest = observedRequests.find((request) => request.action === 'submit');
    expect(submitRequest?.phone_number).toBe(phone);
  });
});
