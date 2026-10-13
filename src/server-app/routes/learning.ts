import { Router, type IRouter } from "../express-shim";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, categoriesTable, videosTable, type Video } from "@workspace/db";
import {
  CreateCategoryBody,
  CreateCategoryResponse,
  GetCategoryParams,
  GetCategoryResponse,
  GetDashboardResponse,
  ImportContentBody,
  ImportContentResponse,
  ListCategoriesResponse,
  UpdateVideoProgressParams,
  UpdateVideoProgressBody,
  UpdateVideoProgressResponse,
  UpdateVideoPlaybackParams,
  UpdateVideoPlaybackBody,
  UpdateVideoPlaybackResponse,
  UpdateVideoSkillParams,
  UpdateVideoSkillBody,
  UpdateVideoSkillResponse,
  UpdatePlaylistLevelParams,
  UpdatePlaylistLevelBody,
  UpdatePlaylistLevelResponse,
  UpdateVideoSourcesParams,
  UpdateVideoSourcesBody,
  UpdateVideoSourcesResponse,
  UpdateCategoryFavoriteParams,
  UpdateCategoryFavoriteBody,
  UpdateCategoryFavoriteResponse,
  DeleteVideoParams,
  DeleteVideoResponse,
  UpdateVideoFavoriteParams,
  UpdateVideoFavoriteBody,
  UpdateVideoFavoriteResponse,
  UpdateVideoPositionParams,
  UpdateVideoPositionBody,
  UpdateVideoPositionResponse,
  GetFavoritesResponse,
  BuildLearningPathBody,
  BuildLearningPathResponse,
  RenameCategoryBody,
  UpdateCategoryPositionBody,
  UpdateCategoryPositionResponse,
} from "@workspace/api-zod";
import {
  allLearningData,
  archivedCategoriesData,
  categoryPayload,
  cappedPlaybackSeconds,
  ensureSeeded,
  findOrCreateCategory,
  findVideoWithCategory,
  formatDuration,
  getCategoryData,
  isVideoComplete,
  levelFromText,
  progressPercentForVideos,
  watchedSecondsForVideos,
  videoPayload,
} from "../lib/learning";
import {
  fetchYouTubeContent,
  cacheOfflineVideos,
  getOfflineVideos,
  searchYouTubePlaylists,
  searchYouTubeVideos,
  toVideoInsert,
  type PlaylistSearchResult,
  type YouTubeVideo,
} from "../lib/youtube";
import { planLevelAssignments, type LevelAssignmentVideo } from "../lib/level-assignment";
import { isRelevantLearningContent, tokenize } from "../lib/relevance";

const router: IRouter = Router();

type SelectedLearningSource = {
  candidate: PlaylistSearchResult;
  content: Awaited<ReturnType<typeof fetchYouTubeContent>>;
};

router.get("/dashboard", async (req, res): Promise<void> => {
  await ensureSeeded();
  const includeIcons = req.query.includeIcons !== "false";
  const { categories, videos } = await allLearningData(!includeIcons);
  const categoriesPayload = categories.map((category) => categoryPayload(category, videos, includeIcons));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const videoPayloads = videos.map((video) => videoPayload(video, categoryNames.get(video.categoryId) ?? "Uncategorized"));
  const watchedVideos = videos.filter(isVideoComplete);
  const currentlyLearning = categories.flatMap((category) => videos
    .filter((video) => video.categoryId === category.id && !isVideoComplete(video))
    .slice(0, 1)
    .map((video) => videoPayload(video, category.name)));
  const result = {
    totalVideos: videos.length,
    watchedVideos: watchedVideos.length,
    totalHoursWatched: Math.round(watchedSecondsForVideos(videos) / 3600 * 10) / 10,
    progressPercent: progressPercentForVideos(videos),
    categories: categoriesPayload,
    currentlyLearning: currentlyLearning.length
      ? currentlyLearning
      : videos
        .filter((video) => !isVideoComplete(video))
        .slice(0, 4)
        .map((video) => videoPayload(video, categoryNames.get(video.categoryId) ?? "Uncategorized")),
  };
  res.json(GetDashboardResponse.parse(result));
});

router.get("/categories", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const { categories, videos } = await allLearningData();
  res.json(ListCategoriesResponse.parse(categories.map((category) => categoryPayload(category, videos))));
});

router.get("/archived-categories", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const categories = await archivedCategoriesData();
  const categoryIds = new Set(categories.map((category) => category.id));
  const videos = categoryIds.size
    ? (await db.select().from(videosTable)).filter((video) => categoryIds.has(video.categoryId))
    : [];
  res.json(ListCategoriesResponse.parse(categories.map((category) => categoryPayload(category, videos))));
});

router.post("/categories", async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const category = await findOrCreateCategory(parsed.data.name.trim());
    const updatedCategory = parsed.data.iconUrl !== undefined
      ? (await db.update(categoriesTable)
        .set({ iconUrl: parsed.data.iconUrl })
        .where(eq(categoriesTable.id, category.id))
        .returning())[0] ?? category
      : category;
    const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, updatedCategory.id));
    res.status(201).json(CreateCategoryResponse.parse(categoryPayload(updatedCategory, videos)));
  } catch {
    res.status(409).json({ error: "That category already exists." });
  }
});

