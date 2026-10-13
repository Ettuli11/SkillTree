import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  Video,
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getListCategoriesQueryKey,
  useUpdateVideoPlayback,
  useUpdateVideoProgress,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type YouTubeStateEvent = { data: number };
type YouTubePlayer = {
  destroy?: () => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  loadVideoById?: (videoId: string, startSeconds?: number) => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events: {
        onStateChange: (event: YouTubeStateEvent) => void;
        onReady?: (event: { target: YouTubePlayer }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;
const PLAYER_IDLE_DELAY_MS = 3800;
const PLAYER_SEEK_STEP_SECONDS = 5;

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<void>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existingScript) {
      const checkReady = () => {
        if (window.YT?.Player) {
          resolve();
        } else {
          window.setTimeout(checkReady, 50);
        }
      };
      checkReady();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      youtubeApiPromise = null;
      reject(new Error("Unable to load the YouTube player API."));
    };
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

interface VideoPlayerDialogProps {
  video: Video | null;
  videos?: Video[];
  initialVideoId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoPlayerDialog({
  video,
  videos = [],
  initialVideoId,
  open,
  onOpenChange,
}: VideoPlayerDialogProps) {
  const playlist = useMemo(() => {
    const items = [...videos, ...(video ? [video] : [])];
    return items.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  }, [video, videos]);
  const firstVideoId = initialVideoId ?? video?.id;
  const [activeVideoId, setActiveVideoId] = useState<number | undefined>(firstVideoId);
  const activeIndex = playlist.findIndex((item) => item.id === activeVideoId);
  const activeVideo = playlist[activeIndex] ?? video;
  const activeVideoRef = useRef<Video | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const completedVideoIds = useRef(new Set<number>());
  const cursorTimerRef = useRef<number | null>(null);
  const keyboardSeekSuppressControlsRef = useRef(false);
  const queryClient = useQueryClient();
  const updatePlayback = useUpdateVideoPlayback();
  const updateProgress = useUpdateVideoProgress();
  const updatePlaybackRef = useRef(updatePlayback);
  const updateProgressRef = useRef(updateProgress);
  const playerVideoIdRef = useRef<number | null>(null);
  const playerDurationsRef = useRef(new Map<number, number>());
  const lastSavedPlaybackRef = useRef<{
    videoId: number;
    seconds: number;
    durationSeconds: number;
  } | null>(null);
  const playbackPositionsRef = useRef(new Map<number, number>());
  const [playbackState, setPlaybackState] = useState<"playing" | "paused" | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerIdle, setPlayerIdle] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [playerError, setPlayerError] = useState(false);

  activeVideoRef.current = activeVideo ?? null;
  updatePlaybackRef.current = updatePlayback;
  updateProgressRef.current = updateProgress;

  const saveCurrentPlayback = useCallback(() => {
    const player = playerRef.current;
    const videoId = playerVideoIdRef.current;
    if (!player || videoId === null) return;

    let currentTime: number;
    let durationSeconds = playerDurationsRef.current.get(videoId) ?? 0;
    try {
      const getCurrentTime = player.getCurrentTime;
      if (typeof getCurrentTime !== "function") return;
      currentTime = getCurrentTime.call(player);
      const getDuration = player.getDuration;
      if (typeof getDuration === "function") {
        const loadedDuration = getDuration.call(player);
        if (Number.isFinite(loadedDuration) && loadedDuration > 0) {
          durationSeconds = Math.round(loadedDuration);
          playerDurationsRef.current.set(videoId, durationSeconds);
        }
      }
    } catch {
      return;
    }
    if (!Number.isFinite(currentTime)) return;

    const rawSeconds = Math.max(0, Math.round(currentTime));
    const seconds = durationSeconds > 0
      ? Math.min(rawSeconds, durationSeconds)
      : rawSeconds;
    playbackPositionsRef.current.set(videoId, seconds);
    const previousSave = lastSavedPlaybackRef.current;
    if (
      previousSave?.videoId === videoId
      && previousSave.seconds === seconds
      && previousSave.durationSeconds === durationSeconds
    ) return;

    lastSavedPlaybackRef.current = { videoId, seconds, durationSeconds };
    updatePlaybackRef.current.mutate(
      {
        videoId,
        data: {
          seconds,
          ...(durationSeconds > 0 ? { durationSeconds } : {}),
        },
      },
      {
        onError: () => {
          if (
            lastSavedPlaybackRef.current?.videoId === videoId &&
            lastSavedPlaybackRef.current.seconds === seconds
            && lastSavedPlaybackRef.current.durationSeconds === durationSeconds
          ) {
            lastSavedPlaybackRef.current = null;
          }
        },
        onSuccess: (savedVideo) => {
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(savedVideo.categoryName) });
        },
      },
    );
  }, [queryClient]);

  const destroyPlayer = useCallback(() => {
    const player = playerRef.current;
    const host = playerHostRef.current;

    playerRef.current = null;
    playerHostRef.current = null;
    playerVideoIdRef.current = null;

    if (!player || !host?.isConnected || typeof player.destroy !== "function") return;

    try {
      player.destroy();
    } catch {
      // YouTube may have already removed its iframe while React/Radix was
      // unmounting the dialog. The host is going away, so there is nothing
      // left to clean up and this teardown must remain non-fatal.
    }
  }, []);

  const navigateToVideo = useCallback((videoId: number | undefined) => {
    if (videoId === undefined || videoId === activeVideoId) return;
    saveCurrentPlayback();
    setActiveVideoId(videoId);
  }, [activeVideoId, saveCurrentPlayback]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) saveCurrentPlayback();
    onOpenChange(nextOpen);
  }, [onOpenChange, saveCurrentPlayback]);

  useEffect(() => {
    if (open) setActiveVideoId(firstVideoId);
  }, [firstVideoId, open]);

  useEffect(() => {
    if (!open) return;
    const saveWhenLeavingPage = () => saveCurrentPlayback();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveCurrentPlayback();
    };

    window.addEventListener("pagehide", saveWhenLeavingPage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", saveWhenLeavingPage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [open, saveCurrentPlayback]);

  const scheduleCursorHide = useCallback(() => {
    if (cursorTimerRef.current !== null) {
      window.clearTimeout(cursorTimerRef.current);
    }
    keyboardSeekSuppressControlsRef.current = false;
    setPlayerIdle(false);
    cursorTimerRef.current = window.setTimeout(() => {
      setPlayerIdle(true);
      cursorTimerRef.current = null;
    }, PLAYER_IDLE_DELAY_MS);
  }, []);

  const handlePlayerActivity = useCallback(() => {
    scheduleCursorHide();
  }, [scheduleCursorHide]);

  const hidePlayerControls = useCallback(() => {
    if (cursorTimerRef.current !== null) {
      window.clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
    setPlayerIdle(true);
  }, []);

  const togglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    try {
      if (playbackState === "playing") {
        player.pauseVideo?.();
      } else {
        player.playVideo?.();
      }
      scheduleCursorHide();
    } catch {
      toast.error("Impossibile controllare la riproduzione");
    }
  }, [playbackState, scheduleCursorHide]);

  const updatePlaybackTime = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    try {
      const nextCurrentTime = player.getCurrentTime?.();
      const nextDuration = player.getDuration?.();
      if (typeof nextCurrentTime === "number" && Number.isFinite(nextCurrentTime)) {
        setCurrentTime(Math.max(0, nextCurrentTime));
      }
      if (typeof nextDuration === "number" && Number.isFinite(nextDuration) && nextDuration > 0) {
        const durationSeconds = Math.round(nextDuration);
        setDuration(nextDuration);
        playerDurationsRef.current.set(playerVideoIdRef.current ?? -1, durationSeconds);
        // Persist as soon as YouTube reveals the real duration. This covers
        // a seek followed immediately by pause or closing the dialog.
        saveCurrentPlayback();
      }
    } catch {
      // The YouTube API can briefly expose a partially initialized player.
    }
  }, [saveCurrentPlayback]);

  const seekVideo = useCallback((seconds: number, revealControls = true) => {
    const player = playerRef.current;
    if (!player || duration <= 0) return;

    const nextTime = Math.min(Math.max(0, seconds), duration);
    const shouldKeepPlaying = playbackState === "playing";
    try {
      player.seekTo?.(nextTime, true);
      if (shouldKeepPlaying) {
        player.playVideo?.();
      }
      setCurrentTime(nextTime);
      if (revealControls) {
        scheduleCursorHide();
      }
    } catch {
      toast.error("Impossibile spostarsi nel video");
    }
  }, [duration, playbackState, scheduleCursorHide]);

  const skipVideo = useCallback((amount: number, revealControls = true) => {
    seekVideo(currentTime + amount, revealControls);
  }, [currentTime, seekVideo]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input:not([type='range']), textarea, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        handleOpenChange(false);
      } else if ((event.key === " " || event.code === "Space") && !event.repeat) {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowRight" || event.code === "ArrowRight") {
        event.preventDefault();
        keyboardSeekSuppressControlsRef.current = true;
        hidePlayerControls();
        skipVideo(PLAYER_SEEK_STEP_SECONDS, false);
      } else if (event.key === "ArrowLeft" || event.code === "ArrowLeft") {
        event.preventDefault();
        keyboardSeekSuppressControlsRef.current = true;
        hidePlayerControls();
        skipVideo(-PLAYER_SEEK_STEP_SECONDS, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenChange, hidePlayerControls, open, skipVideo, togglePlayback]);

  useEffect(() => {
    if (!open || playbackState !== "playing") return;
    updatePlaybackTime();
    const timer = window.setInterval(updatePlaybackTime, 250);
    return () => window.clearInterval(timer);
  }, [open, playbackState, updatePlaybackTime]);

  useEffect(() => {
    if (!open || playbackState !== "playing") return;
    const timer = window.setInterval(saveCurrentPlayback, 5000);
    return () => window.clearInterval(timer);
  }, [open, playbackState, saveCurrentPlayback]);

  useEffect(() => () => {
    if (cursorTimerRef.current !== null) {
      window.clearTimeout(cursorTimerRef.current);
    }
  }, []);

  const markVideoCompleted = useCallback((videoToComplete: Video | undefined) => {
    if (!videoToComplete || videoToComplete.watched || completedVideoIds.current.has(videoToComplete.id)) {
      return;
    }

    completedVideoIds.current.add(videoToComplete.id);
    updateProgressRef.current.mutate(
      { videoId: videoToComplete.id, data: { watched: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(videoToComplete.categoryName) });
          toast.success("Video segnato come completato");
        },
        onError: () => {
          completedVideoIds.current.delete(videoToComplete.id);
          toast.error("Impossibile salvare il completamento del video");
        },
      },
    );
  }, [queryClient]);

  useEffect(() => {
    if (!open || !activeVideo) return;
    let cancelled = false;
    setUseIframeFallback(false);
    setPlayerError(false);

    void loadYouTubeApi()
      .then(() => {
        const videoToLoad = activeVideoRef.current;
        if (cancelled || !videoToLoad || !playerContainerRef.current || !window.YT?.Player) return;
        const savedSeconds = playbackPositionsRef.current.get(videoToLoad.id) ?? videoToLoad.playbackSeconds;
        const resumeSeconds = Math.max(0, Math.round(savedSeconds) - 10);
        if (playerRef.current) {
          saveCurrentPlayback();
          destroyPlayer();
        }
        const host = playerContainerRef.current;
        host.replaceChildren();
        setPlaybackState(null);
         setCurrentTime(resumeSeconds);
         setDuration(0);
        playerVideoIdRef.current = videoToLoad.id;
        playerHostRef.current = host;
        playerRef.current = new window.YT.Player(host, {
          videoId: videoToLoad.youtubeId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            enablejsapi: 1,
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: ({ target }) => {
              if (resumeSeconds > 0 && typeof target.seekTo === "function") {
                target.seekTo(resumeSeconds, true);
              }
              const loadedDuration = target.getDuration?.();
              if (typeof loadedDuration === "number" && Number.isFinite(loadedDuration)) {
                setDuration(loadedDuration);
              }
              updatePlaybackTime();
            },
            onStateChange: (event) => {
              // YouTube's IFrame API reports 1=playing, 2=paused and
              // 0=ended. Start the one shared controls timer only when
              // YouTube confirms that playback has actually started.
              if (event.data === 1) {
                setPlaybackState("playing");
                if (!keyboardSeekSuppressControlsRef.current) {
                  scheduleCursorHide();
                }
                updatePlaybackTime();
              }
              if (event.data === 2) {
                setPlaybackState("paused");
                saveCurrentPlayback();
                updatePlaybackTime();
              }
              if (event.data === 0) {
                saveCurrentPlayback();
                updatePlaybackTime();
                markVideoCompleted(activeVideoRef.current ?? undefined);
              }
            },
            onError: () => setPlayerError(true),
          },
        });
      })
      .catch(() => {
        // Keep a normal iframe fallback if the optional API script is unavailable.
        if (!cancelled) {
          setUseIframeFallback(true);
          scheduleCursorHide();
        }
      });

    return () => {
      cancelled = true;
      saveCurrentPlayback();
      destroyPlayer();
    };
  }, [
    destroyPlayer,
    markVideoCompleted,
    open,
    saveCurrentPlayback,
    scheduleCursorHide,
    updatePlaybackTime,
  ]);

  useEffect(() => {
    if (!open) return;

    const handleDocumentPointerMove = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && playerContainerRef.current?.contains(target)) {
        handlePlayerActivity();
      }
    };

    document.addEventListener("pointermove", handleDocumentPointerMove, true);
    return () => document.removeEventListener("pointermove", handleDocumentPointerMove, true);
  }, [handlePlayerActivity, open]);

  useEffect(() => {
    if (!open || !activeVideo || !playerRef.current) return;
    if (playerVideoIdRef.current === activeVideo.id) return;

    const savedSeconds = playbackPositionsRef.current.get(activeVideo.id) ?? activeVideo.playbackSeconds;
    const resumeSeconds = Math.max(0, Math.round(savedSeconds) - 10);
    saveCurrentPlayback();
    setPlayerError(false);
    setPlaybackState(null);
    setCurrentTime(resumeSeconds);
    setDuration(0);
    playerVideoIdRef.current = activeVideo.id;

    try {
      playerRef.current.loadVideoById?.(activeVideo.youtubeId, resumeSeconds);
    } catch {
      setPlayerError(true);
    }
  }, [activeVideo?.id, activeVideo?.playbackSeconds, activeVideo?.youtubeId, open, saveCurrentPlayback]);

  useEffect(() => {
    if (open) return;
    destroyPlayer();
  }, [destroyPlayer, open]);

  useEffect(() => {
    return () => {
      destroyPlayer();
    };
  }, [destroyPlayer]);

  const handleSurfaceClick = useCallback((event: { target: EventTarget | null }) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, a, input, textarea, select, [role='button']")
    ) {
      return;
    }
    togglePlayback();
  }, [togglePlayback]);

  if (!activeVideo) return null;

  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < playlist.length - 1;
  // Keep every player control on the exact same visibility class. This is
  // intentionally shared instead of using separate opacity transitions for
  // the center button and the navigation bar.
  const playerControlsVisibility = playerIdle
    ? "pointer-events-none opacity-0 transition-opacity duration-700 ease-out"
    : "opacity-100 transition-opacity duration-700 ease-out";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onPointerMove={handlePlayerActivity}
        onClick={handleSurfaceClick}
        className={`[&>button]:hidden !fixed !inset-0 !left-0 !top-0 !h-screen !max-h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 !gap-0 !overflow-hidden !rounded-none !border-0 !bg-black !p-0 text-white shadow-none ${
          playerIdle ? "cursor-none [&_*]:cursor-none" : "cursor-default"
        }`}
      >
        <DialogTitle className="sr-only">{activeVideo.title}</DialogTitle>
        <div
          className={`absolute inset-x-0 top-0 z-20 flex items-start gap-4 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-5 pb-10 pt-5 pr-16 transition-opacity duration-200 sm:px-8 sm:pt-6 ${
            playerIdle ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold sm:text-xl">{activeVideo.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60 sm:text-sm">
              <span>{activeVideo.channelName}</span>
              <span>•</span>
              <span>{activeVideo.durationLabel}</span>
              <span>•</span>
              <span>{activeVideo.level}</span>
              {playlist.length > 1 && (
                <>
                  <span>•</span>
                  <span>Video {activeIndex + 1} di {playlist.length}</span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
             onClick={() => handleOpenChange(false)}
            aria-label="Esci dal video"
            title="Esci dal video"
            className="group mt-[-0.25rem] shrink-0 rounded-full border border-white/15 bg-black/35 p-2.5 text-white/70 backdrop-blur transition-all duration-200 hover:scale-105 hover:border-white/35 hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            <X className="h-5 w-5 transition-transform duration-200 group-hover:rotate-90" />
          </button>
        </div>

         <div
           className={`relative h-full w-full bg-black [&_iframe]:pointer-events-none ${playerIdle ? "player-idle cursor-none [&_iframe]:cursor-none" : "cursor-default [&_iframe]:cursor-default"}`}
           onPointerMove={handlePlayerActivity}
           onPointerDown={handlePlayerActivity}
         >
          {useIframeFallback ? (
            <iframe
              key={activeVideo.id}
               className={`h-full w-full ${playerIdle ? "cursor-none" : "cursor-default"}`}
                src={`https://www.youtube.com/embed/${activeVideo.youtubeId}?autoplay=1&controls=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&rel=0&modestbranding=1&playsinline=1&start=${Math.max(0, Math.round((playbackPositionsRef.current.get(activeVideo.id) ?? activeVideo.playbackSeconds) - 10))}`}
              title={activeVideo.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div ref={playerContainerRef} className="h-full w-full" />
          )}
           {playerError && (
             <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-6 text-center">
              <div className="max-w-md space-y-4">
                <p className="text-lg font-semibold">Questo video non può essere riprodotto qui.</p>
                <p className="text-sm text-white/65">
                  Aprilo direttamente su YouTube per continuare la visione.
                </p>
                <a
                  href={activeVideo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-85"
                >
                  Apri su YouTube
                </a>
              </div>
            </div>
          )}
        </div>

        <div
          className={`absolute inset-0 z-10 ${playerControlsVisibility}`}
        >
          <button
            type="button"
            onClick={togglePlayback}
            onPointerDown={handlePlayerActivity}
            aria-label={playbackState === "playing" ? "Metti in pausa" : "Riproduci video"}
            title={playbackState === "playing" ? "Pausa" : "Riproduci"}
            className="player-center-control pointer-events-auto absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/75 text-white shadow-2xl ring-1 ring-white/30 backdrop-blur-sm transition-[background-color,box-shadow] duration-500 hover:bg-black/85 hover:shadow-[0_0_40px_rgba(255,255,255,0.18)] focus:outline-none focus:ring-2 focus:ring-white/80 sm:h-16 sm:w-16"
          >
            {playbackState === "playing" ? (
              <Pause key="pause" className="player-control-icon h-6 w-6 fill-current sm:h-7 sm:w-7" />
            ) : (
              <Play key="play" className="player-control-icon ml-1 h-6 w-6 fill-current sm:h-7 sm:w-7" />
            )}
          </button>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-5 pb-6 pt-16 sm:px-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-2">
              <div className="flex items-center gap-3 text-xs font-medium tabular-nums text-white/80">
                <span className="min-w-10 text-right">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 1)}
                  step={0.1}
                  value={Math.min(currentTime, Math.max(duration, 1))}
                  onChange={(event) => seekVideo(Number(event.target.value))}
                  onPointerDown={handlePlayerActivity}
                  disabled={duration <= 0}
                  aria-label="Posizione del video"
                  className="player-progress h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
                />
                <span className="min-w-10">{formatTime(duration)}</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => skipVideo(-PLAYER_SEEK_STEP_SECONDS)}
                  onPointerDown={handlePlayerActivity}
                  disabled={duration <= 0}
                  aria-label="Torna indietro di 5 secondi"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
              {canGoPrevious && (
                <Button
                  variant="outline"
                  onClick={() => navigateToVideo(playlist[activeIndex - 1]?.id)}
                  className="h-9 rounded-full border-white/20 bg-black/45 px-4 text-sm text-white backdrop-blur hover:bg-white/15 hover:text-white"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
              )}
              {canGoNext && (
                <Button
                  onClick={() => navigateToVideo(playlist[activeIndex + 1]?.id)}
                  className="h-9 rounded-full bg-primary px-4 text-sm text-primary-foreground shadow-lg hover:bg-primary/90"
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
                <button
                  type="button"
                  onClick={() => skipVideo(PLAYER_SEEK_STEP_SECONDS)}
                  onPointerDown={handlePlayerActivity}
                  disabled={duration <= 0}
                  aria-label="Avanza di 5 secondi"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className={`absolute inset-0 z-[5] bg-transparent ${
            playerIdle ? "cursor-none" : "cursor-default"
          }`}
          onPointerMove={handlePlayerActivity}
          onPointerDown={handlePlayerActivity}
          style={{ cursor: playerIdle ? "none" : undefined }}
        />

      </DialogContent>
    </Dialog>
  );
}