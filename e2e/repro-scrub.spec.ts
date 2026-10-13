import { test } from "@playwright/test";

test("debug scrub mobile2", async ({ page }) => {
  page.on("console", (m) => {
    if (m.text().startsWith("[dbg-scrub]")) console.log(m.text());
  });
  await page.goto("/category/Blender");
  await page.locator('[role="tablist"]').evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("[data-level-tab]")].map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { k: (el as HTMLElement).dataset.levelTab, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
    });
    const list = document.querySelector('[role="tablist"]') as HTMLElement | null;
    const lr = list?.getBoundingClientRect();
    return {
      tabs,
      list: lr ? { x: Math.round(lr.left), w: Math.round(lr.width), sl: list?.scrollLeft } : null,
      innerW: window.innerWidth,
    };
  });
  console.log("INFO " + JSON.stringify(info));
  const a = info.tabs[0];
  const b = info.tabs[1];
  const from = { x: a.x + a.w / 2, y: 0 };
  const to = { x: b.x + b.w / 2, y: 0 };
  const midY: number = await page
    .locator("[data-level-tab]")
    .first()
    .evaluate((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.top + r.height / 2;
    });
  const under = await page.evaluate(
    ({ x, y }: { x: number; y: number }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.tagName + "|" + (el?.textContent ?? "").trim().slice(0, 15) + "|tab=" + el?.closest?.("[data-level-tab]")?.getAttribute("data-level-tab");
    },
    { x: from.x, y: midY },
  );
  console.log("FROM " + JSON.stringify(from) + " UNDER-FROM " + under);
  await page.mouse.move(from.x, midY);
  await page.mouse.down();
  await page.mouse.move(to.x, midY, { steps: 12 });
  await page.mouse.up();
  const state = await page.evaluate(
    () => document.querySelector('[data-level-tab="Beginner"]')?.getAttribute("data-state"),
  );
  console.log("BEGINNER-STATE " + state);
});