router.get("/categories/:categoryName", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = GetCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const data = await getCategoryData(params.data.categoryName);
  if (!data) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  res.json(GetCategoryResponse.parse({
    category: categoryPayload(data.category, data.videos),
    videos: data.videos.map((video) => videoPayload(video, data.category.name)),
  }));
});

// NOTE: specific PATCH /categories/* routes must be registered BEFORE the
// parametric PATCH /categories/:categoryName route below. Otherwise Express
// matches "position" as a category name, the reorder request 400s with
// "Nothing to update.", and the sidebar skill reorder never saves.
router.patch("/categories/position", async (req, res): Promise<void> => {
  await ensureSeeded();
  const body = UpdateCategoryPositionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid category order request." });
    return;
  }

  const { categories, videos } = await allLearningData(true);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const categoriesByName = new Map(categories.map((c) => [c.name, c]));

  // Support both category IDs (numeric string or number) and category names
  const reordered = body.data.order.map((item) => {
    const numId = Number(item);
    if (!isNaN(numId) && categoriesById.has(numId)) {
      return categoriesById.get(numId);
    }
    return categoriesByName.get(item);
  });

  if (
    reordered.length !== categories.length ||
    reordered.some((cat): cat is undefined => !cat) ||
    new Set(body.data.order).size !== categories.length
  ) {
    res.status(400).json({ error: "Invalid category order." });
    return;
  }

  const orderedCategories = reordered as typeof categories;

  const positionRows = orderedCategories.map((category, position) => sql`(${category.id}::integer, ${position + 1}::integer)`);
  await db.execute(sql`
    UPDATE ${categoriesTable} AS c
    SET position = positions.position
    FROM (VALUES ${sql.join(positionRows, sql`, `)}) AS positions(id, position)
    WHERE c.id = positions.id
  `);

  const updatedCategories = orderedCategories.map((c, idx) => ({ ...c, position: idx + 1 }));
  res.json(UpdateCategoryPositionResponse.parse(updatedCategories.map((category) => categoryPayload(category, videos))));
});

router.patch("/categories/:categoryName", async (req, res): Promise<void> => {
  const params = GetCategoryParams.safeParse(req.params);
  const parsed = RenameCategoryBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const hasName = typeof parsed.data.name === "string" && parsed.data.name.trim().length > 0;
  const hasIconUrl = parsed.data.iconUrl !== undefined;
  if (!hasName && !hasIconUrl) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(and(
      eq(categoriesTable.name, params.data.categoryName),
      isNull(categoriesTable.archivedAt),
    ));
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  try {
    const updates: Record<string, unknown> = {};
    if (hasName) updates.name = parsed.data.name!.trim();
    if (hasIconUrl) updates.iconUrl = parsed.data.iconUrl;
    const [updated] = await db
      .update(categoriesTable)
      .set(updates)
      .where(eq(categoriesTable.id, category.id))
      .returning();
    const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, category.id));
    res.json(CreateCategoryResponse.parse(categoryPayload(updated ?? category, videos)));
  } catch {
    res.status(409).json({ error: "That category name already exists." });
  }
});

router.delete("/categories/:categoryName", async (req, res): Promise<void> => {
  const params = GetCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category name." });
    return;
  }
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(and(
      eq(categoriesTable.name, params.data.categoryName),
      isNull(categoriesTable.archivedAt),
    ));
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const [archived] = await db
    .update(categoriesTable)
    .set({ archivedAt: new Date() })
    .where(eq(categoriesTable.id, category.id))
    .returning();
  const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, category.id));
  res.json(CreateCategoryResponse.parse(categoryPayload(archived ?? category, videos)));
});

router.patch("/archived-categories/:categoryName/restore", async (req, res): Promise<void> => {
  const params = GetCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category name." });
    return;
  }
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(and(
      eq(categoriesTable.name, params.data.categoryName),
      isNotNull(categoriesTable.archivedAt),
    ));
  if (!category) {
    res.status(404).json({ error: "Archived category not found." });
    return;
  }
  const [restored] = await db
    .update(categoriesTable)
    .set({ archivedAt: null })
    .where(eq(categoriesTable.id, category.id))
    .returning();
  const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, category.id));
  res.json(CreateCategoryResponse.parse(categoryPayload(restored ?? category, videos)));
});

router.delete("/archived-categories/:categoryName", async (req, res): Promise<void> => {
  const params = GetCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid category name." });
    return;
  }
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(and(
      eq(categoriesTable.name, params.data.categoryName),
      isNotNull(categoriesTable.archivedAt),
    ));
  if (!category) {
    res.status(404).json({ error: "Archived category not found." });
    return;
  }
  const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, category.id));
  await db.transaction(async (tx) => {
    await tx.delete(videosTable).where(eq(videosTable.categoryId, category.id));
    await tx.delete(categoriesTable).where(eq(categoriesTable.id, category.id));
  });
  res.json(CreateCategoryResponse.parse(categoryPayload(category, videos)));
});

router.patch("/videos/:videoId/progress", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoProgressParams.safeParse(req.params);
  const body = UpdateVideoProgressBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid progress update." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }
  const update = body.data.watched
    ? { watched: true, playbackSeconds: found.video.durationSeconds, updatedAt: new Date() }
    : { watched: false, updatedAt: new Date() };
  const [updated] = await db.update(videosTable)
    .set(update)
    .where(eq(videosTable.id, params.data.videoId))
    .returning();
  res.json(UpdateVideoProgressResponse.parse(videoPayload(updated ?? found.video, found.category.name)));
});

