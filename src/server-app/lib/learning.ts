import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { appStateTable, db, categoriesTable, videosTable, type Category, type Video } from "@workspace/db";
import { logger } from "./logger";

export const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;
export type SkillLevel = (typeof LEVELS)[number];
export const COMPLETION_THRESHOLD = 0.90;

let seedPromise: Promise<void> | undefined;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedDatabase().catch((error) => {
      seedPromise = undefined;
      throw error;
    });
  }
  return seedPromise;
}

async function seedDatabase(): Promise<void> {
  const [seedState] = await db
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, "initial_seed_complete"));

  if (seedState) return;

  // Existing data means this database has already been used. Mark the legacy
  // demo seed as complete without recreating or changing any user skill.
  const existingCategories = await db.select({ id: categoriesTable.id }).from(categoriesTable).limit(1);
  if (existingCategories.length > 0) {
    await db.insert(appStateTable)
      .values({ key: "initial_seed_complete", value: "true" })
      .onConflictDoNothing({ target: appStateTable.key });
    return;
  }

  // New databases intentionally start empty. Blender remains available as
  // legacy demo content in databases that already had it, but it must never
  // come back after a user deletes their last skill.
  await db.insert(appStateTable)
    .values({ key: "initial_seed_complete", value: "true" })
    .onConflictDoNothing({ target: appStateTable.key });
  logger.info("No demo skill seed required; waiting for the user to import a skill.");
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function levelFromText(title: string, description: string, sourceName = ""): SkillLevel {
  // Normalize accents and punctuation so "facile", "fácil" and "facile!"
  // can be compared with the same vocabulary. Keeping the fields separate is
  // intentional: a difficulty phrase in the title is stronger than one in a
  // generic channel or playlist name.
  const normalize = (value: string) => value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleText = normalize(title);
  const descriptionText = normalize(description);
  const sourceText = normalize(sourceName);
  const fields = [
    { text: titleText, weight: 3 },
    { text: descriptionText, weight: 1 },
    { text: sourceText, weight: 1 },
  ];

  const containsTerm = (text: string, term: string) => {
    const normalizedTerm = normalize(term);
    if (!normalizedTerm) return false;
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").test(text);
  };
  // Ambiguous single words must not decide the level on their own. They only
  // contribute when an explicit level signal is present nearby in the same field.
  const ambiguousTerms = ["pro", "pros", "mid", "normal", "standard", "average", "averange", "simple", "part 1", "medium", "new"];
  const explicitSignals = ["beginner", "intermediate", "advanced", "expert", "novice", "principiante", "facile", "principianti", "avanzato", "avancado", "experto", "difícil", "dificil", "master", "masterclass", "professional", "professionals", "pro level", "pro workflow", "level 1", "level 2", "level 3", "level 4", "level 5", "livello 1", "livello 2", "livello 3", "livello 4", "livello 5", "niveau 1", "niveau 2", "niveau 3", "niveau 4", "niveau 5", "nivel 1", "nivel 2", "nivel 3", "nivel 4", "nivel 5", "mid level", "debutant", "debutante", "anfanger", "iniciante", "elementare", "bassa difficolta", "base", "basi"];
  const scoreTerms = (terms: string[], score: number) => terms.reduce(
    (total, term) => {
      const termIsAmbiguous = ambiguousTerms.some(a => {
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        return new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").test(term);
      });
      return total + fields.reduce(
        (fieldTotal, field) => {
          if (!containsTerm(field.text, term)) return fieldTotal;
          if (termIsAmbiguous && !explicitSignals.some(sig => containsTerm(field.text, sig))) return fieldTotal;
          return fieldTotal + field.weight * score;
        },
        0,
      );
    },
    0,
  );

  // Core difficulty words are deliberately scored instead of checked with
  // find(...). This lets "Final Game - ... Beginners Tutorial" resolve to
  // Beginner: "final game" is content vocabulary, while "beginners" is an
  // explicit learning-level signal. "final" alone is never an Expert signal.
  const coreTerms: Record<SkillLevel, string[]> = {
    Beginner: [
      "beginner", "beginners", "begginer", "beginner friendly", "absolute beginner",
      "beginner level", "newbie", "noob", "novice", "principiante", "principianti",
      "principiante assoluto", "debutant", "debutante", "anfanger", "iniciante",
      "easy", "easier", "easiest", "facile", "facili", "facil", "fácil",
      "semplice", "basico", "básico", "livello 1", "level 1",
      "niveau 1", "nivel 1", "part one", "chapter 1",
    ],
    Intermediate: [
      "intermediate", "intermediates", "intermediate level", "intermediate difficulty",
      "mid level", "moderate",
      "moderately", "intermedio", "intermedia", "medio", "media",
      "promedio", "moderado", "intermediaire", "mittel", "intermediario",
      "livello 2", "level 2", "niveau 2", "nivel 2",
    ],
    Advanced: [
      "advanced", "advanced level", "hard", "harder", "hardest", "difficult",
      "difficoult", "very difficult", "vary difficult", "challenging",
      "challenging level", "high difficulty", "higher level", "complex", "complexity",
      "deep dive", "intensive", "rigorous", "sophisticated", "hard surface",
      "avanzato", "avanzata", "dificil", "difícil", "avanzado", "avance",
      "fortgeschritten", "schwierig", "avancado", "avançado", "alto nivel",
      "livello avanzato", "level 3", "level 4", "livello 3", "livello 4",
      "niveau 3", "niveau 4", "nivel 3", "nivel 4",
    ],
    Expert: [
      "expert", "experts", "expert level", "expert difficulty", "master", "mastery",
      "masterclass", "master level", "professional", "professionals", "pro", "pros",
      "pro level", "professional workflow", "very advanced", "extreme",
      "extreme difficulty", "extremely difficult", "ultimate", "elite", "senior",
      "industry level", "production ready", "esperto", "esperta", "experto",
      "maestro", "maestria", "professionale", "profesional", "professionnel",
      "extremo", "extreme", "meister", "profissional", "livello 5", "level 5",
      "niveau 5", "nivel 5", "final level", "final challenge",
    ],
  };

  // These words describe the teaching format or the beginning of a course.
  // They help when no explicit level is present, but are weaker than a direct
  // phrase such as "advanced tutorial".
  const beginnerContextTerms = [
    "tutorial", "tutoriale", "tutoriel", "guide", "guida", "how to",
    "introduction", "intro", "introductory", "introduzione", "basics", "basic",
    "base", "basi", "foundation", "fundamentals", "fondamenti", "from scratch",
    "da zero", "paso a paso", "passo passo", "step by step", "starter",
    "starting", "getting started", "first steps", "start here", "learn from scratch",
    "for everyone", "per principianti", "per iniziare", "para principiantes",
    "pour debutants", "fur anfanger", "para iniciantes",
  ];
  const softBeginnerTerms = [
    "elementary", "elementare", "low difficulty", "bassa difficolta",
  ];

  const scores = Object.fromEntries(
    LEVELS.map((level) => [
      level,
      scoreTerms(coreTerms[level], 5)
        + (level === "Beginner" ? scoreTerms(softBeginnerTerms, 2) : 0)
        + (level === "Beginner" ? scoreTerms(beginnerContextTerms, 1) : 0),
    ]),
  ) as Record<SkillLevel, number>;

  // A parità di punteggio vince il livello più alto (reduce in ordine crescente con >=).
  const bestLevel = LEVELS.reduce((best, level) => (
    scores[level] >= scores[best] ? level : best
  ), "Beginner" as SkillLevel);
  return scores[bestLevel] > 0 ? bestLevel : "Beginner";
}

