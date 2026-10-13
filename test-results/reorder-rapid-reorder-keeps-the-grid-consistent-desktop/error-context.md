# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reorder.spec.ts >> rapid reorder keeps the grid consistent
- Location: e2e\reorder.spec.ts:120:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Permissions policy violation: compute-pressure is not allowed in this document.",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - generic [ref=f3e2]:
    - complementary [ref=f3e3]:
      - generic [ref=f3e4]:
        - button "Vai alla Dashboard" [ref=f3e5]:
          - generic [ref=f3e8]: SkillTree
        - button "Switch to light mode" [ref=f3e9]
      - navigation [ref=f3e16]:
        - generic [ref=f3e18]:
          - button "Dashboard" [ref=f3e19]
          - button "Import Content" [ref=f3e25]
          - button "Favorites" [ref=f3e28]
          - button "Learning Coach" [ref=f3e32]
          - button "Archived" [ref=f3e36]
        - generic [ref=f3e40]:
          - heading "Skill Tracks" [level=3] [ref=f3e41]
          - generic [ref=f3e42]:
            - button "Blender" [ref=f3e44]
            - button "Roblox Studio" [ref=f3e56]
            - button "C++ — Complete Path" [ref=f3e66]
            - button "C# — Complete Path" [ref=f3e78]
    - main [ref=f3e89]:
      - generic [ref=f3e91]:
        - link "Back to Dashboard" [ref=f3e92] [cursor=pointer]:
          - /url: /
        - generic [ref=f3e96]:
          - generic [ref=f3e97]:
            - generic [ref=f3e98]: Skill Track
            - heading "Blender" [level=1] [ref=f3e99]
            - generic [ref=f3e100]:
              - generic [ref=f3e101]: 7 videos
              - generic [ref=f3e105]: 0 completed
              - generic [ref=f3e107]: 7 remaining
            - button "Continue Learning" [ref=f3e109]
          - generic [ref=f3e110]:
            - generic [ref=f3e111]:
              - generic [ref=f3e112]: Mastery
              - generic [ref=f3e113]: 0%
            - progressbar [ref=f3e114]
            - generic [ref=f3e116]:
              - generic [ref=f3e117]: Novice
              - generic [ref=f3e118]: Expert
        - generic [ref=f3e119]:
          - generic [ref=f3e122]:
            - tablist [ref=f3e123]:
              - tab "All" [selected] [ref=f3e124]
              - tab "Beginner" [ref=f3e125]
              - tab "Intermediate" [ref=f3e126]
              - tab "Advanced" [ref=f3e127]
              - tab "Expert" [ref=f3e128]
            - generic [ref=f3e130]:
              - button "Attiva la selezione" [ref=f3e131]
              - button "Riordina" [ref=f3e132]
              - link "Importa traccia" [ref=f3e133] [cursor=pointer]:
                - /url: /add?category=Blender
              - button "Inverti l'ordine dei video" [ref=f3e135]:
                - generic: Inverti ordine
          - tabpanel "All" [ref=f3e136]:
            - generic [ref=f3e138]:
              - button "Watch Blender 5 Beginner Tutorial - Part 7 - Industrial Lighting Setup" [ref=f3e139] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 7 - Industrial Lighting Setup" [ref=f3e141]
                - generic [ref=f3e142]:
                  - heading "Blender 5 Beginner Tutorial - Part 7 - Industrial Lighting Setup" [level=4] [ref=f3e143]
                  - paragraph [ref=f3e144]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 9- Water Puddles" [ref=f3e145] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 9- Water Puddles" [ref=f3e147]
                - generic [ref=f3e148]:
                  - heading "Blender 5 Beginner Tutorial - Part 9- Water Puddles" [level=4] [ref=f3e149]
                  - paragraph [ref=f3e150]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 5 - Creating Roof Beams" [ref=f3e151] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 5 - Creating Roof Beams" [ref=f3e153]
                - generic [ref=f3e154]:
                  - heading "Blender 5 Beginner Tutorial - Part 5 - Creating Roof Beams" [level=4] [ref=f3e155]
                  - paragraph [ref=f3e156]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 11 - Shelves and light setup" [ref=f3e157] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 11 - Shelves and light setup" [ref=f3e159]
                - generic [ref=f3e160]:
                  - heading "Blender 5 Beginner Tutorial - Part 11 - Shelves and light setup" [level=4] [ref=f3e161]
                  - paragraph [ref=f3e162]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 8- Making Doors" [ref=f3e163] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 8- Making Doors" [ref=f3e165]
                - generic [ref=f3e166]:
                  - heading "Blender 5 Beginner Tutorial - Part 8- Making Doors" [level=4] [ref=f3e167]
                  - paragraph [ref=f3e168]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 13 - Small Props" [ref=f3e169] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 13 - Small Props" [ref=f3e171]
                - generic [ref=f3e172]:
                  - heading "Blender 5 Beginner Tutorial - Part 13 - Small Props" [level=4] [ref=f3e173]
                  - paragraph [ref=f3e174]: Rob Tuytel
              - button "Watch Blender 5 Beginner Tutorial - Part 6 - Building Factory Pillars" [ref=f3e175] [cursor=pointer]:
                - img "Blender 5 Beginner Tutorial - Part 6 - Building Factory Pillars" [ref=f3e177]
                - generic [ref=f3e178]:
                  - heading "Blender 5 Beginner Tutorial - Part 6 - Building Factory Pillars" [level=4] [ref=f3e179]
                  - paragraph [ref=f3e180]: Rob Tuytel
  - region "Notifications alt+T"
