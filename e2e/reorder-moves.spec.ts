import { test, expect, type Page } from "@playwright/test";

const CATEGORY = "Blender";
const SETTLE_MS = 2500;

type CardBox = { key: string; x: number; y: number; w: number; h: number };

async function cardKeys(page: Page): Promise<string[]> {
  return page
    .locator("[data-reorder-card]")
    .evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.reorderKey ?? ""));
}

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

function center(box: CardBox) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

async function gridBox(page: Page) {
  const box = await page.locator("div.grid:has([data-reorder-card])").first().boundingBox();
  if (!box) throw new Error("reorder grid not found");
  return box;
}

async function scrollTop(page: Page) {
  return page
    .locator("[data-app-scroll-container]")
    .evaluate((el) => (el as HTMLElement).scrollTop);
}

async function visibleCount(page: Page) {
  return page.locator("[data-reorder-card]").evaluateAll(
    (cards) =>
      cards.filter((card) => {
        const rect = (card as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
  );
}

async function serverVideoIds(page: Page): Promise<number[]> {
  const response = await page.request.get(`/api/categories/${CATEGORY}`);
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as { videos: { id: number }[] };
  return data.videos.map((video) => video.id);
}

async function expectServerOrder(page: Page, keys: string[]) {
  const expectedIds = keys.map((key) => Number(key.replace("video:", "")));
  // Saves are serialized in the background; under load (rapid drops, Neon
  // cold start) the last one can take tens of seconds. A persistent mismatch
  // after 60s is a real divergence, not latency.
  await expect(async () => {
    expect(await serverVideoIds(page)).toEqual(expectedIds);
  }).toPass({ timeout: 60000 });
}

async function openReorder(page: Page, count: number) {
  await page.goto(`/category/${CATEGORY}`);
  await page.getByTitle("Trascina le card nella posizione desiderata").click();
  await expect(page.getByText("Fine riordino")).toBeVisible();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(count);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

// Drag card at fromIndex onto the card at toIndex. Slow drags pause between
// legs so hover previews and FLIP animations interleave; fast drags flood all
// pointermoves at once so updates interrupt running animations.
// Center the midpoint between two cards vertically in the viewport (clear of
// the sticky toolbar). Centering each card in turn would push the other one
// away again, so a single scroll serves both drag endpoints.
async function centerBetweenCards(page: Page, keyA: string, keyB: string) {
  await page
    .locator(`[data-reorder-key="${keyA}"]`)
    .first()
    .evaluate((el, otherKey) => {
      const other = document.querySelector(
        `[data-reorder-key="${otherKey}"]`,
      ) as HTMLElement | null;
      if (!other) return;
      const ra = (el as HTMLElement).getBoundingClientRect();
      const rb = other.getBoundingClientRect();
      const midY = (ra.top + ra.height / 2 + rb.top + rb.height / 2) / 2;
      const container = el.closest("[data-app-scroll-container]") as HTMLElement | null;
      const delta = midY - window.innerHeight / 2;
      if (container) container.scrollTop += delta;
      else window.scrollBy(0, delta);
    }, keyB);
}

async function singleStepDrag(page: Page, fromIndex: number, toIndex: number, slow: boolean) {
  let boxes = await cardBoxes(page);
  await centerBetweenCards(page, boxes[fromIndex].key, boxes[toIndex].key);
  boxes = await cardBoxes(page);
  const from = center(boxes[fromIndex]);
  const to = center(boxes[toIndex]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (slow) {
    for (let leg = 1; leg <= 4; leg += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * leg) / 4,
        from.y + ((to.y - from.y) * leg) / 4,
      );
      await page.waitForTimeout(150);
    }
  } else {
    await page.mouse.move(to.x, to.y, { steps: 12 });
  }
  await page.mouse.up();
  await page.waitForTimeout(450);
}

// Deterministic pseudo-random sequence (reproducible runs).
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("single-step moves land exactly one slot away", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const consoleErrors = collectConsoleErrors(page);
  const isMobile = testInfo.project.name === "mobile";
  await openReorder(page, 7);

  // a) Right by 1 then left by 1 returns to the start, plus the
  // sweep-past-and-back release that used to land one slot off.
  let keys = await cardKeys(page);
  const first = keys[0];
  await singleStepDrag(page, 0, 1, true);
  keys = await cardKeys(page);
  expect(keys.indexOf(first)).toBe(1);
  await singleStepDrag(page, 1, 0, true);
  keys = await cardKeys(page);
  expect(keys.indexOf(first)).toBe(0);

  // Sweep past the target and whip back mid-flight: the release point is
  // ambiguous while cards are still animating, so assert the strong
  // invariant instead of an exact slot — no silent divergence: the DOM must
  // converge with the saved order, and a reload must show the same order.
  // (Deliberate slow drags below assert exact slots.)
  {
    let boxes = await cardBoxes(page);
    await centerBetweenCards(page, boxes[0].key, boxes[2].key);
    boxes = await cardBoxes(page);
    const a = center(boxes[0]);
    const b = center(boxes[1]);
    const c = center(boxes[2]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y, { steps: 8 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const swept = await cardKeys(page);
    await expectServerOrder(page, swept);
    await page.reload();
    await expect(page.locator("[data-reorder-card]")).toHaveCount(swept.length);
    expect(await cardKeys(page)).toEqual(swept);
    // Reload exits reorder mode; re-enter it for the sequence below.
    await page.getByTitle("Trascina le card nella posizione desiderata").click();
    await expect(page.getByText("Fine riordino")).toBeVisible();
    // restore `first` to the front with a deliberate slow move (exact).
    keys = await cardKeys(page);
    const idx = keys.indexOf(first);
    await singleStepDrag(page, idx, 0, true);
    keys = await cardKeys(page);
    expect(keys.indexOf(first)).toBe(0);
    await expectServerOrder(page, keys);
  }

  // b) 20 random single-step moves, alternating fast and slow. On a 1-column
  // mobile grid only vertical (up/down) neighbors exist; desktop covers all
  // four directions.
  const random = mulberry32(20261010);
  const moves: Array<{ from: number; to: number; slow: boolean }> = [];
  {
    const total = (await cardKeys(page)).length;
    const cols = isMobile ? 1 : 4;
    let guard = 0;
    while (moves.length < 20 && guard < 500) {
      guard += 1;
      const from = Math.floor(random() * total);
      const options: number[] = [];
      if (from + 1 < total && (isMobile || (from + 1) % cols !== 0)) options.push(from + 1);
      if (from - 1 >= 0 && (isMobile || from % cols !== 0)) options.push(from - 1);
      if (!isMobile && from + cols < total) options.push(from + cols);
      if (!isMobile && from - cols >= 0) options.push(from - cols);
      if (options.length === 0) continue;
      moves.push({
        from,
        to: options[Math.floor(random() * options.length)],
        slow: moves.length % 2 === 0,
      });
    }
  }
  for (const [i, move] of moves.entries()) {
    const before = await cardKeys(page);
    // Start every measured move from a server-synced state so a still
    // in-flight save from the previous drop cannot shift indices mid-drag.
    await expectServerOrder(page, before);
    const movedKey = before[move.from];
    await singleStepDrag(page, move.from, move.to, move.slow);
    const after = await cardKeys(page);
    expect(
      after,
      `move ${i} (${move.slow ? "slow" : "fast"}) ${movedKey} ${move.from}->${move.to}`,
    ).toEqual(
      (() => {
        const expected = [...before];
        const [card] = expected.splice(move.from, 1);
        expected.splice(move.to, 0, card);
        return expected;
      })(),
    );
    expect(after.indexOf(movedKey)).toBe(move.to);
  }

  // d) DOM order equals saved order, also after reload.
  const domKeys = await cardKeys(page);
  await expectServerOrder(page, domKeys);
  await page.reload();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(domKeys.length);
  expect(await cardKeys(page)).toEqual(domKeys);

  await page.screenshot({
    path: `e2e/screenshots/reorder-moves-${testInfo.project.name}-moves.png`,
  });
  expect(consoleErrors).toEqual([]);
});

test("upward cross-row drag keeps scroll and grid", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const consoleErrors = collectConsoleErrors(page);
  await openReorder(page, 7);
  const total = (await cardKeys(page)).length;

  // Center the midpoint between source and target so both endpoints are
  // visible and clear of the sticky toolbar (hit-testing). The drag itself
  // must not move the scroll (asserted below).
  {
    const keys = await cardKeys(page);
    const toKey = testInfo.project.name === "mobile" ? keys[total - 3] : keys[1];
    await centerBetweenCards(page, keys[total - 2], toKey);
  }
  await page.waitForTimeout(300);
  const scrollBefore = await scrollTop(page);

  // Drag a second-row card up into the first row, sampling scroll and count.
  // On the 1-column mobile grid every move crosses a row boundary, so the
  // neighbor above is enough to stay in viewport.
  const from = total - 2;
  const to = testInfo.project.name === "mobile" ? from - 1 : 1;
  const boxes = await cardBoxes(page);
  const a = center(boxes[from]);
  const b = center(boxes[to]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let leg = 1; leg <= 6; leg += 1) {
    await page.mouse.move(a.x + ((b.x - a.x) * leg) / 6, a.y + ((b.y - a.y) * leg) / 6, {
      steps: 6,
    });
    // c) scroll stable within 2px, no card disappears mid-drag.
    expect(Math.abs((await scrollTop(page)) - scrollBefore)).toBeLessThanOrEqual(2);
    expect(await visibleCount(page)).toBe(total);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(Math.abs((await scrollTop(page)) - scrollBefore)).toBeLessThanOrEqual(2);
  expect(await visibleCount(page)).toBe(total);

  // The moved card changed index by exactly the expected amount.
  const after = await cardKeys(page);
  const beforeKeys = boxes.map((box) => box.key);
  const draggedKey = beforeKeys[from];
  const expected = [...beforeKeys];
  const [card] = expected.splice(from, 1);
  expected.splice(to, 0, card);
  expect(after).toEqual(expected);
  expect(after.indexOf(draggedKey)).toBe(to);

  // d) Settled: no overlaps, slots filled, matches saved order after reload.
  await page.waitForTimeout(SETTLE_MS);
  const settled = await cardBoxes(page);
  for (let i = 0; i < settled.length; i += 1) {
    for (let j = i + 1; j < settled.length; j += 1) {
      const x = settled[i];
      const y = settled[j];
      const iw = Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x);
      const ih = Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y);
      expect(iw <= 2 || ih <= 2, `cards overlap: ${x.key} vs ${y.key}`).toBe(true);
    }
  }
  await expectServerOrder(page, after);
  await page.reload();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(after.length);
  expect(await cardKeys(page)).toEqual(after);

  await page.screenshot({
    path: `e2e/screenshots/reorder-moves-${testInfo.project.name}-upward.png`,
  });
  expect(consoleErrors).toEqual([]);
});

test("release during flight keeps the layout slot", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const consoleErrors = collectConsoleErrors(page);
  await openReorder(page, 7);

  // Drag card 0 onto card 1, then release immediately once the preview
  // flips — while the previous hover's 220ms animation is still running and
  // the evicted card is gliding through the release point. The drop must
  // resolve against the stable layout slot (card stays at index 1), not
  // against the card merely passing through (which would fling it back).
  let boxes = await cardBoxes(page);
  await centerBetweenCards(page, boxes[0].key, boxes[1].key);
  boxes = await cardBoxes(page);
  const before = boxes.map((box) => box.key);
  const draggedKey = before[0];
  const from = center(boxes[0]);
  const to = center(boxes[1]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // Wait for the hover preview to land in the DOM, then release at once
  // without moving further: the animation is still in flight.
  for (let i = 0; i < 400; i += 1) {
    const keys = await cardKeys(page);
    if (keys.indexOf(draggedKey) === 1) break;
    await page.waitForTimeout(5);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await cardKeys(page);
  expect(after.indexOf(draggedKey)).toBe(1);
  await expectServerOrder(page, after);
  await page.reload();
  await expect(page.locator("[data-reorder-card]")).toHaveCount(after.length);
  expect(await cardKeys(page)).toEqual(after);

  await page.screenshot({
    path: `e2e/screenshots/reorder-moves-${testInfo.project.name}-flight.png`,
  });
  expect(consoleErrors).toEqual([]);
});

test("undo restores the previous order", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = collectConsoleErrors(page);
  await openReorder(page, 7);

  const before = await cardKeys(page);
  const movedKey = before[2];
  await singleStepDrag(page, 2, 3, true);
  const afterMove = await cardKeys(page);
  expect(afterMove.indexOf(movedKey)).toBe(3);
  // Wait for the save to land: undo silently returns while a save is pending.
  await expectServerOrder(page, afterMove);

  await page.keyboard.press("Control+z");
  await expect(page.getByText("Ultimo spostamento annullato")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(600);
  const afterUndo = await cardKeys(page);
  expect(afterUndo).toEqual(before);
  await expectServerOrder(page, before);
  expect(consoleErrors).toEqual([]);
});

// Inside ONE gesture: right one slot (the preview flips), then back over the
// slot just left, then release. The card must end exactly one slot to the
// LEFT of where it started — not two. Regression guard: the hover that
// returns the card over the slot it had just left used to be dropped as a
// repeat of the same target key, so the preview kept the rightward position
// and the drop committed one slot too far.
//
// Desktop only: the reported path is horizontal (right, then back left) and
// needs three cards of one row on screen together. Mobile is a single column
// where that geometry does not exist; the 20-random-move test above already
// covers its vertical neighbours.
test("right-then-left inside one gesture moves exactly one slot", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  test.skip(testInfo.project.name === "mobile", "horizontal right-then-left path is desktop-only");
  const consoleErrors = collectConsoleErrors(page);
  await openReorder(page, 7);

  const before = await cardKeys(page);
  const draggedKey = before[2];

  // Keep source, its left neighbour and its right neighbour on screen
  // together (clear of the sticky toolbar) with a single scroll.
  let boxes = await cardBoxes(page);
  await centerBetweenCards(page, boxes[1].key, boxes[3].key);
  boxes = await cardBoxes(page);
  const left = center(boxes[1]);
  const origin = center(boxes[2]);
  const right = center(boxes[3]);

  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  // Right one slot, let the preview land...
  await page.mouse.move(right.x, right.y, { steps: 6 });
  await page.waitForTimeout(200);
  // ...then back over the slot we just left and out to the left neighbour.
  await page.mouse.move(origin.x, origin.y, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.move(left.x, left.y, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(600);

  const after = await cardKeys(page);
  expect(after.indexOf(draggedKey), "moved card lands one slot left, not two").toBe(1);
  await expectServerOrder(page, after);

  // And the same gesture released back on the origin slot is a no-op.
  const beforeSecond = await cardKeys(page);
  const second = beforeSecond[1];
  boxes = await cardBoxes(page);
  await centerBetweenCards(page, boxes[0].key, boxes[2].key);
  boxes = await cardBoxes(page);
  const secondOrigin = center(boxes[1]);
  const secondRight = center(boxes[2]);
  await page.mouse.move(secondOrigin.x, secondOrigin.y);
  await page.mouse.down();
  await page.mouse.move(secondRight.x, secondRight.y, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.move(secondOrigin.x, secondOrigin.y, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const afterSecond = await cardKeys(page);
  expect(afterSecond.indexOf(second), "release over the origin slot keeps the slot").toBe(1);
  await expectServerOrder(page, afterSecond);

  await page.screenshot({
    path: `e2e/screenshots/reorder-moves-${testInfo.project.name}-back-left.png`,
  });
  expect(consoleErrors).toEqual([]);
});
