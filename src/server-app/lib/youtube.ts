import { createHash } from "node:crypto";
import { levelFromText, formatDuration, type SkillLevel } from "./learning";
import { getYouTubeCache, listYouTubeCache, setYouTubeCache } from "./youtube-cache";

/**
 * YouTube Data API is intentionally not used here.
 *
 * Public YouTube pages contain the same public metadata needed by Skill Tree
 * (video IDs, titles, descriptions, channels, durations and playlist items).
 * Reading those pages removes the daily Data API quota from both imports and
 * Learning Coach searches. Results are still cached persistently because
 * YouTube may throttle public pages independently of the Data API.
 */

export type YouTubeVideo = {
  youtubeId: string;
  title: string;
  description: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  level: SkillLevel;
  sourceName: string;
  sourceType: "channel" | "playlist" | "video";
  playlistUrl?: string;
  url: string;
  publishedAt?: string;
};

export type PlaylistSearchResult = {
  playlistId: string;
  title: string;
  description: string;
  channelName: string;
  thumbnailUrl: string;
  publishedAt: string;
};

export type VideoSearchResult = YouTubeVideo;

export type YouTubeErrorCode =
  | "quota_exceeded"
  | "api_key_missing"
  | "unavailable"
  | "invalid_metadata";

type PlaylistSearchOptions = {
  order?: "relevance" | "date";
  publishedAfter?: string;
};

type YouTubePageData = Record<string, unknown> | unknown[];

function cacheKey(kind: string, value: string) {
  return `youtube:${kind}:${createHash("sha256").update(value).digest("hex")}`;
}

function webError(message: string, status = 503, code: YouTubeErrorCode = "unavailable") {
  const error = new Error(message) as Error & { status?: number; code?: YouTubeErrorCode };
  error.status = status;
  error.code = code;
  return error;
}

async function fetchYouTubePage(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw webError(
      "YouTube could not be reached. Check the server connection and retry shortly.",
      503,
      "unavailable",
    );
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw webError(
        "YouTube access is temporarily rate-limited or its quota is exhausted. A cached result will be used when available; otherwise retry later.",
        503,
        "quota_exceeded",
      );
    }
    throw webError(
      `YouTube web search returned HTTP ${response.status}. Please retry shortly.`,
      503,
      "unavailable",
    );
  }

  const html = await response.text();
  if (
    html.length < 10_000 ||
    /unusual traffic|robot|captcha|consent\.youtube\.com/i.test(html) && !html.includes("ytInitialData")
  ) {
    throw webError(
      "YouTube did not return readable public metadata. The page may be temporarily blocking automated requests.",
      503,
      "unavailable",
    );
  }
  return html;
}

function extractAssignedJson(html: string, marker: string): YouTubePageData | undefined {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = html.slice(markerIndex + marker.length).search(/[\[{]/);
  if (start < 0) return undefined;

  const absoluteStart = markerIndex + marker.length + start;
  const opening = html[absoluteStart];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = absoluteStart; index < html.length; index++) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening || (opening === "{" && character === "[")) depth++;
    if (character === closing || (opening === "{" && character === "]")) depth--;
    if (depth === 0) {
      try {
        return JSON.parse(html.slice(absoluteStart, index + 1)) as YouTubePageData;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function pageJson(html: string, marker: string): YouTubePageData {
  const value = extractAssignedJson(html, marker);
  if (!value) {
    throw webError(
      "YouTube returned a page without readable public metadata.",
      503,
      "invalid_metadata",
    );
  }
  return value;
}

function walkNodes(value: unknown, visitor: (key: string, value: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkNodes(item, visitor);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      visitor(key, child as Record<string, unknown>);
    }
    walkNodes(child, visitor);
  }
}

function findNode(value: unknown, key: string) {
  let found: Record<string, unknown> | undefined;
  walkNodes(value, (currentKey, currentValue) => {
    if (!found && currentKey === key) found = currentValue;
  });
  return found;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === "string") return record.simpleText;
  if (typeof record.content === "string") return record.content;
  if (typeof record.text === "string") return record.text;
  if (record.accessibilityData && typeof record.accessibilityData === "object") {
    const label = (record.accessibilityData as Record<string, unknown>).label;
    if (typeof label === "string") return label;
  }
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => (run && typeof run === "object" && typeof (run as Record<string, unknown>).text === "string"
        ? (run as Record<string, unknown>).text
        : ""))
      .join("");
  }
  return "";
}

