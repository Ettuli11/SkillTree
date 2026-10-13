import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListCategoriesQueryKey,
  type PlaylistLevel,
  type SkillLevel,
  type Video,
  useGetCategory,
  useUpdatePlaylistLevel,
  useUpdateVideoPosition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, ArrowLeft, GripVertical, ListVideo, Loader2, MousePointer2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoCard } from "@/components/shared/VideoCard";
import { VideoPlayerDialog } from "@/components/shared/VideoPlayerDialog";
import { toast } from "sonner";

const playlistLevels = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

type ReorderAction = {
  videoId: number;
  beforeOrder: number[];
  afterOrder: number[];
};

const sameOrder = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const isPointerOnScrollBar = (clientX: number, clientY: number) => {
  if (clientX >= document.documentElement.clientWidth || clientY >= document.documentElement.clientHeight) return true;
  const scrollContainer = document.querySelector<HTMLElement>("[data-app-scroll-container]");
  if (!scrollContainer) return false;
  const rect = scrollContainer.getBoundingClientRect();
  const verticalWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
  const horizontalHeight = scrollContainer.offsetHeight - scrollContainer.clientHeight;
  return (
    (verticalWidth > 0 && clientX >= rect.right - verticalWidth) ||
    (horizontalHeight > 0 && clientY >= rect.bottom - horizontalHeight)
  );
};

