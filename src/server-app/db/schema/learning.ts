import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const appStateTable = pgTable(
  "skillpath_app_state",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
  },
);

export const youtubeCacheTable = pgTable(
  "skillpath_youtube_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    payload: text("payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
);

export const categoriesTable = pgTable(
  "skillpath_categories",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    favorite: boolean("favorite").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull().default(0),
  },
  (table) => [uniqueIndex("skillpath_categories_name_idx").on(table.name)],
);

export const videosTable = pgTable(
  "skillpath_videos",
  {
    id: serial("id").primaryKey(),
    youtubeId: text("youtube_id").notNull(),
    categoryId: integer("category_id").notNull().references(() => categoriesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    channelName: text("channel_name").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    durationLabel: text("duration_label").notNull().default("0:00"),
    level: text("level").notNull().default("Beginner"),
    levelOverridden: boolean("level_overridden").notNull().default(false),
    playlistRestoreLevel: text("playlist_restore_level"),
    playlistWasMixed: boolean("playlist_was_mixed").notNull().default(false),
    watched: boolean("watched").notNull().default(false),
    playbackSeconds: integer("playback_seconds").notNull().default(0),
    favorite: boolean("favorite").notNull().default(false),
    position: integer("position").notNull().default(0),
    sourceName: text("source_name").notNull(),
    sourceType: text("source_type").notNull(),
    playlistUrl: text("playlist_url"),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("skillpath_videos_youtube_category_idx").on(table.youtubeId, table.categoryId)],
);

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true, createdAt: true });
export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categoriesTable.$inferSelect;
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;