function thumbnailValue(value: unknown, youtubeId: string) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const thumbnails = record.thumbnails;
    if (Array.isArray(thumbnails)) {
      const best = thumbnails.at(-1);
      if (best && typeof best === "object" && typeof (best as Record<string, unknown>).url === "string") {
        return (best as Record<string, unknown>).url as string;
      }
    }
    const image = record.image;
    if (image && typeof image === "object") {
      const sources = (image as Record<string, unknown>).sources;
      if (Array.isArray(sources)) {
        const best = sources.at(-1);
        if (best && typeof best === "object" && typeof (best as Record<string, unknown>).url === "string") {
          return (best as Record<string, unknown>).url as string;
        }
      }
    }
    const sources = record.sources;
    if (Array.isArray(sources)) {
      const best = sources.at(-1);
      if (best && typeof best === "object" && typeof (best as Record<string, unknown>).url === "string") {
        return (best as Record<string, unknown>).url as string;
      }
    }
  }
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

function parseDurationText(value: string) {
  const parts = value.split(":").map((part) => Number(part.trim()));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parsePublishedAt(value: string) {
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return new Date(absolute).toISOString();
  const year = value.match(/\b(20\d{2})\b/)?.[1];
  if (year) return `${year}-01-01T00:00:00.000Z`;
  const ago = value.match(/(\d+)\s+(day|week|month|year)s?\s+ago/i);
  if (!ago) return "";
  const amount = Number(ago[1]);
  const multiplier = {
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  }[ago[2].toLowerCase() as "day" | "week" | "month" | "year"];
  return new Date(Date.now() - amount * multiplier).toISOString();
}

function collectTextValues(value: unknown): string[] {
  const values: string[] = [];
  walkNodes(value, (key, child) => {
    if (key !== "text") return;
    const text = textValue(child);
    if (text) values.push(text);
  });
  return values;
}

function lockupMetadataValues(metadata: Record<string, unknown> | undefined) {
  const metadataView = metadata ? findNode(metadata, "contentMetadataViewModel") : undefined;
  const values = collectTextValues(metadataView);
  return {
    channelName: values[0] ?? "",
    durationText: values.find((value) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) ?? "",
    publishedText: values.find((value) => /\b(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i.test(value)) ?? "",
  };
}

function videoFromRenderer(
  renderer: Record<string, unknown>,
  sourceName: string,
  sourceType: YouTubeVideo["sourceType"],
): YouTubeVideo | undefined {
  const youtubeId = typeof renderer.videoId === "string" ? renderer.videoId : "";
  if (!youtubeId) return undefined;
  const title = textValue(renderer.title) || "Untitled lesson";
  const description = textValue(renderer.descriptionSnippet);
  const channelName =
    textValue(renderer.ownerText) ||
    textValue(renderer.shortBylineText) ||
    textValue(renderer.longBylineText) ||
    sourceName;
  const durationText = textValue(renderer.lengthText);
  const publishedAt = parsePublishedAt(textValue(renderer.publishedTimeText));
  return {
    youtubeId,
    title,
    description,
    channelName,
    thumbnailUrl: thumbnailValue(renderer.thumbnail, youtubeId),
    durationSeconds: parseDurationText(durationText),
    level: levelFromText(title, description, sourceName),
    sourceName,
    sourceType,
    url: `https://www.youtube.com/watch?v=${youtubeId}`,
    publishedAt,
  };
}

function collectVideos(data: unknown, sourceName: string, sourceType: YouTubeVideo["sourceType"]) {
  const videos = new Map<string, YouTubeVideo>();
  walkNodes(data, (key, renderer) => {
    if (!["videoRenderer", "gridVideoRenderer", "compactVideoRenderer", "playlistVideoRenderer"].includes(key)) return;
    const video = videoFromRenderer(renderer, sourceName, sourceType);
    if (video) videos.set(video.youtubeId, video);
  });
  walkNodes(data, (key, renderer) => {
    if (key !== "lockupViewModel") return;
    const videoId =
      typeof renderer.contentId === "string"
        ? renderer.contentId
        : findVideoId(renderer);
    if (!videoId) return;
    const metadata = findNode(renderer, "lockupMetadataViewModel");
    const lockupValues = lockupMetadataValues(metadata);
    const image = findNode(renderer, "thumbnailViewModel");
    const title = textValue(metadata?.title) || "Untitled lesson";
    const description = textValue(metadata?.description);
    const channelName = textValue(metadata?.byline) || lockupValues.channelName || sourceName;
    const video: YouTubeVideo = {
      youtubeId: videoId,
      title,
      description,
      channelName,
      thumbnailUrl: thumbnailValue(image, videoId),
      durationSeconds: parseDurationText(textValue(metadata?.lengthText) || lockupValues.durationText),
      level: levelFromText(title, description, sourceName),
      sourceName,
      sourceType,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: parsePublishedAt(textValue(metadata?.publishedTimeText) || lockupValues.publishedText),
    };
    videos.set(videoId, video);
  });
  return [...videos.values()];
}

function findVideoId(value: unknown): string | undefined {
  let videoId: string | undefined;
  walkNodes(value, (key, child) => {
    if (videoId || key !== "watchEndpoint") return;
    if (typeof child.videoId === "string") videoId = child.videoId;
  });
  return videoId;
}

function collectPlaylists(data: unknown) {
  const playlists = new Map<string, PlaylistSearchResult>();
  walkNodes(data, (key, renderer) => {
    if (key !== "playlistRenderer" || typeof renderer.playlistId !== "string") return;
    const playlistId = renderer.playlistId;
    playlists.set(playlistId, {
      playlistId,
      title: textValue(renderer.title) || "Untitled playlist",
      description: textValue(renderer.descriptionSnippet),
      channelName: textValue(renderer.shortBylineText) || textValue(renderer.longBylineText) || "YouTube",
      thumbnailUrl: thumbnailValue(renderer.thumbnails, playlistId),
      publishedAt: parsePublishedAt(textValue(renderer.publishedTimeText)),
    });
  });
  // YouTube's current search UI renders playlist results as lockups. The
  // playlist ID lives on the nested watch endpoint rather than on a
  // playlistRenderer node.
  walkNodes(data, (key, renderer) => {
    if (key !== "lockupViewModel") return;
    const playlistId = findPlaylistId(renderer);
    if (!playlistId || playlists.has(playlistId)) return;
    const metadata = findNode(renderer, "lockupMetadataViewModel");
    const title = textValue(metadata?.title);
    if (!title) return;
    playlists.set(playlistId, {
      playlistId,
      title,
      description: textValue(metadata?.description),
      channelName: findMetadataByline(metadata) || "YouTube",
      thumbnailUrl: thumbnailValue(findNode(renderer, "thumbnailViewModel"), playlistId),
      publishedAt: parsePublishedAt(textValue(metadata?.publishedTimeText)),
    });
  });
  return [...playlists.values()];
}

function findPlaylistId(value: unknown): string | undefined {
  let playlistId: string | undefined;
  walkNodes(value, (key, child) => {
    if (playlistId || key !== "watchEndpoint") return;
    if (typeof child.playlistId === "string") playlistId = child.playlistId;
  });
  return playlistId;
}

function findMetadataByline(value: unknown): string {
  let byline = "";
  walkNodes(value, (key, child) => {
    if (byline || key !== "text") return;
    const text = textValue(child);
    if (text && !/^(playlist|video|updated|view full playlist|\d+:\d+)/i.test(text)) {
      byline = text;
    }
  });
  return byline;
}

function sourceTitle(data: unknown, fallback: string) {
  const isGenericTitle = (value: string) =>
    !value || /^(youtube\s+)?playlist$|^untitled playlist$/i.test(value.trim());
  const titleFromNode = (node: Record<string, unknown> | undefined) => {
    if (!node) return "";
    return (
      textValue(node.title) ||
      textValue(node.pageTitle) ||
      textValue(node.playlistTitle) ||
      textValue(node.headerTitle)
    );
  };
  const playlistNodes = [
    "playlistHeaderRenderer",
    "playlistMetadataRenderer",
    "playlistSidebarPrimaryInfoRenderer",
    "playlistViewModel",
    "pageHeaderViewModel",
    "pageHeaderRenderer",
  ];
  for (const nodeName of playlistNodes) {
    const title = titleFromNode(findNode(data, nodeName));
    if (!isGenericTitle(title)) return title;
  }
  const channel = findNode(data, "channelMetadataRenderer");
  const channelTitle = titleFromNode(channel);
  return !isGenericTitle(channelTitle) ? channelTitle : fallback;
}

function htmlPageTitle(html: string): string {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
  return title
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function directVideoFromPlayer(data: YouTubePageData, fallbackUrl: string): YouTubeVideo {
  const details = (data as Record<string, unknown>).videoDetails as Record<string, unknown> | undefined;
  const microformat = findNode(data, "microformat") ?? findNode(data, "playerMicroformatRenderer");
  const youtubeId = typeof details?.videoId === "string" ? details.videoId : new URL(fallbackUrl).searchParams.get("v") ?? "";
  const title = typeof details?.title === "string" ? details.title : "Untitled lesson";
  const description = typeof details?.shortDescription === "string" ? details.shortDescription : "";
  const channelName = typeof details?.author === "string" ? details.author : "YouTube";
  const durationSeconds = Number(details?.lengthSeconds ?? 0);
  const publishedAt = typeof microformat?.publishDate === "string"
    ? `${microformat.publishDate}T00:00:00.000Z`
    : typeof microformat?.uploadDate === "string"
      ? `${microformat.uploadDate}T00:00:00.000Z`
      : "";
  return {
    youtubeId,
    title,
    description,
    channelName,
    thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    level: levelFromText(title, description, channelName),
    sourceName: channelName,
    sourceType: "video",
    url: `https://www.youtube.com/watch?v=${youtubeId}`,
    publishedAt,
  };
}

export async function searchYouTubePlaylists(
  query: string,
  options: PlaylistSearchOptions = {},
): Promise<PlaylistSearchResult[]> {
  const key = cacheKey("playlist-search-web", JSON.stringify({ query, options }));
  const cached = await getYouTubeCache<PlaylistSearchResult[]>(key);
  if (cached?.length) return cached;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} playlist`)}`;
  try {
    const html = await fetchYouTubePage(url);
    const playlists = collectPlaylists(pageJson(html, "ytInitialData"));
    if (playlists.length) await setYouTubeCache(key, playlists, 6 * 60 * 60 * 1000);
    return playlists;
  } catch (error) {
    const stale = await getYouTubeCache<PlaylistSearchResult[]>(key, { allowExpired: true });
    if (stale?.length) return stale;
    throw error;
  }
}

export async function searchYouTubeVideos(
  query: string,
  options: PlaylistSearchOptions = {},
): Promise<VideoSearchResult[]> {
  const key = cacheKey("video-search-web", JSON.stringify({ query, options }));
  const cached = await getYouTubeCache<VideoSearchResult[]>(key);
  if (cached?.length) return cached;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  try {
    const html = await fetchYouTubePage(url);
    const videos = collectVideos(pageJson(html, "ytInitialData"), "YouTube web search", "video");
    if (videos.length) await setYouTubeCache(key, videos, 6 * 60 * 60 * 1000);
    return videos;
  } catch (error) {
    const stale = await getYouTubeCache<VideoSearchResult[]>(key, { allowExpired: true });
    if (stale?.length) return stale;
    throw error;
  }
}

export function parseYouTubeUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Paste a valid YouTube URL.");
  }
  const hostname = url.hostname.replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(hostname)) {
    throw new Error("Only YouTube URLs are supported.");
  }
  // Playlist links often contain both `v` and `list`. The playlist must win,
  // otherwise only the currently selected video is imported.
  const playlistId = url.searchParams.get("list");
  if (playlistId) return { type: "playlist" as const, id: playlistId };
  if (hostname === "youtu.be" || url.searchParams.get("v")) {
    const id = hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
    if (!id) throw new Error("This video URL is missing its video ID.");
    return { type: "video" as const, id };
  }
  const channelMatch = url.pathname.match(/\/(?:@|channel\/|c\/|user\/)([^/]+)/);
  if (channelMatch?.[1]) {
    return {
      type: "channel" as const,
      handle: url.pathname.includes("/@") ? `@${channelMatch[1]}` : channelMatch[1],
    };
  }
  throw new Error("Use a YouTube video, playlist, channel, or @handle URL.");
}

