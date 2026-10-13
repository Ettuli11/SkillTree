import { test, expect, type Page, type Locator } from "@playwright/test";

// Press-hold-drag across the level tabs selects whatever tab is under the
// pointer (liquid-glass segmented control scrub). Taps keep working as before.
async function tabCenter(loc: Locator) {
  const box = await loc.boundingBox();
  if (!box) throw new Error("tab has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pillLeft(page: Page): Promise<number> {
  const left = await page
    .getByTestId("level-pill")
    .evaluate((el) => (el as HTMLElement).style.left);
  return Number.parseFloat(left) || 0;
}

test("level tabs scrub-select on drag", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const isMobile = testInfo.project.name === "mobile";
  // On narrow viewports the row scrolls, so scrub to the adjacent tab (same
  // gesture code path); on desktop the whole row is visible, scrub end to end.
  const targetName = isMobile ? "Beginner" : "Expert";
  const targetCount = isMobile ? 7 : 0;
  await page.goto("/category/Blender");
  // The tab row can open scrolled on narrow viewports; start from the left
  // edge so drag coordinates are on-screen.
  await page.locator('[role="tablist"]').evaluate((el) => {
    el.scrollLeft = 0;
  });
  const allTab = page.getByRole("tab", { name: "All" });
  const targetTab = page.getByRole("tab", { name: targetName });
  await expect(allTab).toHaveAttribute("data-state", "active");
  const pillBefore = await pillLeft(page);

  // Press on All, drag over to the target without releasing.
  const from = await tabCenter(allTab);
  const to = await tabCenter(targetTab);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });

  // The tab under the pointer is selected mid-gesture and the pill glides.
  await expect(targetTab).toHaveAttribute("data-state", "active");
  expect(await pillLeft(page)).toBeGreaterThan(pillBefore);

  // Release commits: still selected, grid filtered accordingly.
  await page.mouse.up();
  await expect(targetTab).toHaveAttribute("data-state", "active");
  await expect(page.locator("[data-reorder-card]")).toHaveCount(targetCount);

  // Taps still work exactly as before. Center the tab bar first so the
  // click needs no auto-scroll (which would toggle the sticky toolbar and
  // shift the layout mid-click on narrow viewports).
  const tapName = isMobile ? "Intermediate" : "Beginner";
  const tapCount = isMobile ? 0 : 7;
  await page
    .locator("[data-controls-rail]")
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await page.getByRole("tab", { name: tapName }).click();
  await expect(page.getByRole("tab", { name: tapName })).toHaveAttribute("data-state", "active");
  await expect(page.locator("[data-reorder-card]")).toHaveCount(tapCount);
});

test("playlist level buttons scrub-select on drag", async ({ page }) => {
  test.setTimeout(120000);
  const playlist = "Roblox Advanced Scripting Tutorial Guide (2023-2025)";
  await page.goto(`/category/Roblox Studio/playlist/${encodeURIComponent(playlist)}`);
  const tabs = page.locator("[data-level-tab]");
  await expect(tabs.first()).toBeVisible();
  const total = await page.locator("[data-video-card]").count();
  expect(total).toBeGreaterThan(1);

  // Drag from Tutti onto the first level button.
  const target = tabs.nth(1);
  const targetText = (await target.textContent()) ?? "";
  const targetCount = Number(targetText.replace(/[^0-9]/g, "")) || 0;
  const from = await tabCenter(tabs.nth(0));
  const to = await tabCenter(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  // The dragged-over level is active (primary style) and the grid is filtered.
  await expect(target).toHaveClass(/bg-primary/);
  if (targetCount > 0 && targetCount < total) {
    expect(await page.locator("[data-video-card]").count()).toBe(targetCount);
  }
});
