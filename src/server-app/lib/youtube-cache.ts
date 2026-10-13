import { and, eq, gt, like } from "drizzle-orm";
import { db, youtubeCacheTable } from "@workspace/db";

export async function getYouTubeCache<T>(
  cacheKey: string,
  options: { allowExpired?: boolean } = {},
): Promise<T | undefined> {
  const [entry] = await db
    .select()
    .from(youtubeCacheTable)
    .where(options.allowExpired
      ? eq(youtubeCacheTable.cacheKey, cacheKey)
      : and(
        eq(youtubeCacheTable.cacheKey, cacheKey),
        gt(youtubeCacheTable.expiresAt, new Date()),
      ));

  if (!entry) return undefined;
  try {
    return JSON.parse(entry.payload) as T;
  } catch {
    await db.delete(youtubeCacheTable).where(eq(youtubeCacheTable.cacheKey, cacheKey));
    return undefined;
  }
}

export async function listYouTubeCache<T>(prefix: string): Promise<T[]> {
  const entries = await db
    .select()
    .from(youtubeCacheTable)
    .where(like(youtubeCacheTable.cacheKey, `${prefix}%`));
  const values: T[] = [];
  for (const entry of entries) {
    try {
      values.push(JSON.parse(entry.payload) as T);
    } catch {
      await db.delete(youtubeCacheTable).where(eq(youtubeCacheTable.cacheKey, entry.cacheKey));
    }
  }
  return values;
}

export async function setYouTubeCache(cacheKey: string, payload: unknown, ttlMs: number): Promise<void> {
  await db
    .insert(youtubeCacheTable)
    .values({
      cacheKey,
      payload: JSON.stringify(payload),
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .onConflictDoUpdate({
      target: youtubeCacheTable.cacheKey,
      set: {
        payload: JSON.stringify(payload),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
}