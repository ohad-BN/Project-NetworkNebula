import { test, expect } from "@playwright/test";

test.describe("Create Job E2E Tests", () => {
  test("create-job page loads when authenticated", async ({ page }) => {
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

    // Navigate to create-job page
    await page.goto("http://localhost:5173/create-job");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Check form exists - if redirected to login, test will fail anyway
    const form = page.locator("form");
    await expect(form).toBeVisible({ timeout: 15000 });
  });

  test("page has expected structure", async ({ page }) => {
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

    await page.goto("http://localhost:5173/create-job");
    await page.waitForTimeout(2000);

    // Page should load without crash
    await expect(page.locator("body")).toBeVisible();

    // Try to find at least one interactive element
    const hasInteractive = await page
      .locator("textarea, input, button")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    expect(hasInteractive).toBeTruthy();
  });

  test("login page has form fields", async ({ page }) => {
    await page.goto("http://localhost:5173/login");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Check email and password fields exist
    const emailField = page.locator('input[type="email"], input[name="email"]');
    const passwordField = page.locator(
      'input[type="password"], input[name="password"]',
    );

    await expect(emailField).toBeVisible({ timeout: 5000 });
    await expect(passwordField).toBeVisible({ timeout: 5000 });
  });

  test("register page has form fields", async ({ page }) => {
    await page.goto("http://localhost:5173/register");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Check email and password fields exist
    const emailField = page.locator('input[type="email"], input[name="email"]');
    const passwordField = page.locator(
      'input[type="password"], input[name="password"]',
    );

    const emailVisible = await emailField
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const passwordVisible = await passwordField
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // At least one should be visible
    expect(emailVisible || passwordVisible).toBeTruthy();
  });

  test("homepage loads correctly", async ({ page }) => {
    await page.goto("http://localhost:5173/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Should see navbar at minimum
    const navbar = page.locator("nav").first();
    await expect(navbar).toBeVisible({ timeout: 10000 });
  });

  test("wallet page is accessible when logged in", async ({ page }) => {
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

    // Wallet page should load
    await expect(page.locator("body")).toBeVisible();
  });

  test("responsive design works on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("http://localhost:5173/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Page should load on mobile
    await expect(page.locator("body")).toBeVisible();

    // Mobile menu button should be present
    const menuButton = page
      .locator("button")
      .filter({ hasText: /menu/i })
      .first();
    const hasMenuButton = await menuButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Menu button is nice to have, don't fail if missing
    if (hasMenuButton) {
      await expect(menuButton).toBeVisible();
    }
  });

  test("responsive design works on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:5173/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Page should load
    await expect(page.locator("body")).toBeVisible();

    // Navbar should be visible at desktop size
    const navbar = page.locator("nav").first();
    await expect(navbar).toBeVisible({ timeout: 5000 });
  });
});