export function categoryPayload(category: Category, videos: Video[], includeIcon = true) {
  const categoryVideos = videos.filter((video) => video.categoryId === category.id);
  const watchedVideos = categoryVideos.filter(isVideoComplete).length;
  const levelCounts = Object.fromEntries(
    LEVELS.map((level) => [level, categoryVideos.filter((video) => video.level === level).length]),
  ) as Record<SkillLevel, number>;
  return {
    id: category.id,
    name: category.name,
    iconUrl: includeIcon ? category.iconUrl : null,
    favorite: category.favorite,
    archivedAt: category.archivedAt,
    totalVideos: categoryVideos.length,
    watchedVideos,
    progressPercent: progressPercentForVideos(categoryVideos),
    levelCounts,
  };
}

/**
 * Progress is weighted by real playback time, not by the count of videos.
 * A video at or above the completion threshold contributes its full duration,
 * and a video can never contribute more than its duration.
 */
export function cappedPlaybackSeconds(seconds: number, durationSeconds: number) {
  const duration = Math.max(0, Math.round(durationSeconds));
  const playback = Math.max(0, Math.round(seconds));
  if (!duration) return 0;
  return playback / duration >= COMPLETION_THRESHOLD ? duration : Math.min(playback, duration);
}

export function isVideoComplete(video: Pick<Video, "watched" | "playbackSeconds" | "durationSeconds">) {
  return video.watched || (
    video.durationSeconds > 0
    && cappedPlaybackSeconds(video.playbackSeconds, video.durationSeconds) >= video.durationSeconds
  );
}

export function effectivePlaybackSeconds(video: Pick<Video, "watched" | "playbackSeconds" | "durationSeconds">) {
  const duration = Math.max(0, Math.round(video.durationSeconds));
  return video.watched ? duration : cappedPlaybackSeconds(video.playbackSeconds, duration);
}

export function watchedSecondsForVideos(videos: Video[]) {
  return videos.reduce((total, video) => (
    total + effectivePlaybackSeconds(video)
  ), 0);
}

export function progressPercentForVideos(videos: Video[]) {
  const totalDuration = videos.reduce(
    (total, video) => total + Math.max(0, video.durationSeconds),
    0,
  );
  if (!totalDuration) return 0;
  return Math.round((watchedSecondsForVideos(videos) / totalDuration) * 100);
}

