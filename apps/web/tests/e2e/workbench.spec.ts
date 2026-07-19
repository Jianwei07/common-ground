import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("opens the local workbench and supports keyboard pane resizing", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("main")).toHaveClass(/workbench/);
  await expect(page.getByLabel("Architecture canvas")).toBeVisible();
  await expect(page.getByLabel("Code workspace")).toBeVisible();
  await expect(page.getByLabel("Run output")).toBeVisible();

  const splitter = page.getByRole("separator", { name: "Resize canvas and editor" });
  const before = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus();
  await splitter.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", String(before + 2));

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("redirects the root and makes narrow screens presentation-only", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("Presentation mode")).toBeVisible();
  await expect(page.getByText("Editing is available on a desktop browser.")).toBeVisible();
});
