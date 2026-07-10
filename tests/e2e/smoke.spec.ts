import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home page loads without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const response = await page.goto("/");

    expect(response, "expected a navigation response for /").not.toBeNull();
    expect(response!.status()).toBe(200);

    // The document should actually render content, not a blank shell.
    await expect(page.locator("body")).toBeVisible();
    expect((await page.content()).length).toBeGreaterThan(0);

    expect(
      consoleErrors,
      `console errors on /: ${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