router.patch("/videos/:videoId/playback", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoPlaybackParams.safeParse(req.params);
  const body = UpdateVideoPlaybackBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid playback position." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }
  const durationSeconds = body.data.durationSeconds === undefined
    ? found.video.durationSeconds
    : Math.max(0, Math.round(body.data.durationSeconds));
  const seconds = cappedPlaybackSeconds(body.data.seconds, durationSeconds);
  const reachedCompletionThreshold = durationSeconds > 0 && seconds >= durationSeconds;
  const [updated] = await db.update(videosTable)
    .set({
      playbackSeconds: seconds,
      watched: found.video.watched || reachedCompletionThreshold,
      ...(durationSeconds > 0
        ? { durationSeconds, durationLabel: formatDuration(durationSeconds) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(videosTable.id, params.data.videoId))
    .returning();
  res.json(UpdateVideoPlaybackResponse.parse(videoPayload(updated ?? found.video, found.category.name)));
});

router.patch("/categories/:categoryName/favorite", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateCategoryFavoriteParams.safeParse(req.params);
  const body = UpdateCategoryFavoriteBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid favorite update." });
    return;
  }
  const [category] = await db
    .update(categoriesTable)
    .set({ favorite: body.data.favorite })
    .where(eq(categoriesTable.name, params.data.categoryName))
    .returning();
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  const videos = await db.select().from(videosTable).where(eq(videosTable.categoryId, category.id));
  res.json(UpdateCategoryFavoriteResponse.parse(categoryPayload(category, videos)));
});

router.delete("/videos/:videoId", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = DeleteVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid video ID." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }
  await db.delete(videosTable).where(eq(videosTable.id, params.data.videoId));
  res.json(DeleteVideoResponse.parse(videoPayload(found.video, found.category.name)));
});

router.patch("/videos/:videoId/favorite", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoFavoriteParams.safeParse(req.params);
  const body = UpdateVideoFavoriteBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid favorite update." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }
  const [updated] = await db
    .update(videosTable)
    .set({ favorite: body.data.favorite, updatedAt: new Date() })
    .where(eq(videosTable.id, params.data.videoId))
    .returning();
  res.json(UpdateVideoFavoriteResponse.parse(videoPayload(updated ?? found.video, found.category.name)));
});

router.patch("/videos/:videoId/position", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoPositionParams.safeParse(req.params);
  const body = UpdateVideoPositionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid video position." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }

  const videos = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.categoryId, found.category.id))
    .orderBy(asc(videosTable.position), asc(videosTable.createdAt));
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const reordered = body.data.order.map((videoId) => videosById.get(videoId));
  if (
    reordered.length !== videos.length
    || reordered.some((video): video is undefined => !video)
    || new Set(body.data.order).size !== videos.length
  ) {
    res.status(400).json({ error: "Invalid video order." });
    return;
  }
  const orderedVideos = reordered as Video[];

  const positionRows = orderedVideos.map((video, position) => sql`(${video.id}::integer, ${position}::integer)`);
  await db.execute(sql`
    UPDATE ${videosTable} AS v
    SET position = positions.position,
        updated_at = NOW()
    FROM (VALUES ${sql.join(positionRows, sql`, `)}) AS positions(id, position)
    WHERE v.id = positions.id
      AND v.category_id = ${found.category.id}
  `);

  const updated = found.video;
  res.json(UpdateVideoPositionResponse.parse(videoPayload(updated, found.category.name)));
});

router.get("/favorites", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const { categories, videos } = await allLearningData();
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const favoriteVideos = videos
    .filter((video) => video.favorite)
    .map((video) => videoPayload(video, categoryNames.get(video.categoryId) ?? "Uncategorized"));
  const favoriteCategories = categories
    .filter((category) => category.favorite)
    .map((category) => categoryPayload(category, videos));

  const playlistGroups = new Map<string, {
    sourceName: string;
    categoryName: string;
    videoCount: number;
    thumbnailUrl: string;
  }>();
  const playlistVideos = new Map<string, Video[]>();
  for (const video of videos) {
    if (video.sourceType !== "playlist") continue;
    const key = `${video.categoryId}:${video.sourceName}`;
    playlistVideos.set(key, [...(playlistVideos.get(key) ?? []), video]);
  }
  for (const [key, group] of playlistVideos) {
    if (!group.length || !group.every((video) => video.favorite)) continue;
    const video = group[0];
    const categoryName = categoryNames.get(video.categoryId) ?? "Uncategorized";
    playlistGroups.set(key, {
      sourceName: video.sourceName,
      categoryName,
      videoCount: group.length,
      thumbnailUrl: video.thumbnailUrl,
    });
  }

  res.json(GetFavoritesResponse.parse({
    playlists: [...playlistGroups.values()],
    skills: favoriteCategories,
    videos: favoriteVideos,
  }));
});

