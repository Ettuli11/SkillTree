import { test, expect } from "@playwright/test";

// The playlist toolbar (level filters + commands) pins to the viewport top
// once scrolled out of view, same as the skill page.
const CATEGORY = "Roblox Studio";
const PLAYLIST = "Roblox Advanced Scripting Tutorial Guide (2023-2025)";

test("playlist toolbar pins on scroll", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto(
    `/category/${encodeURIComponent(CATEGORY)}/playlist/${encodeURIComponent(PLAYLIST)}`,
  );
  await expect(page.locator("[data-video-card]").first()).toBeVisible();
  const toolbar = page.locator("[data-selection-toolbar]").first();
  await expect(toolbar).toBeVisible();

  const scroller = page.locator("[data-app-scroll-container]").first();
  const maxScroll: number = await scroller.evaluate(
    (el) => (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight,
  );
  expect(maxScroll).toBeGreaterThan(400);

  await scroller.evaluate(
    (el) => ((el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight),
  );
  await page.waitForTimeout(400);

  // Still visible after scrolling to the bottom...
  await expect(toolbar).toBeVisible();
  // ...because the inner bar is pinned (fixed at viewport top). Note: the
  // outer row is the in-flow placeholder (off-screen when pinned), so measure
  // the fixed inner bar, not the row itself.
  const inner = toolbar.locator(":scope > div").first();
  await expect
    .poll(async () => inner.evaluate((el) => getComputedStyle(el as HTMLElement).position))
    .toBe("fixed");
  const box = await inner.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box?.y ?? 999)).toBeLessThan(4);

  // The commands are reachable without scrolling back up.
  await expect(page.getByTitle("Trascina le card nella posizione desiderata")).toBeVisible();
  await expect(page.getByTitle("Inverti l'ordine dei video")).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/sticky-toolbar-${testInfo.project.name}.png` });
});
