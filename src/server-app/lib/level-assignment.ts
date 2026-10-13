// Pure level assignment logic for SkillTree. No DB imports.
//
// Given the videos of ONE playlist, decide which of the 4 levels each video
// belongs to. Rules:
//  - every video is assigned to at most one level (no duplicates, no gaps);
//  - if the videos carry reliable level signals (at least MIN_SIGNAL_VIDEOS
//    videos that are not the default "Beginner"), each video goes to its own
//    level; levels with no video stay empty and say so in `note`;
//  - otherwise the playlist is split into contiguous blocks in playlist order
//    (first block = Beginner ... last block = Expert), as evenly as possible.

export interface LevelAssignmentVideo {
  youtubeId: string;
  title: string;
  level?: string;
  durationSeconds?: number;
}

export interface LevelAssignmentResult {
  level: string;
  videos: LevelAssignmentVideo[];
  reusedPlaylist?: boolean;
  note?: string;
  playlistId?: string;
  playlistTitle?: string;
  channelName?: string;
  url?: string;
  videoCount: number;
}

export const LEVEL_NAMES = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

// Below this number of non-default-level videos the per-video levels are not
// trustworthy: levelFromText falls back to "Beginner" when it sees no signal.
const MIN_SIGNAL_VIDEOS = 3;
const DEFAULT_MAX_PER_LEVEL = 25;

/**
 * Contiguous, even split. Block sizes differ by at most 1 and the larger blocks
 * come first. Uses floor(total / levels) as the base size; the remainder is
 * handed out one video at a time to the first levels.
 */
export function splitPlaylistContiguous<T>(
  videos: T[],
  levelIndex: number,
  totalLevels: number,
): T[] {
  const total = videos.length;
  const base = Math.floor(total / totalLevels);
  const extras = total % totalLevels;
  const start = levelIndex * base + Math.min(levelIndex, extras);
  const count = base + (levelIndex < extras ? 1 : 0);
  return videos.slice(start, start + count);
}

export function assignLevelVideos(
  videos: LevelAssignmentVideo[],
  playlistId?: string,
  playlistTitle?: string,
  channelName?: string,
  url?: string,
  maxPerLevel: number = DEFAULT_MAX_PER_LEVEL,
): LevelAssignmentResult[] {
  // Remove repeated ids defensively, keep playlist order.
  const seenIds = new Set<string>();
  const unique = videos.filter((video) => {
    if (seenIds.has(video.youtubeId)) return false;
    seenIds.add(video.youtubeId);
    return true;
  });

  const signalVideos = unique.filter((video) => (video.level ?? "Beginner") !== "Beginner");
  const useOwnLevels = signalVideos.length >= MIN_SIGNAL_VIDEOS;

  return LEVEL_NAMES.map((level, levelIndex) => {
    const candidates = useOwnLevels
      ? unique.filter((video) => (video.level ?? "Beginner") === level)
      : splitPlaylistContiguous(unique, levelIndex, LEVEL_NAMES.length);

    const selected = candidates.slice(0, Math.max(1, maxPerLevel));

    let note: string | undefined;
    let reusedPlaylist = false;
    if (selected.length === 0) {
      note = `Nessun video distinto per il livello "${level}" in questa playlist.`;
    } else if (!useOwnLevels) {
      reusedPlaylist = true;
      note = `Playlist divisa in blocchi: il livello "${level}" usa una parte della stessa playlist.`;
    }
    if (selected.length < candidates.length) {
      const hidden = candidates.length - selected.length;
      note = `${note ? `${note} ` : ""}${hidden} video oltre il limite di ${maxPerLevel} non sono stati inclusi.`;
    }

    return {
      level,
      videos: selected,
      reusedPlaylist,
      note,
      playlistId,
      playlistTitle,
      channelName,
      url,
      videoCount: selected.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Plan used by the Learning Coach route.
//
// The route first picks ONE source playlist per level (it may pick the same
// playlist for several levels when YouTube offers nothing better). This
// function then decides which videos each level actually gets:
//  - a playlist used by a single level: that level gets its videos in playlist
//    order, up to `maxPerLevel`;
//  - a playlist shared by k levels: it is split into k contiguous, even blocks
//    assigned to those levels in level order;
//  - a video never ends up in two levels (first level in order wins).
// ---------------------------------------------------------------------------

export interface LevelSource<T extends LevelAssignmentVideo = LevelAssignmentVideo> {
  level: string;
  sourceId: string;
  videos: T[];
}

export interface PlannedLevel<T extends LevelAssignmentVideo = LevelAssignmentVideo> {
  level: string;
  sourceId: string;
  videos: T[];
  sharedWith: string[];
  note?: string;
}

const DEFAULT_PLAN_MAX_PER_LEVEL = 20;

export function planLevelAssignments<T extends LevelAssignmentVideo>(
  sources: LevelSource<T>[],
  maxPerLevel: number = DEFAULT_PLAN_MAX_PER_LEVEL,
): PlannedLevel<T>[] {
  const bySource = new Map<string, number[]>();
  sources.forEach((entry, index) => {
    bySource.set(entry.sourceId, [...(bySource.get(entry.sourceId) ?? []), index]);
  });

  const used = new Set<string>();
  const cap = Math.max(1, maxPerLevel);

  return sources.map((entry, index) => {
    const group = bySource.get(entry.sourceId) ?? [index];
    const position = group.indexOf(index);
    const sharedWith = group.filter((other) => other !== index).map((other) => sources[other].level);

    // Drop repeated ids inside the same playlist, keep playlist order.
    const seen = new Set<string>();
    const ordered = entry.videos.filter((video) => {
      if (seen.has(video.youtubeId)) return false;
      seen.add(video.youtubeId);
      return true;
    });

    const block = group.length === 1
      ? ordered
      : splitPlaylistContiguous(ordered, position, group.length);
    const fresh = block.filter((video) => !used.has(video.youtubeId));
    const selected = fresh.slice(0, cap);
    selected.forEach((video) => used.add(video.youtubeId));

    const notes: string[] = [];
    if (sharedWith.length > 0) {
      notes.push(`Playlist condivisa con ${sharedWith.join(", ")}: questo livello usa solo una parte dei video.`);
    }
    if (selected.length === 0) {
      notes.push(`Nessun video distinto trovato per il livello "${entry.level}".`);
    }
    if (fresh.length > selected.length) {
      notes.push(`${fresh.length - selected.length} video oltre il limite di ${cap} non sono stati inclusi.`);
    }

    return {
      level: entry.level,
      sourceId: entry.sourceId,
      videos: selected,
      sharedWith,
      note: notes.length ? notes.join(" ") : undefined,
    };
  });
}
