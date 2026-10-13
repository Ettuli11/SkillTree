import { test, expect } from "@playwright/test";

// Card titles must not carry a native title attribute (browser tooltip):
// the full text is already visible (or expands on hover). Icon-only controls
// and toolbar buttons keep theirs.
test("card titles have no native tooltip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "tooltips are a desktop hover behavior");
  test.setTimeout(120000);

  await page.goto("/category/Blender");
  await expect(page.locator("[data-reorder-card]").first()).toBeVisible();
  await expect(page.locator("[data-reorder-card] h4[title]")).toHaveCount(0);

  // Same for playlist cards (reorder mode groups them).
  await page.goto("/category/Roblox Studio");
  await page.getByTitle("Trascina le card nella posizione desiderata").click();
  await expect(page.getByText("Fine riordino")).toBeVisible();
  await expect(page.locator("[data-reorder-card] h4[title]")).toHaveCount(0);

  // Essential ones stay: the reorder toolbar button keeps its title.
  await expect(page.getByTitle("Trascina le card nella posizione desiderata")).toBeVisible();
});