export function videoPayload(video: Video, categoryName: string) {
  return {
    id: video.id,
    youtubeId: video.youtubeId,
    title: video.title,
    description: video.description,
    channelName: video.channelName,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
    durationLabel: video.durationLabel,
    level: video.level as SkillLevel,
    watched: isVideoComplete(video),
    playbackSeconds: effectivePlaybackSeconds(video),
    favorite: video.favorite,
    position: video.position,
    sourceName: video.sourceName,
    sourceType: video.sourceType as "channel" | "playlist" | "video",
    ...(video.sourceType === "playlist" && video.playlistUrl ? { playlistUrl: video.playlistUrl } : {}),
    ...(video.sourceType === "playlist" ? { playlistWasMixed: video.playlistWasMixed } : {}),
    categoryName,
    url: video.url,
  };
}

async function syncPlaylistSnapshots(videos: Video[]): Promise<Video[]> {
  const grouped = new Map<string, Video[]>();
  for (const video of videos) {
    if (video.sourceType !== "playlist") continue;
    const key = `${video.categoryId}:${video.sourceName}`;
    grouped.set(key, [...(grouped.get(key) ?? []), video]);
  }

  const updates = [...grouped.values()]
    .filter((group) => new Set(group.map((video) => video.level)).size > 1)
    .filter((group) => !group.some((video) => video.playlistWasMixed))
    .flatMap((group) => group.map(async (video) => {
      const [updated] = await db
        .update(videosTable)
        .set({
          playlistRestoreLevel: video.level,
          playlistWasMixed: true,
          updatedAt: new Date(),
        })
        .where(eq(videosTable.id, video.id))
        .returning();
      return updated ?? video;
    }));

  if (!updates.length) return videos;
  const updatedVideos = await Promise.all(updates);
  const updatedById = new Map(updatedVideos.map((video) => [video.id, video]));
  return videos.map((video) => updatedById.get(video.id) ?? video);
}



export async function getCategoryData(categoryName: string) {
  const [category] = await db.select().from(categoriesTable).where(and(
    eq(categoriesTable.name, categoryName),
    isNull(categoriesTable.archivedAt),
  ));
  if (!category) return undefined;
  const videos = await syncPlaylistSnapshots(await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.categoryId, category.id))
    .orderBy(asc(videosTable.position), asc(videosTable.createdAt)));
  return { category, videos };
}

export async function findVideoWithCategory(id: number) {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, id));
  if (!video) return undefined;
  const [category] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, video.categoryId));
  if (!category) return undefined;
  return { video, category };
}

export async function ensureCategoryPositions(): Promise<void> {
  // Backfill position for any categories where position is 0 or NULL
  // to preserve the original createdAt order for existing data.
  const categories = await db
    .select()
    .from(categoriesTable)
    .where(isNull(categoriesTable.archivedAt))
    .orderBy(asc(categoriesTable.createdAt));

  const needsBackfill = categories.filter((c) => !c.position || c.position === 0);
  if (needsBackfill.length === 0) return;

  // Use a transaction to update positions sequentially based on their index
  await db.transaction(async (tx) => {
    for (let i = 0; i < categories.length; i += 1) {
      const category = categories[i];
      if (!category.position || category.position === 0) {
        await tx
          .update(categoriesTable)
          .set({ position: i + 1 })
          .where(eq(categoriesTable.id, category.id));
      }
    }
  });
}

export async function allLearningData(skipLevelSync = false) {
  await ensureCategoryPositions();
  const [categories, joinedVideos] = await Promise.all([
    db.select().from(categoriesTable)
      .where(isNull(categoriesTable.archivedAt))
      .orderBy(asc(categoriesTable.position), asc(categoriesTable.createdAt)),
    db
      .select({ video: videosTable })
      .from(videosTable)
       .innerJoin(categoriesTable, and(
         eq(videosTable.categoryId, categoriesTable.id),
         isNull(categoriesTable.archivedAt),
       ))
      .orderBy(asc(videosTable.position), asc(videosTable.createdAt)),
  ]);
  const videos = joinedVideos.map(({ video }) => video);
  return { categories, videos: skipLevelSync ? videos : await syncPlaylistSnapshots(videos) };
}

export async function findOrCreateCategory(name: string) {
  const existing = await db.select().from(categoriesTable).where(eq(categoriesTable.name, name));
  if (existing[0]) {
    if (existing[0].archivedAt) {
      const [restored] = await db
        .update(categoriesTable)
        .set({ archivedAt: null })
        .where(eq(categoriesTable.id, existing[0].id))
        .returning();
      return restored ?? existing[0];
    }
    return existing[0];
  }
  const [created] = await db.insert(categoriesTable).values({ name }).returning();
  if (!created) throw new Error("Unable to create category");
  return created;
}

export async function archivedCategoriesData() {
  return db
    .select()
    .from(categoriesTable)
    .where(isNotNull(categoriesTable.archivedAt))
    .orderBy(asc(categoriesTable.archivedAt), asc(categoriesTable.createdAt));
}

export async function videosForCategory(categoryId: number) {
  return db.select().from(videosTable).where(eq(videosTable.categoryId, categoryId));
}
