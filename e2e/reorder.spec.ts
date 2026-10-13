import { test, expect, type Page } from "@playwright/test";

const CATEGORY = "Blender";
const RAPID_DRAGS = 24;
const SETTLE_MS = 2500;

type CardBox = { key: string; x: number; y: number; w: number; h: number };

async function cardBoxes(page: Page): Promise<CardBox[]> {
  return page.locator("[data-reorder-card]").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = (card as HTMLElement).getBoundingClientRect();
      return {
        key: (card as HTMLElement).dataset.reorderKey ?? "",
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
      };
    }),
  );
}

async function gridBox(page: Page) {
  const box = await page.locator("div.grid:has([data-reorder-card])").first().boundingBox();
  if (!box) throw new Error("reorder grid not found");
  return box;
}

function center(box: CardBox) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// Every reorder card must live inside the grid. The drag ghost (floating
// clone that follows the pointer, also over the sidebar) must never carry
// [data-reorder-card]: it would corrupt the FLIP measurement map keyed by
// reorder key and get FLIP transforms stacked on its pointer-follow transform.
async function expectGridOnlyCards(page: Page) {
  const stray = await page
    .locator("[data-reorder-card]")
    .evaluateAll((cards) =>
      cards
        .filter((card) => !(card as HTMLElement).closest("div.grid"))
        .map((card) => (card as HTMLElement).dataset.reorderKey ?? "?"),
    );
  expect(stray, "drag ghost leaked into [data-reorder-card]").toEqual([]);
}

// The FLIP-animated grid cards must never leave the grid area (center stays
// within the grid expanded by a small margin). Covers cards drifting over the
// sidebar or flashing at the top of the page while the pointer moves outside.
async function expectCardsInsideGrid(page: Page) {
  const grid = await gridBox(page);
  const boxes = await cardBoxes(page);
  const margin = 24;
  for (const box of boxes) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(
      cx >= grid.x - margin &&
        cx <= grid.x + grid.width + margin &&
        cy >= grid.y - margin &&
        cy <= grid.y + grid.height + margin,
      `card ${box.key} escaped the grid (center ${Math.round(cx)},${Math.round(cy)} vs grid ${Math.round(grid.x)},${Math.round(grid.y)} ${Math.round(grid.width)}x${Math.round(grid.height)})`,
    ).toBe(true);
  }
}

async function outsidePoint(page: Page) {
  const grid = await gridBox(page);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const cx = Math.min(Math.max(grid.x + grid.width / 2, 20), viewport.width - 20);
  // Prefer a point above the grid (towards the header/sidebar area)…
  if (grid.y - 140 >= 20) return { x: Math.max(grid.x - 150, 20), y: grid.y - 140 };
  // …otherwise below it.
  return { x: cx, y: Math.min(grid.y + grid.height + 140, viewport.height - 20) };
}

async function rapidDrag(page: Page, fromIndex: number, toIndex: number, swingOut: boolean) {
  let boxes = await cardBoxes(page);
  if (fromIndex >= boxes.length || toIndex >= boxes.length) return;
  await page
    .locator(`[data-reorder-key="${boxes[fromIndex].key}"]`)
    .first()
    .scrollIntoViewIfNeeded();
  await page.locator(`[data-reorder-key="${boxes[toIndex].key}"]`).first().scrollIntoViewIfNeeded();
  boxes = await cardBoxes(page);
  const from = center(boxes[fromIndex]);
  const to = center(boxes[toIndex]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Flood pointermove events in a single call (many per frame) so reorder
  // updates interrupt the still-running 220ms FLIP animation.
  const legs = 3;
  for (let leg = 1; leg <= legs; leg += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * leg) / legs,
      from.y + ((to.y - from.y) * leg) / legs,
      { steps: 10 },
    );
    await expectGridOnlyCards(page);
    await expectCardsInsideGrid(page);
  }
  if (swingOut) {
    // Swing the pointer outside the grid (towards the sidebar / page top):
    // the ghost follows, but no grid card may follow it out.
    const out = await outsidePoint(page);
    await page.mouse.move(out.x, out.y, { steps: 10 });
    await expectGridOnlyCards(page);
    await expectCardsInsideGrid(page);
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expectGridOnlyCards(page);
    await expectCardsInsideGrid(page);
  }
  await page.mouse.up();
  await expectGridOnlyCards(page);
  await expectCardsInsideGrid(page);
}

test("rapid reorder keeps the grid consistent", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  await page.goto(`/category/${CATEGORY}`);
  await page.getByTitle("Trascina le card nella posizione desiderata").click();
  await expect(page.getByText("Fine riordino")).toBeVisible();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(7);

  const countBefore = await page.locator("[data-reorder-card]").count();

  // 20+ rapid drags back and forth, never waiting for animations to finish.
  const total = await page.locator("[data-reorder-card]").count();
  for (let i = 0; i < RAPID_DRAGS; i += 1) {
    const from = i % total;
    let to = (i * 3 + 2) % total;
    if (to === from) to = (to + 1) % total;
    await rapidDrag(page, from, to, i % 4 === 3);
  }

  // Let animations and saves settle.
  await page.waitForTimeout(SETTLE_MS);

  // No card lost.
  await expect(page.locator("[data-reorder-card]")).toHaveCount(countBefore);

  const boxes = await cardBoxes(page);
  const grid = await gridBox(page);

  // a) No two cards overlap once settled (no tolerance needed: 24px gaps).
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const interW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const interH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(
        interW <= 2 || interH <= 2,
        `cards overlap: ${a.key} vs ${b.key} (${Math.round(interW)}x${Math.round(interH)})`,
      ).toBe(true);
    }
  }

  // b) No empty slot: row-major visual order matches DOM order, rows filled
  // left to right, every card inside the grid.
  const domKeys = boxes.map((box) => box.key);
  const minH = Math.min(...boxes.map((box) => box.h));
  const byY = [...boxes].sort((a, b) => a.y - b.y);
  const rows: CardBox[][] = [];
  for (const box of byY) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - box.y) <= minH * 0.4);
    if (row) row.push(box);
    else rows.push([box]);
  }
  const visualKeys: string[] = [];
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].x > sorted[i - 1].x, "row not filled left to right").toBe(true);
    }
    visualKeys.push(...sorted.map((box) => box.key));
  }
  expect(visualKeys).toEqual(domKeys);
  for (const box of boxes) {
    expect(box.x >= grid.x - 8 && box.x + box.w <= grid.x + grid.width + 8).toBe(true);
    expect(box.y >= grid.y - 8 && box.y + box.h <= grid.y + grid.height + 8).toBe(true);
  }

  // c) Visual order persisted: wait until the server caught up, reload, compare.
  const expectedIds = domKeys.map((key) => Number(key.replace("video:", "")));
  await expect(async () => {
    const response = await page.request.get(`/api/categories/${CATEGORY}`);
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as {
      videos: { id: number }[];
    };
    expect(data.videos.map((video) => video.id)).toEqual(expectedIds);
  }).toPass({ timeout: 20000 });

  await page.reload();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(countBefore);
  const afterReload = await cardBoxes(page);
  expect(afterReload.map((box) => box.key)).toEqual(domKeys);

  await page.screenshot({
    path: `e2e/screenshots/reorder-${testInfo.project.name}-after-rapid.png`,
  });

  // e) No console errors.
  expect(consoleErrors).toEqual([]);
});