```

# Test source

```ts
  115 |   await page.mouse.up();
  116 |   await expectGridOnlyCards(page);
  117 |   await expectCardsInsideGrid(page);
  118 | }
  119 | 
  120 | test("rapid reorder keeps the grid consistent", async ({ page }, testInfo) => {
  121 |   test.setTimeout(120000);
  122 |   const consoleErrors: string[] = [];
  123 |   page.on("console", (message) => {
  124 |     if (message.type() === "error") consoleErrors.push(message.text());
  125 |   });
  126 |   page.on("pageerror", (error) => {
  127 |     consoleErrors.push(`pageerror: ${error.message}`);
  128 |   });
  129 | 
  130 |   await page.goto(`/category/${CATEGORY}`);
  131 |   await page.getByTitle("Trascina le card nella posizione desiderata").click();
  132 |   await expect(page.getByText("Fine riordino")).toBeVisible();
  133 |   await expect(page.locator("[data-reorder-card]")).toHaveCount(7);
  134 | 
  135 |   const countBefore = await page.locator("[data-reorder-card]").count();
  136 | 
  137 |   // 20+ rapid drags back and forth, never waiting for animations to finish.
  138 |   const total = await page.locator("[data-reorder-card]").count();
  139 |   for (let i = 0; i < RAPID_DRAGS; i += 1) {
  140 |     const from = i % total;
  141 |     let to = (i * 3 + 2) % total;
  142 |     if (to === from) to = (to + 1) % total;
  143 |     await rapidDrag(page, from, to, i % 4 === 3);
  144 |   }
  145 | 
  146 |   // Let animations and saves settle.
  147 |   await page.waitForTimeout(SETTLE_MS);
  148 | 
  149 |   // No card lost.
  150 |   await expect(page.locator("[data-reorder-card]")).toHaveCount(countBefore);
  151 | 
  152 |   const boxes = await cardBoxes(page);
  153 |   const grid = await gridBox(page);
  154 | 
  155 |   // a) No two cards overlap once settled (no tolerance needed: 24px gaps).
  156 |   for (let i = 0; i < boxes.length; i += 1) {
  157 |     for (let j = i + 1; j < boxes.length; j += 1) {
  158 |       const a = boxes[i];
  159 |       const b = boxes[j];
  160 |       const interW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  161 |       const interH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  162 |       expect(
  163 |         interW <= 2 || interH <= 2,
  164 |         `cards overlap: ${a.key} vs ${b.key} (${Math.round(interW)}x${Math.round(interH)})`,
  165 |       ).toBe(true);
  166 |     }
  167 |   }
  168 | 
  169 |   // b) No empty slot: row-major visual order matches DOM order, rows filled
  170 |   // left to right, every card inside the grid.
  171 |   const domKeys = boxes.map((box) => box.key);
  172 |   const minH = Math.min(...boxes.map((box) => box.h));
  173 |   const byY = [...boxes].sort((a, b) => a.y - b.y);
  174 |   const rows: CardBox[][] = [];
  175 |   for (const box of byY) {
  176 |     const row = rows.find((candidate) => Math.abs(candidate[0].y - box.y) <= minH * 0.4);
  177 |     if (row) row.push(box);
  178 |     else rows.push([box]);
  179 |   }
  180 |   const visualKeys: string[] = [];
  181 |   for (const row of rows) {
  182 |     const sorted = [...row].sort((a, b) => a.x - b.x);
  183 |     for (let i = 1; i < sorted.length; i += 1) {
  184 |       expect(sorted[i].x > sorted[i - 1].x, "row not filled left to right").toBe(true);
  185 |     }
  186 |     visualKeys.push(...sorted.map((box) => box.key));
  187 |   }
  188 |   expect(visualKeys).toEqual(domKeys);
  189 |   for (const box of boxes) {
  190 |     expect(box.x >= grid.x - 8 && box.x + box.w <= grid.x + grid.width + 8).toBe(true);
  191 |     expect(box.y >= grid.y - 8 && box.y + box.h <= grid.y + grid.height + 8).toBe(true);
  192 |   }
  193 | 
  194 |   // c) Visual order persisted: wait until the server caught up, reload, compare.
  195 |   const expectedIds = domKeys.map((key) => Number(key.replace("video:", "")));
  196 |   await expect(async () => {
  197 |     const response = await page.request.get(`/api/categories/${CATEGORY}`);
  198 |     expect(response.ok()).toBe(true);
  199 |     const data = (await response.json()) as {
  200 |       videos: { id: number }[];
  201 |     };
  202 |     expect(data.videos.map((video) => video.id)).toEqual(expectedIds);
  203 |   }).toPass({ timeout: 20000 });
  204 | 
  205 |   await page.reload();
  206 |   await expect(page.locator("[data-reorder-card]")).toHaveCount(countBefore);
  207 |   const afterReload = await cardBoxes(page);
  208 |   expect(afterReload.map((box) => box.key)).toEqual(domKeys);
  209 | 
  210 |   await page.screenshot({
  211 |     path: `e2e/screenshots/reorder-${testInfo.project.name}-after-rapid.png`,
  212 |   });
  213 | 
  214 |   // e) No console errors.
> 215 |   expect(consoleErrors).toEqual([]);
      |                         ^ Error: expect(received).toEqual(expected) // deep equality
  216 | });
  217 | 
```