router.patch("/videos/:videoId/skill", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoSkillParams.safeParse(req.params);
  const body = UpdateVideoSkillBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid skill level." });
    return;
  }
  const found = await findVideoWithCategory(params.data.videoId);
  if (!found) {
    res.status(404).json({ error: "Video not found." });
    return;
  }
  const playlistVideos = found.video.sourceType === "playlist"
    ? await db.select().from(videosTable).where(
      eq(videosTable.categoryId, found.category.id),
    )
    : [];
  const samePlaylistVideos = playlistVideos.filter((video) =>
    video.sourceType === "playlist" && video.sourceName === found.video.sourceName,
  );
  const currentLevels = new Set(samePlaylistVideos.map((video) => video.level));
  const nextLevels = new Set(samePlaylistVideos.map((video) =>
    video.id === found.video.id ? body.data.level : video.level,
  ));
  if (
    samePlaylistVideos.length > 0
    && !samePlaylistVideos.some((video) => video.playlistWasMixed)
    && (currentLevels.size > 1 || nextLevels.size > 1)
  ) {
    await Promise.all(samePlaylistVideos.map((video) => db.update(videosTable)
      .set({
        playlistRestoreLevel: video.level,
        playlistWasMixed: true,
        updatedAt: new Date(),
      })
      .where(eq(videosTable.id, video.id))));
  }
  const [updated] = await db.update(videosTable)
    .set({ level: body.data.level, levelOverridden: true, updatedAt: new Date() })
    .where(eq(videosTable.id, params.data.videoId))
    .returning();
  res.json(UpdateVideoSkillResponse.parse(videoPayload(updated ?? found.video, found.category.name)));
});

router.patch("/categories/:categoryName/playlists/:playlistName/level", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdatePlaylistLevelParams.safeParse(req.params);
  const body = UpdatePlaylistLevelBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid playlist level." });
    return;
  }
  const [category] = await db.select().from(categoriesTable)
    .where(eq(categoriesTable.name, params.data.categoryName));
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }
  let playlistVideos = await db.select().from(videosTable)
    .where(eq(videosTable.categoryId, category.id));
  playlistVideos = playlistVideos.filter((video) =>
    video.sourceType === "playlist" && video.sourceName === params.data.playlistName,
  );
  if (!playlistVideos.length) {
    res.status(404).json({ error: "Playlist not found." });
    return;
  }

  const currentLevels = new Set(playlistVideos.map((video) => video.level));
  if (!playlistVideos.some((video) => video.playlistWasMixed) && currentLevels.size > 1) {
    await Promise.all(playlistVideos.map((video) => db.update(videosTable)
      .set({
        playlistRestoreLevel: video.level,
        playlistWasMixed: true,
        updatedAt: new Date(),
      })
      .where(eq(videosTable.id, video.id))));
    playlistVideos = playlistVideos.map((video) => ({
      ...video,
      playlistRestoreLevel: video.level,
      playlistWasMixed: true,
    }));
  }

  const nextLevels = playlistVideos.map(() => body.data.level);
  await Promise.all(playlistVideos.map((video, index) => db.update(videosTable)
    .set({
      level: nextLevels[index],
      levelOverridden: true,
      playlistWasMixed: video.playlistWasMixed,
      updatedAt: new Date(),
    })
    .where(eq(videosTable.id, video.id))));

  const updatedVideos = await db.select().from(videosTable)
    .where(eq(videosTable.categoryId, category.id));
  const responseVideos = updatedVideos.filter((video) =>
    video.sourceType === "playlist" && video.sourceName === params.data.playlistName,
  );
  const resultLevel = new Set(responseVideos.map((video) => video.level));
  res.json(UpdatePlaylistLevelResponse.parse({
    level: resultLevel.size === 1 ? [...resultLevel][0] : "Mista",
    videos: responseVideos.map((video) => videoPayload(video, category.name)),
  }));
});

router.patch("/categories/:categoryName/videos/source", async (req, res): Promise<void> => {
  await ensureSeeded();
  const params = UpdateVideoSourcesParams.safeParse(req.params);
  const body = UpdateVideoSourcesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid video source updates." });
    return;
  }

  const [category] = await db.select().from(categoriesTable)
    .where(eq(categoriesTable.name, params.data.categoryName));
  if (!category) {
    res.status(404).json({ error: "Category not found." });
    return;
  }

  const ids = body.data.updates.map((update) => update.videoId);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Duplicate video IDs are not allowed." });
    return;
  }

  const existingVideos = await db.select().from(videosTable)
    .where(eq(videosTable.categoryId, category.id));
  const existingById = new Map(existingVideos.map((video) => [video.id, video]));
  if (body.data.updates.some((update) => !existingById.has(update.videoId))) {
    res.status(404).json({ error: "One or more videos were not found in this skill." });
    return;
  }

  await db.transaction(async (tx) => {
    for (const update of body.data.updates) {
      await tx.update(videosTable)
        .set({
          sourceType: update.sourceType,
          sourceName: update.sourceName,
          playlistUrl: update.sourceType === "playlist" ? (update.playlistUrl ?? null) : null,
          updatedAt: new Date(),
        })
        .where(eq(videosTable.id, update.videoId));
    }
  });

  const updatedVideos = await db.select().from(videosTable)
    .where(eq(videosTable.categoryId, category.id));
  const updatedById = new Map(updatedVideos.map((video) => [video.id, video]));
  res.json(UpdateVideoSourcesResponse.parse(body.data.updates.map((update) => {
    const video = updatedById.get(update.videoId);
    return videoPayload(video!, category.name);
  })));
});

