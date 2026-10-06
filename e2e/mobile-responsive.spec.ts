import { expect, test } from '@playwright/test';

const adminUsername = process.env.PLAYWRIGHT_ADMIN_USERNAME!;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD!;

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > viewport + 2 && getComputedStyle(element).position !== 'fixed';
      })
      .slice(0, 5)
      .map((element) => ({ tag: element.tagName, className: element.className }));
    return { scrollWidth: document.documentElement.scrollWidth, viewport, offenders };
  });
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.viewport + 2);
}

test('public pages remain usable at a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/apply', '/signup']) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
  await expect(page.getByRole('button', { name: /Submit application/ })).toBeVisible();
  await page.goto('/login');
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: /Login/ }).last()).toBeVisible();
});

test('authenticated dashboard shell remains usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.fill('input[name="username"]', adminUsername);
  await page.fill('input[name="password"]', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Toggle menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await expect(page.getByRole('link', { name: 'Applications' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