export default function PlaylistDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const categoryName = decodeURIComponent(params.name || "");
  const playlistName = decodeURIComponent(params.playlist || "");
  const { data, isLoading, isError } = useGetCategory(categoryName);
  const queryClient = useQueryClient();
  const updatePlaylistLevel = useUpdatePlaylistLevel();
  const updatePosition = useUpdateVideoPosition();
  const [activeLevel, setActiveLevel] = useState<PlaylistLevel | "Tutti">("Tutti");
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<SkillLevel | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteShortcutRequest, setDeleteShortcutRequest] = useState(0);
  const [reorderEnabled, setReorderEnabled] = useState(false);
  const [orderReversed, setOrderReversed] = useState(false);
  const [orderedVideoIds, setOrderedVideoIds] = useState<number[] | null>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [controlsBounds, setControlsBounds] = useState({ left: 0, width: 0 });
  const levelRowRef = useRef<HTMLDivElement>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const undoStackRef = useRef<ReorderAction[]>([]);
  const draggedVideoIdRef = useRef<number | null>(null);
  const dragOriginOrderRef = useRef<number[] | null>(null);
  const previewOrderRef = useRef<number[]>([]);
  const latestDisplayOrderRef = useRef<number[]>([]);
  const pendingSaveRef = useRef(false);
  const pendingFlipRef = useRef<Map<number, DOMRect> | null>(null);

  const videos = useMemo(
    () => data?.videos.filter(
      (video) => video.sourceType === "playlist" && video.sourceName === playlistName,
    ) ?? [],
    [data?.videos, playlistName],
  );
  const optimisticVideos = useMemo(
    () => pendingLevel
      ? videos.map((video) => ({ ...video, level: pendingLevel }))
      : videos,
    [pendingLevel, videos],
  );
  const concreteLevels = useMemo(
    () => playlistLevels.filter((level) => optimisticVideos.some((video) => video.level === level)),
    [optimisticVideos],
  );
  const currentLevel = pendingLevel ?? (concreteLevels.length === 1 ? concreteLevels[0] : "Mista");
  const orderedDisplayVideos = useMemo(() => {
    if (!orderedVideoIds) return optimisticVideos.slice().sort((a, b) => a.position - b.position || a.id - b.id);
    return orderedVideoIds
      .map((id) => optimisticVideos.find((video) => video.id === id))
      .filter((video): video is Video => Boolean(video));
  }, [optimisticVideos, orderedVideoIds]);
  const displayVideos = orderReversed ? [...orderedDisplayVideos].reverse() : orderedDisplayVideos;
  const displayedVideos = activeLevel === "Tutti"
    ? displayVideos
    : displayVideos.filter((video) => video.level === activeLevel);
  const selectedVideos = videos.filter((video) => selectedIds.includes(video.id));
  const serverOrderKey = data?.videos.map((video) => `${video.id}:${video.position}`).join(",");
  latestDisplayOrderRef.current = displayVideos.map((video) => video.id);

  useEffect(() => {
    if (!pendingLevel || updatePlaylistLevel.isPending) return;
    const levels = new Set(videos.map((video) => video.level));
    if (levels.size === 1 && levels.has(pendingLevel)) {
      setPendingLevel(null);
    }
  }, [pendingLevel, updatePlaylistLevel.isPending, videos]);

  useEffect(() => {
    const serverOrder = data?.videos
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((video) => video.id) ?? [];
    if (orderedVideoIds && sameOrder(serverOrder, orderedVideoIds)) {
      setOrderedVideoIds(null);
      previewOrderRef.current = [];
    }
  }, [data?.videos, orderedVideoIds, serverOrderKey]);

  useLayoutEffect(() => {
    const previousRects = pendingFlipRef.current;
    if (!previousRects) return;
    pendingFlipRef.current = null;
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-video-card]"));
    const moved = cards.flatMap((card) => {
      const id = Number(card.dataset.videoId);
      const previous = previousRects.get(id);
      if (!previous) return [];
      const current = card.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return [];
      card.style.transition = "none";
      card.style.willChange = "transform";
      card.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      return [card];
    });
    if (!moved.length) return;
    requestAnimationFrame(() => {
      moved.forEach((card) => {
        card.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        card.style.transform = "translate3d(0, 0, 0)";
      });
      window.setTimeout(() => moved.forEach((card) => {
        if (!card.isConnected) return;
        card.style.transition = "";
        card.style.willChange = "";
        card.style.transform = "";
      }), 240);
    });
  }, [orderedVideoIds]);

  // Pin the level/commands toolbar to the top once it scrolls out of view,
  // same as the skill page: the row keeps its layout slot (placeholder
  // height) while a fixed clone floats above the grid.
  useLayoutEffect(() => {
    const row = controlsRowRef.current;
    const scrollContainer = row?.closest<HTMLElement>("[data-app-scroll-container]");
    if (!row || !scrollContainer) return;

    // Runs at most once per frame and only commits state when something
    // actually changed: without this every scroll tick re-rendered the whole
    // page (dozens of cards) and scrolling dropped to ~20fps.
    let frame: number | null = null;
    const updateToolbarPosition = () => {
      frame = null;
      const rowRect = row.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      const shouldPin = rowRect.top <= scrollRect.top;
      setControlsPinned((prev) => (prev === shouldPin ? prev : shouldPin));
      setControlsHeight((prev) => (prev === rowRect.height ? prev : rowRect.height));
      if (shouldPin) {
        setControlsBounds((prev) =>
          prev.left === rowRect.left && prev.width === rowRect.width
            ? prev
            : { left: rowRect.left, width: rowRect.width },
        );
      }
    };
    const scheduleToolbarUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(updateToolbarPosition);
    };

    updateToolbarPosition();
    scrollContainer.addEventListener("scroll", scheduleToolbarUpdate, { passive: true });
    window.addEventListener("resize", scheduleToolbarUpdate);
    const resizeObserver = new ResizeObserver(scheduleToolbarUpdate);
    resizeObserver.observe(row);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scrollContainer.removeEventListener("scroll", scheduleToolbarUpdate);
      window.removeEventListener("resize", scheduleToolbarUpdate);
      resizeObserver.disconnect();
    };
  }, [data]);

  const levelTabFromTarget = (target: EventTarget | null) => {
    const tab = (target as HTMLElement | null)?.closest?.("[data-level-tab]") ?? null;
    return tab instanceof HTMLElement && levelRowRef.current?.contains(tab) ? tab : null;
  };

  // Same press-hold-drag level scrub as the skill page (its buttons keep
  // their own look; only the gesture is shared). Values rendered here are
  // exactly "Tutti" or a PlaylistLevel, hence the cast below.
  const beginLevelScrub = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const tab = levelTabFromTarget(event.target);
    if (!tab) return;
    scrubPointerRef.current = event.pointerId;
    const value = tab.dataset.levelTab as PlaylistLevel | "Tutti" | undefined;
    if (value && value !== activeLevel) setActiveLevel(value);
  };

  const moveLevelScrub = (event: React.PointerEvent) => {
    if (scrubPointerRef.current === null || scrubPointerRef.current !== event.pointerId) return;
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      scrubPointerRef.current = null;
      return;
    }
    const list = levelRowRef.current;
    if (!list) return;
    const tab = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.("[data-level-tab]") ?? null;
    if (!(tab instanceof HTMLElement) || !list.contains(tab)) return;
    const value = tab.dataset.levelTab as PlaylistLevel | "Tutti" | undefined;
    if (value && value !== activeLevel) setActiveLevel(value);
  };

  const endLevelScrub = (event: React.PointerEvent) => {
    if (scrubPointerRef.current === null || scrubPointerRef.current !== event.pointerId) return;
    scrubPointerRef.current = null;
  };

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(categoryName) }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() }),
    ]);
  };

  const changePlaylistLevel = (level: SkillLevel) => {
    if (updatePlaylistLevel.isPending) return;
    setPendingLevel(level);
    updatePlaylistLevel.mutate(
      { categoryName, playlistName, data: { level } },
      {
        onSuccess: async () => {
          await invalidate();
          setPendingLevel(null);
          setActiveLevel("Tutti");
          toast.success("Difficoltà aggiornata per tutta la playlist");
        },
        onError: () => {
          setPendingLevel(null);
          toast.error("Impossibile aggiornare la difficoltà della playlist");
        },
      },
    );
  };

  const clearSelection = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectedIds([]);
    setSelectionMode(false);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [categoryName, clearSelection, playlistName]);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    const handleBackgroundPointerDown = (event: PointerEvent) => {
      if (isPointerOnScrollBar(event.clientX, event.clientY)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-video-card], [role='menuitem'], [data-selection-control], [data-selection-toolbar]")) return;
      if (target?.closest("[data-theme-toggle]")) return;
      if (target?.closest("button, a")) {
        clearSelection();
        return;
      }
      clearSelection();
    };
    document.addEventListener("pointerdown", handleBackgroundPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleBackgroundPointerDown, true);
  }, [clearSelection, selectedIds.length]);

  useEffect(() => {
    const handleSelectAll = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]")) return;
      if (!videos.length) return;
      event.preventDefault();
      selectionAnchorRef.current = null;
      setSelectedIds(videos.map((video) => video.id));
      setSelectionMode(true);
    };
    window.addEventListener("keydown", handleSelectAll);
    return () => window.removeEventListener("keydown", handleSelectAll);
  }, [videos]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented || reorderEnabled || selectedIds.length === 0) return;
      if (event.key !== "Delete" && event.key !== "Del" && event.code !== "Delete") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]")) return;
      event.preventDefault();
      setDeleteShortcutRequest((value) => value + 1);
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [reorderEnabled, selectedIds.length]);

  const selectableVideos = displayedVideos;
  const handleSelectVideo = (video: Video, mode: "toggle" | "range") => {
    setSelectedIds((current) => {
      if (mode === "range") {
        const ids = selectableVideos.map((item) => item.id);
        const anchor = selectionAnchorRef.current;
        if (anchor === null) {
          selectionAnchorRef.current = video.id;
          return [video.id];
        }
        const start = ids.indexOf(anchor);
        const end = ids.indexOf(video.id);
        if (start < 0 || end < 0) {
          selectionAnchorRef.current = video.id;
          return [video.id];
        }
        return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
      }
      selectionAnchorRef.current = video.id;
      return current.includes(video.id)
        ? current.filter((id) => id !== video.id)
        : [...new Set([...current, video.id])];
    });
  };

  const toggleSelectionMode = () => {
    if (selectedIds.length > 0) {
      clearSelection();
      return;
    }
    setSelectionMode((enabled) => !enabled);
  };

  const handleDragStartVideo = (videoId: number) => {
    const order = latestDisplayOrderRef.current.length
      ? [...latestDisplayOrderRef.current]
      : displayVideos.map((video) => video.id);
    draggedVideoIdRef.current = videoId;
    dragOriginOrderRef.current = order;
    previewOrderRef.current = [...order];
  };

  const handleDragOverVideo = (targetVideoId: number) => {
    if (!reorderEnabled || draggedVideoIdRef.current === null) return;
    const current = previewOrderRef.current;
    const from = current.indexOf(draggedVideoIdRef.current);
    const to = current.indexOf(targetVideoId);
    if (from < 0 || to < 0 || from === to) return;
    pendingFlipRef.current = new Map(
      [...document.querySelectorAll<HTMLElement>("[data-video-card]")].map((card) => [Number(card.dataset.videoId), card.getBoundingClientRect()]),
    );
    const next = [...current];
    const [dragged] = next.splice(from, 1);
    next.splice(to, 0, dragged);
    previewOrderRef.current = next;
    setOrderedVideoIds(next);
  };

  const handleDragEndVideo = () => {
    if (draggedVideoIdRef.current !== null && dragOriginOrderRef.current && !pendingSaveRef.current) {
      setOrderedVideoIds(dragOriginOrderRef.current);
    }
    draggedVideoIdRef.current = null;
    dragOriginOrderRef.current = null;
    previewOrderRef.current = [];
  };

  const buildCategoryOrder = (playlistOrder: number[]) => {
    const playlistIds = new Set(videos.map((video) => video.id));
    const categoryOrder = (data?.videos ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((video) => video.id);
    let playlistIndex = 0;
    return categoryOrder.map((id) => (
      playlistIds.has(id) ? playlistOrder[playlistIndex++] : id
    ));
  };

  const handleDropVideo = async (draggedVideoId: number, targetVideoId: number) => {
    const beforeOrder = dragOriginOrderRef.current ?? displayVideos.map((video) => video.id);
    const current = previewOrderRef.current.length ? previewOrderRef.current : [...beforeOrder];
    if (!current.length) return;
    if (!sameOrder(current, beforeOrder)) {
      // preview already contains the desired order
    } else {
      const from = current.indexOf(draggedVideoId);
      const to = current.indexOf(targetVideoId);
      if (from < 0 || to < 0 || from === to) return;
      const [dragged] = current.splice(from, 1);
      current.splice(to, 0, dragged);
    }
    if (sameOrder(current, beforeOrder)) return;
    const action = { videoId: draggedVideoId, beforeOrder, afterOrder: current };
    pendingSaveRef.current = true;
    setOrderedVideoIds(current);
    try {
      await updatePosition.mutateAsync({
        videoId: draggedVideoId,
        data: { order: buildCategoryOrder(current) },
      });
      undoStackRef.current.push(action);
      await invalidate();
    } catch {
      setOrderedVideoIds(beforeOrder);
      toast.error("Impossibile salvare il nuovo ordine");
    } finally {
      pendingSaveRef.current = false;
    }
  };

  const invertOrder = async () => {
    const beforeOrder = displayVideos.map((video) => video.id);
    const afterOrder = [...beforeOrder].reverse();
    if (sameOrder(beforeOrder, afterOrder) || pendingSaveRef.current) return;

    pendingSaveRef.current = true;
    setOrderedVideoIds(afterOrder);
    setOrderReversed(false);
    try {
      await updatePosition.mutateAsync({
        videoId: afterOrder[0],
        data: { order: buildCategoryOrder(afterOrder) },
      });
      await invalidate();
    } catch {
      setOrderedVideoIds(beforeOrder);
      toast.error("Impossibile salvare il nuovo ordine");
    } finally {
      pendingSaveRef.current = false;
    }
  };

  const undoLastReorder = useCallback(async () => {
    if (!reorderEnabled || updatePosition.isPending) return;
    const action = undoStackRef.current.pop();
    if (!action) return;
    setOrderedVideoIds(action.beforeOrder);
    try {
      await updatePosition.mutateAsync({
        videoId: action.videoId,
        data: { order: buildCategoryOrder(action.beforeOrder) },
      });
      await invalidate();
      toast.success("Ultimo spostamento annullato");
    } catch {
      undoStackRef.current.push(action);
      setOrderedVideoIds(action.afterOrder);
      toast.error("Impossibile annullare lo spostamento");
    }
  }, [reorderEnabled, updatePosition, data?.videos, videos]);

  useEffect(() => {
    if (!reorderEnabled) return;
    const handleUndo = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoLastReorder();
      }
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [reorderEnabled, undoLastReorder]);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-72 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (isError || !data || videos.length === 0) {
    return (
      <div className="mt-10 rounded-3xl border bg-card p-12 text-center shadow-sm">
        <h2 className="mb-2 font-serif text-2xl font-bold">Playlist non trovata</h2>
        <p className="mb-6 text-muted-foreground">Questa playlist non è più disponibile in questa skill.</p>
        <Button asChild><Link href={`/category/${encodeURIComponent(categoryName)}`}>Torna alla skill</Link></Button>
      </div>
    );
  }

  return (
    <div
      className="space-y-8 animate-in fade-in duration-500 pb-12"
      onPointerDownCapture={(event) => {
        if (isPointerOnScrollBar(event.clientX, event.clientY)) return;
        const target = event.target as HTMLElement;
        if (
          target.closest("[data-video-card]") ||
          target.closest("button, a, [role='tab'], [role='menuitem'], [data-selection-control], [data-selection-toolbar]")
        ) return;
        clearSelection();
      }}
    >
      <Link
        href={`/category/${encodeURIComponent(categoryName)}`}
        className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Torna a {categoryName}
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ListVideo className="h-7 w-7" />
            </div>
            <div>
              <Badge variant="outline" className="mb-3 border-primary/20 bg-primary/5 text-[10px] font-bold uppercase tracking-wider text-primary">
                Playlist
              </Badge>
              <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-5xl">{playlistName}</h1>
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                {videos.length} {videos.length === 1 ? "video" : "video"} nella playlist
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Difficoltà playlist</span>
            <Select
              value={currentLevel}
              onValueChange={(value) => changePlaylistLevel(value as SkillLevel)}
              disabled={updatePlaylistLevel.isPending}
            >
              <SelectTrigger className="h-10 w-44 border-primary/25 bg-background px-3 text-xs font-bold uppercase tracking-wider text-primary focus:ring-0">
                {updatePlaylistLevel.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    SALVATAGGIO…
                  </span>
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                {playlistLevels.map((level) => (
                  <SelectItem key={level} value={level} className="text-xs font-medium">{level.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <div
        ref={controlsRowRef}
        data-selection-toolbar
        className="relative z-40"
        style={controlsPinned ? { minHeight: controlsHeight || undefined } : undefined}
      >
        <div
          className={`overflow-hidden border-b border-border/70 bg-background/95 ${controlsPinned ? "py-2 shadow-sm" : "pb-4"}`}
          style={
            controlsPinned
              ? {
                  position: "fixed",
                  top: 0,
                  left: controlsBounds.left,
                  width: controlsBounds.width,
                  zIndex: 40,
                }
              : undefined
          }
        >
          <div
            ref={levelRowRef}
            onPointerDown={beginLevelScrub}
            onPointerMove={moveLevelScrub}
            onPointerUp={endLevelScrub}
            onPointerCancel={endLevelScrub}
            className="flex min-w-0 flex-wrap items-center gap-2"
            data-controls-rail
          >
            <Button
              variant={activeLevel === "Tutti" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveLevel("Tutti")}
              data-level-tab="Tutti"
              className="rounded-xl"
            >
              Tutti <span className="ml-1 opacity-70">{videos.length}</span>
            </Button>
            {concreteLevels.map((level) => {
              const count = videos.filter((video) => video.level === level).length;
              return (
                <Button
                  key={level}
                  variant={activeLevel === level ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveLevel(level)}
                  data-level-tab={level}
                  className="rounded-xl"
                >
                  {level} <span className="ml-1 opacity-70">{count}</span>
                </Button>
              );
            })}
            <div className="ml-auto flex flex-wrap items-center gap-2" data-selection-control>
              <Button
                variant="outline"
                onClick={toggleSelectionMode}
                className={`h-10 rounded-xl border-primary/20 px-3 text-sm font-semibold ${
                  selectionMode || selectedIds.length > 0
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                }`}
                title={selectedIds.length > 0 ? "Deseleziona i video" : "Attiva la selezione"}
              >
                <MousePointer2 className="mr-1.5 h-4 w-4" />
                {selectedIds.length > 0
                  ? `${selectedIds.length} selezionati`
                  : selectionMode
                    ? "Selezione attiva"
                    : "Attiva la selezione"}
                {selectedIds.length > 0 && <X className="ml-1 h-4 w-4" />}
              </Button>
              <Button
                variant={reorderEnabled ? "default" : "outline"}
                onClick={() => setReorderEnabled((enabled) => !enabled)}
                className={`h-10 rounded-xl border-primary/20 px-3 text-sm font-semibold ${
                  reorderEnabled
                    ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                    : "text-primary hover:bg-primary hover:text-primary-foreground"
                }`}
                title="Trascina le card nella posizione desiderata"
              >
                <GripVertical className="mr-1.5 h-4 w-4" />
                {reorderEnabled ? "Fine riordino" : "Riordina"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void invertOrder()}
                className="h-10 rounded-xl border-primary/20 px-3 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                title="Inverti l'ordine dei video"
              >
                <ArrowDownUp className="mr-1.5 h-4 w-4" />
                Inverti ordine
              </Button>
            </div>
          </div>
        </div>
      </div>

      {displayedVideos.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayedVideos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              videos={displayVideos}
              categoryName={categoryName}
              selected={selectedIds.includes(video.id)}
              selectedVideos={selectedVideos}
              selectionMode={selectionMode}
              onSelectVideo={handleSelectVideo}
              reorderEnabled={reorderEnabled}
              onDragStartVideo={handleDragStartVideo}
              onDragOverVideo={handleDragOverVideo}
              onDragEndVideo={handleDragEndVideo}
              onDropVideo={handleDropVideo}
              onSelectionActionComplete={clearSelection}
              deleteShortcutRequest={
                displayedVideos.some((item) => selectedIds.includes(item.id))
                  && displayedVideos.find((item) => selectedIds.includes(item.id))?.id === video.id
                  ? deleteShortcutRequest
                  : 0
              }
              onOpenVideo={(selected) => {
                setSelectedVideo(selected);
                setPlayerOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-border/80 bg-card/40 py-24 text-center">
          <Play className="mx-auto mb-4 h-8 w-8 text-muted-foreground/50" />
          <h3 className="font-serif text-xl font-bold">Nessun video in questa difficoltà</h3>
        </div>
      )}

      <VideoPlayerDialog
        video={selectedVideo ?? videos.find((video) => !video.watched) ?? videos[0] ?? null}
        videos={videos}
        initialVideoId={(selectedVideo ?? videos.find((video) => !video.watched) ?? videos[0])?.id}
        open={playerOpen}
        onOpenChange={setPlayerOpen}
      />
    </div>
  );
}