router.post("/imports", async (req, res): Promise<void> => {
  const parsed = ImportContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    // Fetch first so a failed YouTube import never leaves an empty skill
    // category behind. The category is created only after valid content exists.
    const content = await fetchYouTubeContent(parsed.data.url);
    const category = await findOrCreateCategory(parsed.data.categoryName.trim());
    const categoryWithIcon = typeof parsed.data.iconUrl === "string"
      ? (await db.update(categoriesTable)
        .set({ iconUrl: parsed.data.iconUrl })
        .where(eq(categoriesTable.id, category.id))
        .returning())[0] ?? category
      : category;
    const existingVideos = await db
      .select({ position: videosTable.position })
      .from(videosTable)
      .where(eq(videosTable.categoryId, categoryWithIcon.id));
    const nextPosition = existingVideos.reduce((max, video) => Math.max(max, video.position), -1) + 1;
    for (const [index, video] of content.videos.entries()) {
      const insert = toVideoInsert(video, categoryWithIcon.id);
      const inferredLevel = levelFromText(video.title, video.description, video.sourceName);
      await db
        .insert(videosTable)
        .values({
          ...insert,
          level: parsed.data.level ?? inferredLevel,
          ...(parsed.data.level ? { levelOverridden: true } : {}),
          position: nextPosition + index,
        })
        .onConflictDoUpdate({
          target: [videosTable.youtubeId, videosTable.categoryId],
          set: {
            title: insert.title,
            description: insert.description,
            channelName: insert.channelName,
            thumbnailUrl: insert.thumbnailUrl,
            durationSeconds: insert.durationSeconds,
            durationLabel: insert.durationLabel,
            sourceName: insert.sourceName,
            sourceType: insert.sourceType,
             playlistUrl: insert.playlistUrl,
            url: insert.url,
            level: parsed.data.level
              ? parsed.data.level
              : sql`CASE WHEN ${videosTable.levelOverridden} THEN ${videosTable.level} ELSE ${inferredLevel} END`,
            ...(parsed.data.level ? { levelOverridden: true } : {}),
            updatedAt: new Date(),
          },
        });
    }
    await cacheOfflineVideos(content.videos);
    const allVideos = await db.select().from(videosTable).where(eq(videosTable.categoryId, categoryWithIcon.id));
    res.status(201).json(ImportContentResponse.parse({
      sourceName: content.sourceName,
      sourceType: content.sourceType,
      importedCount: content.videos.length,
      category: categoryPayload(categoryWithIcon, allVideos),
    }));
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const code = (error as Error & { code?: string }).code;
    if (status === 429 || status === 503) {
      const message = code === "quota_exceeded"
        ? "YouTube quota or rate limits were reached. No cached copy was available for this URL; retry later or import it again after YouTube access is restored."
        : code === "api_key_missing"
          ? "YouTube API access is not configured on the server. The YouTube source could not be reached. Try importing a different URL or retry later."
          : code === "invalid_metadata"
            ? "YouTube returned no usable public metadata for this URL. Check that the video or playlist is public, then retry."
            : "YouTube could not be reached and no cached copy was available. Check the URL and retry shortly.";
      res.status(503).json({ error: message, errorCode: code ?? "unavailable" });
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to import YouTube content.";
    res.status(message.includes("valid") || message.includes("supported") || message.includes("found") ? 400 : 500).json({ error: message });
  }
});

