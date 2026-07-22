import AxeBuilder from "@axe-core/playwright";
import { importGround } from "@common-ground/protocol";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("opens the local workbench and supports keyboard pane resizing", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("main")).toHaveClass(/workbench/);
  await expect(page.getByLabel("Architecture canvas")).toBeVisible();
  await expect(page.getByLabel("Code workspace")).toBeVisible();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(page.getByText("Run your code to see the result.")).toBeVisible();

  const splitter = page.getByRole("separator", { name: "Resize canvas and editor" });
  const before = Number(await splitter.getAttribute("aria-valuenow"));
  await splitter.focus();
  await splitter.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", String(before + 2));

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("keeps drawn dimensions through persistence and uses Excalidraw's hand shortcut", async ({ page }) => {
  await page.goto("/workspace");
  const canvas = page.locator("canvas.excalidraw__canvas.interactive");
  await expect(canvas).toBeVisible();
  const rectangleTool = page.getByTestId("toolbar-rectangle");
  await rectangleTool.locator("..").click();
  await expect(rectangleTool).toBeChecked();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas bounds are unavailable");

  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 270);
  await page.mouse.up();

  const beforeReload = await exportedWorkspace(page);
  expect(beforeReload.canvas.elements[0]).toMatchObject({ type: "rectangle", width: 160, height: 90 });

  await page.reload();
  await expect(page.locator("canvas.excalidraw__canvas.interactive")).toBeVisible();
  const afterReload = await exportedWorkspace(page);
  expect(afterReload.canvas.elements[0]).toMatchObject({ type: "rectangle", width: 160, height: 90 });

  const reloadedBox = await page.locator("canvas.excalidraw__canvas.interactive").boundingBox();
  if (!reloadedBox) throw new Error("Reloaded canvas bounds are unavailable");
  await page.mouse.click(reloadedBox.x + 80, reloadedBox.y + 100);
  await page.keyboard.press("h");
  await expect(page.getByTestId("toolbar-hand")).toBeChecked();
});

test("guides local runner setup, pairs, and immediately runs Python", async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");
  const appOrigin = new URL(baseURL).origin;
  let online = false;
  let paired = false;
  await page.route("http://127.0.0.1:43117/**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-origin": appOrigin,
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ headers, status: 204 });
    if (!online) return route.fulfill({ body: JSON.stringify({ error: "offline" }), headers, status: 503 });
    if (request.url().endsWith("/v1/health")) {
      return route.fulfill({ body: JSON.stringify({ paired, status: "ready", version: "test" }), headers });
    }
    if (request.url().endsWith("/v1/pair")) {
      expect(request.postDataJSON()).toEqual({ code: "123456" });
      paired = true;
      return route.fulfill({ body: JSON.stringify({ token: "a".repeat(64) }), headers });
    }
    const run = request.postDataJSON();
    expect(run).toMatchObject({ runtimeId: "python", entrypoint: "main.py" });
    const body = [
      { requestId: run.requestId, type: "status", status: "running" },
      { requestId: run.requestId, type: "stdout", chunk: "Hello from Python\\n" },
      { requestId: run.requestId, type: "stderr", chunk: "warning\\n" },
      { requestId: run.requestId, type: "exit", exitCode: 0, reason: "completed" },
    ].map((event) => JSON.stringify(event)).join("\n");
    return route.fulfill({ body, headers: { ...headers, "content-type": "application/x-ndjson" } });
  });

  await page.goto("/workspace");
  await expect(page.getByLabel("Language")).toHaveValue("python");
  await page.getByRole("button", { exact: true, name: "Run" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up local runner" });
  await expect(dialog).toContainText(`go run ./runner/cmd/common-ground-runner -origin ${appOrigin}`);

  online = true;
  await dialog.getByRole("button", { name: "Check connection" }).click();
  await dialog.getByLabel("Pairing code").fill("123456");
  await dialog.getByRole("button", { name: "Pair and run" }).click();

  const result = page.getByRole("region", { name: "Result" });
  await expect(result).toContainText("Hello from Python");
  await expect(result).toContainText("warning");
  await expect(result).toContainText("completed · exit 0");
});

test("redirects the root and makes narrow screens presentation-only", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("Presentation mode")).toBeVisible();
  await expect(page.getByText("Editing is available on a desktop browser.")).toBeVisible();
});

async function exportedWorkspace(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Ground artifact" }).click();
  const path = await (await downloadPromise).path();
  if (!path) throw new Error("Export download is unavailable");
  return importGround(new Uint8Array(await readFile(path)));
}
