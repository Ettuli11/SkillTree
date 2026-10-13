import { test, expect, type Page } from "@playwright/test";

// Sidebar skill tracks: native HTML5 DnD (synthesized via dispatchEvent,
// as Playwright mouse events cannot drive native drag-and-drop).
async function sidebarNames(page: Page): Promise<string[]> {
  return page
    .locator("aside div[draggable='true'] span.truncate")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).textContent?.trim() ?? ""));
}

async function html5Drag(page: Page, from: number, to: number) {
  const items = page.locator("aside div[draggable='true']");
  await items.nth(from).evaluate((el, i) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", String(i));
    el.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }, from);
  await items.nth(to).evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
}

test("sidebar skill reorder saves", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar is hidden below md");
  test.setTimeout(120000);
  await page.goto("/");
  await expect(page.locator("aside div[draggable='true']").first()).toBeVisible();
  const before = await sidebarNames(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  const [first, second] = before;

  await html5Drag(page, 1, 0);
  await expect(page.getByText("Ordine skill aggiornato")).toBeVisible();
  expect(await sidebarNames(page)).toEqual([second, first, ...before.slice(2)]);
  await expect(page.getByText("Impossibile salvare il nuovo ordine delle skill")).toHaveCount(0);

  // restore original order
  await html5Drag(page, 1, 0);
  await expect(page.getByText("Ordine skill aggiornato")).toBeVisible();
  expect(await sidebarNames(page)).toEqual(before);
});

test("aborted sidebar drag does not stick the gray highlight", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar is hidden below md");
  test.setTimeout(120000);
  await page.goto("/");
  await expect(page.locator("aside div[draggable='true']").first()).toBeVisible();
  const before = await sidebarNames(page);
  const item = page.locator("aside div[draggable='true']").nth(1);

  // Start a drag (row turns gray while dragging)...
  await item.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "1");
    el.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  });
  await expect(item).toHaveClass(/opacity-40/);

  // ...then end it outside any item (drop missed / Escape): dragend must
  // clear the highlight instead of leaving the row gray forever.
  await item.evaluate((el) => {
    el.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true }));
  });
  await expect(item).not.toHaveClass(/opacity-40/);
  expect(await sidebarNames(page)).toEqual(before);
});

test("sidebar has no real links and buttons navigate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sidebar is hidden below md");
  test.setTimeout(120000);
  await page.goto("/");
  // No <a href> left in the sidebar: hovering rows must not show Chrome's
  // link-preview bubble anymore.
  await expect(page.locator("aside a[href]")).toHaveCount(0);

  // Buttons navigate like the links did.
  await page.locator("aside button", { hasText: "Roblox Studio" }).click();
  await expect(page).toHaveURL(/\/category\/Roblox%20Studio$/);
  await page.locator("aside button", { hasText: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
});