router.post("/learning-paths", async (req, res): Promise<void> => {
  const parsed = BuildLearningPathBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { skill, goal, categoryName } = parsed.data;
    const levels = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;
    const category = await findOrCreateCategory(
      categoryName?.trim() || `${skill.trim()} — Complete Path`,
    );
    // Search the whole local library for an offline fallback. A newly named
    // skill has no videos in its category yet, but existing imported lessons
    // can still be reused when YouTube is unavailable.
    const [localVideos, offlineVideos] = await Promise.all([
      db.select().from(videosTable),
      getOfflineVideos(),
    ]);
    const selectedLevels: Array<{
      level: (typeof levels)[number];
      playlistId: string;
      playlistTitle: string;
      channelName: string;
      url: string;
      videoCount: number;
      note?: string;
    }> = [];
    const selectedPlaylistIds = new Set<string>();
    const usablePlaylists = new Map<string, SelectedLearningSource>();
    const selectedVideoIds = new Set<string>();
    let totalImported = 0;
    const existingPathVideos = await db
      .select({ position: videosTable.position })
      .from(videosTable)
      .where(eq(videosTable.categoryId, category.id));
    let nextPathPosition = existingPathVideos.reduce((max, video) => Math.max(max, video.position), -1) + 1;

    const sharedCandidates = await searchPlaylistCandidates(skill.trim(), "General", goal?.trim());
    const sources: Array<{ level: (typeof levels)[number]; source: SelectedLearningSource }> = [];

    for (const [levelIndex, level] of levels.entries()) {
      let candidates = sharedCandidates;
      let selected = await findUsablePlaylist(
        rankPlaylists(candidates, skill, level, goal?.trim())
          .filter((candidate) => !selectedPlaylistIds.has(candidate.playlistId)),
        usablePlaylists,
        skill.trim(),
        goal?.trim(),
      );

      // Some topics have many beginner/expert playlists but no result whose
      // title literally says "Intermediate". Search by skill only before
      // considering a previously verified playlist.
      if (!selected) {
        const levelCandidates = await searchPlaylistCandidates(skill.trim(), level, goal?.trim());
        candidates = [...candidates, ...levelCandidates];
        selected = await findUsablePlaylist(
          rankPlaylists(levelCandidates, skill, level, goal?.trim())
            .filter((candidate) => !selectedPlaylistIds.has(candidate.playlistId)),
          usablePlaylists,
          skill.trim(),
          goal?.trim(),
        );
      }

      // If no playlist is usable, search direct YouTube lessons for this level.
      if (!selected) {
        selected = await findUsableVideoLessons(
          skill.trim(),
          level,
          goal?.trim(),
          selectedVideoIds,
        );
      }

      // Public YouTube pages can be temporarily unavailable. Reuse only
      // semantically matching local lessons as an offline source.
      if (!selected) {
        selected = findLocalVideoLessons(
          skill.trim(),
          goal?.trim(),
          localVideos,
          offlineVideos,
          selectedVideoIds,
        );
      }

      // A complete path is more useful than a hard failure. Reuse the best
      // verified playlist only when YouTube cannot provide a distinct one for
      // this level. The level is still assigned by this path builder.
      if (!selected) {
        selected = [...usablePlaylists.values()]
          .sort((a, b) => b.content.videos.length - a.content.videos.length)[0];
      }

      if (!selected) {
        res.status(422).json({
          error: `No relevant public YouTube content was found for "${skill}". Try a more specific goal or import a matching playlist/video URL.`,
        });
        return;
      }

      let source = selected;
      await cacheOfflineVideos(source.content.videos);
      selectedPlaylistIds.add(source.candidate.playlistId);
      // Salva la fonte per il piano (PASSAGGIO 1)
      sources.push({ level, source });
      // Aggiungi gli youtubeId per evitare duplicati nei livelli successivi
      for (const video of source.content.videos) {
        selectedVideoIds.add(video.youtubeId);
      }
    }

    // PASSAGGIO 2: pianifica e inserisci
    const plan = planLevelAssignments(
      sources.map((s) => ({
        level: s.level,
        sourceId: s.source.candidate.playlistId,
        videos: s.source.content.videos as LevelAssignmentVideo[],
      })),
    );

    for (const planned of plan) {
      const source = sources.find((s) => s.level === planned.level)?.source;
      if (!source) continue;

      const playlistTitle = source.candidate.title;
      const videosFromYouTube = source.content.videos.length;
      const videosAfterRelevance = source.content.videos.length;
      const videosPlanned = planned.videos.length;

      let importedForLevel = 0;
      let skippedExisting = 0;
      for (const video of planned.videos) {
        const [inserted] = await db
          .insert(videosTable)
          .values({ ...toVideoInsert(video as YouTubeVideo, category.id), level: planned.level, levelOverridden: true, position: nextPathPosition })
          .onConflictDoNothing()
          .returning({ id: videosTable.id });
        if (inserted) {
          importedForLevel++;
          nextPathPosition++;
        } else {
          skippedExisting++;
        }
      }

      const noteParts: string[] = [];
      if (planned.note) noteParts.push(planned.note);
      if (skippedExisting > 0) noteParts.push(`${skippedExisting} video già presenti nella skill`);

      console.log(`[coach] ${planned.level}: playlist="${playlistTitle}" | youtube=${videosFromYouTube} | pertinenza=${videosAfterRelevance} | pianificati=${videosPlanned} | inseriti=${importedForLevel} | saltati=${skippedExisting}`);

      selectedLevels.push({
        level: planned.level as (typeof levels)[number],
        playlistId: source.candidate.playlistId,
        playlistTitle: source.candidate.title,
        channelName: source.candidate.channelName,
        url: source.candidate.playlistId.startsWith("video:")
          ? `https://www.youtube.com/watch?v=${source.candidate.playlistId.slice("video:".length)}`
          : source.candidate.playlistId.startsWith("local")
            ? ((planned.videos[0] as YouTubeVideo | undefined)?.url ?? "")
            : `https://www.youtube.com/playlist?list=${source.candidate.playlistId}`,
        videoCount: importedForLevel,
        note: noteParts.length ? noteParts.join(" ") : undefined,
      });
      totalImported += importedForLevel;
    }

    const allVideos = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.categoryId, category.id));
    res.status(201).json(
      BuildLearningPathResponse.parse({
        category: categoryPayload(category, allVideos),
        levels: selectedLevels,
        totalImported,
      }),
    );
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const code = (error as Error & { code?: string }).code;
    if (status === 429 || status === 503) {
      const message = code === "quota_exceeded"
        ? "YouTube quota or rate limits were reached. Cached search results are used when available; no unrelated videos were substituted. Retry later for new content."
        : code === "api_key_missing"
          ? "YouTube API access is not configured on the server. The YouTube source could not be reached. Try importing a different URL or retry later."
          : "YouTube could not be reached or returned unreadable metadata. Cached search results are used when available; no unrelated videos were substituted. Retry shortly.";
      res.status(503).json({
        error: message,
        errorCode: code ?? "unavailable",
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to build a learning path.";
    res.status(500).json({ error: message });
  }
});

