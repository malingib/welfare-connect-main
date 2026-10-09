import { expect, test } from '@playwright/test';

test('public homepage buttons and page navigation work', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Portal Login/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'New member? Apply online' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText('Malanga Community Welfare Online Membership Application')).toBeVisible();

  await page.getByRole('link', { name: 'Back Home' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Toggle menu' }).click();
  await page.getByRole('button', { name: 'Member Portal' }).click();
  await expect(page).toHaveURL(/\/login\?role=member$/);
  await expect(page.getByRole('button', { name: 'Member' })).toBeVisible();
});

test('homepage links to the official Android app download', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Download the App' }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(
    page.getByRole('heading', { name: 'Malanga Welfare, wherever you are.' }),
  ).toBeVisible();

  const download = page.getByRole('link', { name: 'Download for Android' });
  await expect(download).toHaveAttribute('href', '/malanga-welfare.apk');
  await expect(download).toHaveAttribute('download', 'malanga-welfare.apk');
});
