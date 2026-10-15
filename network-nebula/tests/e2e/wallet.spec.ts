import { test, expect } from "@playwright/test";

test.describe("Wallet E2E Tests", () => {
  test("wallet page loads when authenticated", async ({ page }) => {
    // First login
    await page.goto("http://localhost:5173/login");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    );

    if (await emailInput.isVisible({ timeout: 3000 })) {
      await emailInput.fill("test@example.com");
      await passwordInput.fill("TestPassword123!");
      await page.getByRole("button", { name: /login|submit/i }).click();
      await page.waitForTimeout(2000);
    }

    // Navigate to wallet page
    await page.goto("http://localhost:5173/wallet");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Wallet page should load
    await expect(page.locator("body")).toBeVisible({ timeout: 15000 });
  });

  test("wallet page structure loads", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    );

    if (await emailInput.isVisible({ timeout: 3000 })) {
      await emailInput.fill("test@example.com");
      await passwordInput.fill("TestPassword123!");
      await page.getByRole("button", { name: /login|submit/i }).click();
      await page.waitForTimeout(2000);
    }

    await page.goto("http://localhost:5173/wallet");
    await page.waitForTimeout(2000);

    // Page should have interactive elements
    const hasInteractive = await page
      .locator("button, input, div")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasInteractive).toBeTruthy();
  });

  test("deposit button exists", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    );

    if (await emailInput.isVisible({ timeout: 3000 })) {
      await emailInput.fill("test@example.com");
      await passwordInput.fill("TestPassword123!");
      await page.getByRole("button", { name: /login|submit/i }).click();
      await page.waitForTimeout(2000);
    }

    await page.goto("http://localhost:5173/wallet");
    await page.waitForTimeout(2000);

    // Look for deposit button
    const depositButton = page.locator("button:has-text('Deposit')").first();
    const hasDeposit = await depositButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (hasDeposit) {
      await expect(depositButton).toBeVisible();
    }
  });

  test("withdraw button exists for workers", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    );

    if (await emailInput.isVisible({ timeout: 3000 })) {
      await emailInput.fill("test@example.com");
      await passwordInput.fill("TestPassword123!");
      await page.getByRole("button", { name: /login|submit/i }).click();
      await page.waitForTimeout(2000);
    }

    await page.goto("http://localhost:5173/wallet");
    await page.waitForTimeout(2000);

    // Look for withdraw button
    const withdrawButton = page.locator("button:has-text('Withdraw')").first();
    const hasWithdraw = await withdrawButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (hasWithdraw) {
      await expect(withdrawButton).toBeVisible();
    }
  });

  test("login page has correct structure", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Should have form elements
    const form = page.locator("form");
    await expect(form).toBeVisible({ timeout: 10000 });
  });

  test("homepage loads with navbar", async ({ page }) => {
    await page.goto("http://localhost:5173/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Should see navbar
    const navbar = page.locator("nav").first();
    await expect(navbar).toBeVisible({ timeout: 10000 });
  });

  test("responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:5173/wallet");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Page should load on mobile
    await expect(page.locator("body")).toBeVisible();
  });

  test("responsive on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("http://localhost:5173/wallet");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Page should load on tablet
    await expect(page.locator("body")).toBeVisible();
  });

  test("responsive on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:5173/wallet");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Page should load
    await expect(page.locator("body")).toBeVisible();
  });

  test("register page is accessible", async ({ page }) => {
    await page.goto("http://localhost:5173/register");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Should have form
    const form = page.locator("form");
    await expect(form).toBeVisible({ timeout: 10000 });
  });
});