async function findUsablePlaylist(
  candidates: PlaylistSearchResult[],
  usablePlaylists: Map<string, SelectedLearningSource>,
  skill: string,
  goal?: string,
) {
  // Inspect more than the first result: YouTube often ranks a short or
  // unavailable playlist above a complete course.
  for (const candidate of candidates.slice(0, 12)) {
    const cached = usablePlaylists.get(candidate.playlistId);
    if (cached) return cached;

    try {
      const content = await fetchYouTubeContent(
        `https://www.youtube.com/playlist?list=${candidate.playlistId}`,
      );
      const relevantVideos = content.videos.filter((video) =>
        isRelevantLearningContent(
          {
            title: video.title + " " + candidate.title,
            description: video.description,
            channelName: video.channelName,
          },
          skill,
          goal,
        ),
      );
      if (relevantVideos.length >= 3) {
        const usable: SelectedLearningSource = {
          candidate,
          content: { ...content, videos: relevantVideos },
        };
        usablePlaylists.set(candidate.playlistId, usable);
        return usable;
      }
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 403 || status === 429 || status === 503) return undefined;
    }
  }

  return undefined;
}

async function findUsableVideoLessons(
  skill: string,
  level: string,
  goal: string | undefined,
  selectedVideoIds: Set<string>,
): Promise<SelectedLearningSource | undefined> {
  const currentYear = new Date().getUTCFullYear();
  const recentWindowStart = `${currentYear - 3}-01-01T00:00:00Z`;
  const goalSuffix = goal ? ` ${goal}` : "";
  const queries = [
    {
      query: `${skill} ${level} tutorial${goalSuffix}`,
      options: { order: "date" as const, publishedAfter: recentWindowStart },
    },
    {
      query: `${skill} ${level} complete tutorial${goalSuffix}`,
      options: { order: "relevance" as const },
    },
  ];
  const byId = new Map<string, YouTubeVideo>();

  for (const { query, options } of queries) {
    let results: YouTubeVideo[];
    try {
      results = await searchYouTubeVideos(query.replace(/\s+/g, " ").trim(), options);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 403 || status === 429 || status === 503) break;
      throw error;
    }
    for (const result of results) {
      if (
        !selectedVideoIds.has(result.youtubeId) &&
        isRelevantLearningContent(result, skill, goal)
      ) {
        byId.set(result.youtubeId, result);
      }
    }
    if (byId.size >= 8) break;
  }

  const skillWords = tokenize(skill);
  const goalWords = tokenize(goal ?? "");
  const videos = [...byId.values()]
    .sort((a, b) =>
      scorePlaylist(b, skillWords, level, goalWords) -
      scorePlaylist(a, skillWords, level, goalWords),
    )
    .slice(0, 8);
  const first = videos[0];
  if (!first) return undefined;

  return {
    candidate: {
      playlistId: `video:${first.youtubeId}`,
      title: `${skill} ${level} — curated video lessons`,
      description: "Curated direct video lessons from YouTube.",
      channelName: first.channelName,
      thumbnailUrl: first.thumbnailUrl,
      publishedAt: first.publishedAt ?? "",
    },
    content: {
      sourceName: "YouTube video search",
      sourceType: "video",
      videos,
    },
  };
}

function findLocalVideoLessons(
  skill: string,
  goal: string | undefined,
  localVideos: Video[],
  offlineVideos: YouTubeVideo[],
  selectedVideoIds: Set<string>,
): SelectedLearningSource | undefined {
  const skillWords = tokenize(skill);
  const goalWords = tokenize(goal ?? "");
  const localCandidates = [
    ...localVideos.map((video) => ({
      youtubeId: video.youtubeId,
      title: video.title,
      description: video.description,
      channelName: video.channelName,
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
      level: video.level as YouTubeVideo["level"],
      sourceName: video.sourceName,
      sourceType: video.sourceType as YouTubeVideo["sourceType"],
      url: video.url,
      publishedAt: video.createdAt.toISOString(),
      score: scorePlaylist(video, skillWords, video.level, goalWords),
    })),
    ...offlineVideos.map((video) => ({
      ...video,
      score: scorePlaylist(video, skillWords, video.level, goalWords),
    })),
  ];
  const matches = localCandidates
    .filter((video) => !selectedVideoIds.has(video.youtubeId))
    .filter((video) => scorePlaylist(video, skillWords, video.level, goalWords) > 0)
    .filter((video) => isRelevantLearningContent(video, skill, goal))
    .sort((a, b) => b.score - a.score || a.youtubeId.localeCompare(b.youtubeId))
    .filter((video, index, all) =>
      all.findIndex((candidate) => candidate.youtubeId === video.youtubeId) === index)
    .slice(0, 8)
    .map(({ score: _score, ...video }) => video);

  const first = matches[0];
  if (!first) return undefined;
  return {
    candidate: {
      playlistId: `local:${first.youtubeId}`,
      title: `${skill} — lessons already available`,
      description: "Lessons already imported in Skill Tree.",
      channelName: first.channelName,
      thumbnailUrl: first.thumbnailUrl,
      publishedAt: first.publishedAt ?? "",
    },
    content: {
      sourceName: "Skill Tree local library",
      sourceType: "video",
      videos: matches,
    },
  };
}