export type YouTubeContent = {
  sourceName: string;
  sourceType: "channel" | "playlist" | "video";
  videos: YouTubeVideo[];
};

export async function cacheOfflineVideos(videos: YouTubeVideo[]): Promise<void> {
  await Promise.all(videos.map((video) =>
    setYouTubeCache(
      `youtube:offline-video:${video.youtubeId}`,
      video,
      10 * 365 * 24 * 60 * 60 * 1000,
    )));
}

export async function getOfflineVideos(): Promise<YouTubeVideo[]> {
  return listYouTubeCache<YouTubeVideo>("youtube:offline-video:");
}

export function getYouTubeAvailability() {
  return "available" as const;
}

export async function fetchYouTubeContent(rawUrl: string): Promise<YouTubeContent> {
  const normalizedUrl = rawUrl.trim();
  const parsed = parseYouTubeUrl(normalizedUrl);
  // Use the parsed source as the cache identity. A playlist shared as
  // /watch?v=...&list=... must share its cache with /playlist?list=...
  // instead of retaining a stale result under the original URL.
  const cacheIdentity = parsed.type === "playlist"
    ? `playlist:${parsed.id}`
    : parsed.type === "video"
      ? `video:${parsed.id}`
      : `channel:${parsed.handle}`;
  const key = cacheKey("content-web-v6", cacheIdentity);
  const cached = await getYouTubeCache<YouTubeContent>(key);
  if (cached?.videos.length) {
    if (parsed.type !== "playlist") return cached;
    const playlistUrl = `https://www.youtube.com/playlist?list=${parsed.id}`;
    return {
      ...cached,
      videos: cached.videos.map((video) => ({ ...video, playlistUrl })),
    };
  }

  const pageUrl = parsed.type === "video"
    ? `https://www.youtube.com/watch?v=${parsed.id}`
    : parsed.type === "playlist"
      ? `https://www.youtube.com/playlist?list=${parsed.id}`
      : normalizedUrl.includes("/videos")
        ? normalizedUrl
        : `${normalizedUrl.replace(/\/$/, "")}/videos`;
  try {
    const html = await fetchYouTubePage(pageUrl);

    if (parsed.type === "video") {
      const player = pageJson(html, "ytInitialPlayerResponse");
      const video = directVideoFromPlayer(player, pageUrl);
      if (!video.youtubeId) {
        throw webError("That YouTube video could not be read.", 503, "invalid_metadata");
      }
      const content = { sourceName: video.channelName, sourceType: "video" as const, videos: [video] };
      await setYouTubeCache(key, content, 7 * 24 * 60 * 60 * 1000);
      return content;
    }

    const data = pageJson(html, "ytInitialData");
    const sourceType = parsed.type;
    const parsedSourceTitle = sourceTitle(data, parsed.type === "playlist" ? "YouTube playlist" : parsed.handle);
    const sourceName = parsed.type === "playlist" && /^(youtube\s+)?playlist$/i.test(parsedSourceTitle)
      ? htmlPageTitle(html) || parsedSourceTitle
      : parsedSourceTitle;
    const videos = collectVideos(data, sourceName, sourceType)
      .slice(0, 100)
      .map((video) => parsed.type === "playlist"
        ? { ...video, playlistUrl: `https://www.youtube.com/playlist?list=${parsed.id}` }
        : video);
    if (!videos.length) {
      throw webError(
        "This YouTube page did not expose any public videos.",
        503,
        "invalid_metadata",
      );
    }
    if (parsed.type === "playlist") {
      const uniqueIds = new Set(videos.map((video) => video.youtubeId));
      const uniqueTitles = new Set(videos.map((video) => video.title));
      const uniqueThumbnails = new Set(videos.map((video) => video.thumbnailUrl));
      if (
        uniqueIds.size !== videos.length ||
        (videos.length > 1 && uniqueTitles.size === 1 && uniqueThumbnails.size === 1)
      ) {
        throw webError(
          "YouTube returned invalid repeated metadata for this playlist.",
          503,
          "invalid_metadata",
        );
      }
    }
    const content = { sourceName, sourceType, videos };
    await setYouTubeCache(key, content, 7 * 24 * 60 * 60 * 1000);
    return content;
  } catch (error) {
    const stale = await getYouTubeCache<YouTubeContent>(key, { allowExpired: true });
    if (stale?.videos.length) {
      if (parsed.type !== "playlist") return stale;
      return {
        ...stale,
        videos: stale.videos.map((video) => ({
          ...video,
          playlistUrl: `https://www.youtube.com/playlist?list=${parsed.id}`,
        })),
      };
    }
    throw error;
  }
}

export function toVideoInsert(video: YouTubeVideo, categoryId: number) {
  return {
    youtubeId: video.youtubeId,
    categoryId,
    title: video.title,
    description: video.description,
    channelName: video.channelName,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
    durationLabel: formatDuration(video.durationSeconds),
    level: video.level,
    sourceName: video.sourceName,
    sourceType: video.sourceType,
    playlistUrl: video.playlistUrl ?? null,
    url: video.url,
  };
}