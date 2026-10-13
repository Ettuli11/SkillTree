import { describe, expect, it } from "vitest";
import {
  assignLevelVideos,
  splitPlaylistContiguous,
  type LevelAssignmentVideo,
} from "./level-assignment";

const make = (count: number, level = "Beginner"): LevelAssignmentVideo[] =>
  Array.from({ length: count }, (_, i) => ({ youtubeId: `v${i}`, title: `Video ${i}`, level }));

describe("splitPlaylistContiguous", () => {
  it("never loses or duplicates a video, and blocks differ by at most 1", () => {
    for (let total = 0; total <= 60; total += 1) {
      const videos = make(total);
      const blocks = [0, 1, 2, 3].map((i) => splitPlaylistContiguous(videos, i, 4));
      const flat = blocks.flat().map((v) => v.youtubeId);
      expect(flat).toEqual(videos.map((v) => v.youtubeId)); // order kept, nothing lost
      const sizes = blocks.map((b) => b.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });
});

describe("assignLevelVideos - playlist without level signals", () => {
  it.each([1, 2, 3, 4, 5, 7, 13, 15, 16, 22, 30, 41])("splits %i videos with no gaps", (total) => {
    const results = assignLevelVideos(make(total));
    expect(results.map((r) => r.level)).toEqual(["Beginner", "Intermediate", "Advanced", "Expert"]);
    expect(results.reduce((sum, r) => sum + r.videoCount, 0)).toBe(total);
    const ids = results.flatMap((r) => r.videos.map((v) => v.youtubeId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("populates every level when the playlist has at least 4 videos", () => {
    for (const total of [4, 5, 13, 15, 22]) {
      const results = assignLevelVideos(make(total));
      for (const r of results) expect(r.videoCount).toBeGreaterThan(0);
    }
  });

  it("fills the Expert level for 15 videos (regression)", () => {
    const results = assignLevelVideos(make(15));
    expect(results.map((r) => r.videoCount)).toEqual([4, 4, 4, 3]);
  });

  it("marks empty levels with a note instead of faking content", () => {
    const results = assignLevelVideos(make(2));
    expect(results[0].videoCount).toBe(1);
    expect(results[2].videoCount).toBe(0);
    expect(results[2].note).toBeTruthy();
  });
});

describe("assignLevelVideos - playlist with real level signals", () => {
  const mixed: LevelAssignmentVideo[] = [
    ...make(4, "Beginner").map((v, i) => ({ ...v, youtubeId: `b${i}` })),
    ...make(3, "Intermediate").map((v, i) => ({ ...v, youtubeId: `i${i}` })),
    ...make(2, "Advanced").map((v, i) => ({ ...v, youtubeId: `a${i}` })),
    ...make(2, "Expert").map((v, i) => ({ ...v, youtubeId: `e${i}` })),
  ];

  it("keeps each video in its own level exactly once", () => {
    const results = assignLevelVideos(mixed);
    expect(results.map((r) => r.videoCount)).toEqual([4, 3, 2, 2]);
    const ids = results.flatMap((r) => r.videos.map((v) => v.youtubeId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(mixed.length);
  });

  it("does not borrow videos for an empty level", () => {
    const onlyBeginnerAndExpert = [...make(5, "Beginner"), ...make(3, "Expert").map((v, i) => ({ ...v, youtubeId: `e${i}` }))];
    const results = assignLevelVideos(onlyBeginnerAndExpert);
    // Only 3 non-default videos => signal is reliable, Intermediate stays empty.
    expect(results[1].videoCount).toBe(0);
    expect(results[1].note).toBeTruthy();
  });

  it("falls back to an even split when almost all videos look like Beginner", () => {
    const fewSignals = [...make(10, "Beginner"), ...make(2, "Advanced").map((v, i) => ({ ...v, youtubeId: `a${i}` }))];
    const results = assignLevelVideos(fewSignals);
    expect(results.every((r) => r.videoCount > 0)).toBe(true);
    expect(results.reduce((s, r) => s + r.videoCount, 0)).toBe(fewSignals.length);
  });
});

describe("assignLevelVideos - limits", () => {
  it("respects maxPerLevel and says how many were left out", () => {
    const results = assignLevelVideos(make(100), undefined, undefined, undefined, undefined, 10);
    for (const r of results) expect(r.videoCount).toBe(10);
    expect(results[0].note).toMatch(/15 video/);
  });
});

import { planLevelAssignments } from "./level-assignment";

describe("planLevelAssignments", () => {
  const vids = (prefix: string, n: number): LevelAssignmentVideo[] =>
    Array.from({ length: n }, (_, i) => ({ youtubeId: `${prefix}${i}`, title: `${prefix} ${i}` }));
  const LV = ["Beginner", "Intermediate", "Advanced", "Expert"];

  it("gives each level its own playlist in full (up to the cap)", () => {
    const plan = planLevelAssignments(LV.map((level, i) => ({ level, sourceId: `p${i}`, videos: vids(`p${i}-`, 15) })));
    expect(plan.map((p) => p.videos.length)).toEqual([15, 15, 15, 15]);
    expect(plan.every((p) => p.sharedWith.length === 0 && !p.note)).toBe(true);
  });

  it("does not shrink a level because of an unrelated playlist", () => {
    const plan = planLevelAssignments([
      { level: "Beginner", sourceId: "a", videos: vids("a", 30) },
      { level: "Expert", sourceId: "b", videos: vids("b", 15) },
    ]);
    expect(plan[0].videos.length).toBe(20);
    expect(plan[0].note).toMatch(/10 video/);
    expect(plan[1].videos.length).toBe(15);
  });

  it("splits a playlist shared by two levels into two contiguous halves", () => {
    const plan = planLevelAssignments([
      { level: "Intermediate", sourceId: "x", videos: vids("x", 16) },
      { level: "Expert", sourceId: "x", videos: vids("x", 16) },
    ]);
    expect(plan[0].videos.map((v) => v.youtubeId)).toEqual(vids("x", 16).slice(0, 8).map((v) => v.youtubeId));
    expect(plan[1].videos.map((v) => v.youtubeId)).toEqual(vids("x", 16).slice(8).map((v) => v.youtubeId));
    expect(plan[0].sharedWith).toEqual(["Expert"]);
    expect(plan[1].note).toMatch(/condivisa/);
  });

  it("never puts the same video in two levels, even across playlists", () => {
    const shared = vids("s", 5);
    const plan = planLevelAssignments([
      { level: "Beginner", sourceId: "a", videos: [...shared, ...vids("a", 3)] },
      { level: "Intermediate", sourceId: "b", videos: [...shared, ...vids("b", 3)] },
    ]);
    const ids = plan.flatMap((p) => p.videos.map((v) => v.youtubeId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("flags an empty level instead of faking content", () => {
    const plan = planLevelAssignments([{ level: "Beginner", sourceId: "a", videos: [] }]);
    expect(plan[0].videos).toEqual([]);
    expect(plan[0].note).toMatch(/Nessun video/);
  });
});