function chooseBestPlaylist(
  candidates: Array<{
    playlistId: string;
    title: string;
    description: string;
    channelName: string;
    thumbnailUrl: string;
    publishedAt: string;
  }>,
  skill: string,
  level: string,
  goal?: string,
) {
  const skillWords = skill.toLowerCase().split(/\s+/).filter(Boolean);
  return [...candidates]
    .filter((candidate) => isRelevantLearningContent(candidate, skill, goal))
    .sort((a, b) => {
    const scoreDifference = scorePlaylist(b, skillWords, level) - scorePlaylist(a, skillWords, level);
    if (scoreDifference !== 0) return scoreDifference;
    return Date.parse(b.publishedAt || "1970-01-01") - Date.parse(a.publishedAt || "1970-01-01");
  })[0];
}

function rankPlaylists(
  candidates: Array<{
    playlistId: string;
    title: string;
    description: string;
    channelName: string;
    thumbnailUrl: string;
    publishedAt: string;
  }>,
  skill: string,
  level: string,
  goal?: string,
) {
  const skillWords = tokenize(skill);
  const goalWords = tokenize(goal ?? "");
  return [...candidates].sort((a, b) => {
    const scoreDifference =
      scorePlaylist(b, skillWords, level, goalWords) -
      scorePlaylist(a, skillWords, level, goalWords);
    if (scoreDifference !== 0) return scoreDifference;
    return Date.parse(b.publishedAt || "1970-01-01") - Date.parse(a.publishedAt || "1970-01-01");
    });
}

async function searchPlaylistCandidates(skill: string, level: string, goal?: string) {
  const currentYear = new Date().getUTCFullYear();
  const recentWindowStart = `${currentYear - 3}-01-01T00:00:00Z`;
  const goalSuffix = goal ? ` ${goal}` : "";
  const levelQuery = level === "General" ? "" : level;
  const levelAlias = {
    Beginner: "beginner basics fundamentals",
    Intermediate: "intermediate practical projects",
    Advanced: "advanced production professional",
    Expert: "expert masterclass professional",
  }[level] ?? "";
  const queries = [
    {
      query: `${skill} ${levelQuery} tutorial playlist${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "date" as const, publishedAfter: recentWindowStart },
    },
    {
      query: `${skill} ${levelQuery} complete course${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "date" as const, publishedAfter: recentWindowStart },
    },
    {
      query: `${skill} ${levelQuery} tutorial playlist${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "relevance" as const },
    },
    {
      query: `${skill} ${levelQuery} tutorial${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "relevance" as const },
    },
    {
      query: `${skill} ${levelAlias} tutorial playlist${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "relevance" as const },
    },
    {
      query: `${skill} tutorial playlist${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "date" as const, publishedAfter: recentWindowStart },
    },
    {
      query: `${skill} complete course${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "relevance" as const },
    },
    {
      query: `${skill} full course${goalSuffix}`.replace(/\s+/g, " ").trim(),
      options: { order: "relevance" as const },
    },
  ];
  const byId = new Map<string, Awaited<ReturnType<typeof searchYouTubePlaylists>>[number]>();
  for (const [index, { query, options }] of queries.entries()) {
    let results: Awaited<ReturnType<typeof searchYouTubePlaylists>>;
    try {
      results = await searchYouTubePlaylists(query, options);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 403 || status === 429 || status === 503) break;
      throw error;
    }
    for (const result of results) byId.set(result.playlistId, result);
    // Stop after a useful pool is found, but continue through every fallback
    // when early date/level-specific searches are empty.
    if (index >= 2 && byId.size >= 10) break;
  }
  return [...byId.values()];
}





function scorePlaylist(
  candidate: { title: string; description: string; channelName: string; publishedAt?: string },
  skillWords: string[],
  level: string,
  goalWords: string[] = [],
) {
  const text = `${candidate.title} ${candidate.description} ${candidate.channelName}`.toLowerCase();
  let score = 0;
  for (const word of skillWords) if (text.includes(word)) score += 18;
  for (const word of goalWords) if (text.includes(word)) score += 7;
  const levelTerms = {
    Beginner: ["beginner", "basic", "basics", "fundamentals", "from scratch", "for beginners"],
    Intermediate: ["intermediate", "practical", "projects", "workflow"],
    Advanced: ["advanced", "production", "professional", "pro"],
    Expert: ["expert", "masterclass", "professional", "production"],
  }[level] ?? [level.toLowerCase()];
  for (const term of levelTerms) if (text.includes(term)) score += term.length > 8 ? 20 : 15;
  if (text.includes("tutorial")) score += 10;
  if (text.includes("complete") || text.includes("course") || text.includes("full")) score += 12;
  if (text.includes("playlist") || text.includes("series")) score += 5;
  if (text.includes("shorts")) score -= 20;

  const currentYear = new Date().getUTCFullYear();
  const publishedAt = candidate.publishedAt ?? "";
  const publishedYear = Date.parse(publishedAt)
    ? new Date(publishedAt).getUTCFullYear()
    : 0;
  const explicitYear = text.match(/\b(20\d{2})\b/g)?.map(Number).sort((a, b) => b - a)[0] ?? 0;
  const resultYear = Math.max(publishedYear, explicitYear);
  if (resultYear > 0) {
    const age = Math.max(0, currentYear - resultYear);
    score += Math.max(-60, 42 - age * 18);
    if (age >= 2) score -= 18;
  }
  return score;
}

export default router;


