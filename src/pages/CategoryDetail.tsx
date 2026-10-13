import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useParams, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListCategoriesQueryKey,
  useGetCategory,
  useDeleteVideo,
  useUpdateVideoPosition,
  useUpdateVideoSources,
  type Video,
  type VideoSourceUpdate,
} from '@workspace/api-client-react';
import { VideoCard } from '@/components/shared/VideoCard';
import { PlaylistCard } from '@/components/shared/PlaylistCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownUp, ChevronLeft, GraduationCap, GripVertical, ListVideo, MousePointer2, Play, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoPlayerDialog } from '@/components/shared/VideoPlayerDialog';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { mergeVisibleOrder, moveItem, resolveDropOrder } from '@/lib/reorder';

const getVisibleVideoCardRects = () => {
  const rects = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>("[data-reorder-card]").forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const key = card.dataset.reorderKey;
    if (key) rects.set(key, rect);
  });
  return rects;
};

type ReorderAction = {
  videoId: number;
  beforeOrder: number[];
  afterOrder: number[];
  beforePosition: number;
  afterPosition: number;
};

type PositionSave = {
  videoId: number;
  order: number[];
  action: ReorderAction;
};

type ReorderItem = {
  key: string;
  videoIds: number[];
  playlistName?: string;
};

type SourceHistoryAction = {
  kind: "source";
  before: VideoSourceUpdate[];
  after: VideoSourceUpdate[];
};

type HistoryAction =
  | { kind: "reorder"; action: ReorderAction }
  | SourceHistoryAction;

const sameOrder = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const sameKeyOrder = (left: string[], right: string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);

const isPointerOnScrollBar = (clientX: number, clientY: number) => {
  if (
    clientX >= document.documentElement.clientWidth ||
    clientY >= document.documentElement.clientHeight
  ) {
    return true;
  }

  const scrollContainer = document.querySelector<HTMLElement>("[data-app-scroll-container]");
  if (!scrollContainer) return false;

  const rect = scrollContainer.getBoundingClientRect();
  const verticalScrollbarWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
  const horizontalScrollbarHeight = scrollContainer.offsetHeight - scrollContainer.clientHeight;

  return (
    (verticalScrollbarWidth > 0 && clientX >= rect.right - verticalScrollbarWidth) ||
    (horizontalScrollbarHeight > 0 && clientY >= rect.bottom - horizontalScrollbarHeight)
  );
};

const toolLabelClass = "inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-300 ease-out group-hover:ml-1.5 group-hover:max-w-[14rem] group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[14rem] group-focus-visible:opacity-100 2xl:ml-1.5 2xl:max-w-[14rem] 2xl:opacity-100";

export default function CategoryDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const categoryName = decodeURIComponent(params.name || '');
  const { data, isLoading, isError } = useGetCategory(categoryName);
  const queryClient = useQueryClient();
  const [playerOpen, setPlayerOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [activeLevel, setActiveLevel] = useState('All');
  const tabsListRef = useRef<HTMLDivElement>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const [levelPill, setLevelPill] = useState({ left: 0, width: 0, ready: false });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteShortcutRequest, setDeleteShortcutRequest] = useState(0);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteInProgress, setBulkDeleteInProgress] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ completed: 0, total: 0 });
  const [bulkDeleteFailed, setBulkDeleteFailed] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const [controlsPinned, setControlsPinned] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(0);
  const [controlsBounds, setControlsBounds] = useState({ left: 0, width: 0 });
  const [reorderEnabled, setReorderEnabled] = useState(false);
  const [orderReversed, setOrderReversed] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [compressName, setCompressName] = useState("");
  const compressionDialogOpenRef = useRef(false);
  const compressionSelectionRef = useRef<number[]>([]);
  const compressionSubmitRef = useRef(false);
  const bulkDeleteSelectionRef = useRef<number[]>([]);
  const [compressionInProgress, setCompressionInProgress] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ completed: 0, total: 0 });
  const [orderedVideoIds, setOrderedVideoIds] = useState<number[] | null>(null);
  const updatePosition = useUpdateVideoPosition();
  const updateVideoSources = useUpdateVideoSources();
  const deleteVideo = useDeleteVideo();
  const undoStackRef = useRef<HistoryAction[]>([]);
  const positionSaveQueueRef = useRef<PositionSave[]>([]);
  const positionSaveActiveRef = useRef(false);
  const optimisticOrderRef = useRef<number[] | null>(null);
  const draggedVideoIdRef = useRef<number | null>(null);
  const dragOriginOrderRef = useRef<number[] | null>(null);
  const previewOrderRef = useRef<number[]>([]);
  const latestDisplayOrderRef = useRef<number[]>([]);
  const pendingFlipRef = useRef<Map<string, DOMRect> | null>(null);
  const flipFrameRef = useRef<number | null>(null);
  const flipGenRef = useRef(0);
  const flipCardGenRef = useRef(new Map<HTMLElement, number>());
  const dragDropHandledRef = useRef(false);
  const draggedItemKeyRef = useRef<string | null>(null);
  const dragOriginItemOrderRef = useRef<string[] | null>(null);
  const dragOriginVisibleItemOrderRef = useRef<string[] | null>(null);
  const previewItemOrderRef = useRef<string[]>([]);
  const selectionAnchorRef = useRef<number | null>(null);
  const playlistSelectionAnchorRef = useRef<string | null>(null);
  const selectedVideos = data?.videos.filter((video) => selectedIds.includes(video.id)) ?? [];
  const serverOrderKey = data?.videos.map((video) => `${video.id}:${video.position}`).join(",");

  useEffect(() => {
    const serverOrder = data?.videos
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((video) => video.id) ?? [];
    const optimisticOrder = optimisticOrderRef.current;

    // A response for an earlier save must not replace a newer local drag.
    // Keep the optimistic order until the server catches up with it.
    if (optimisticOrder?.length) {
      if (sameOrder(serverOrder, optimisticOrder)) {
        optimisticOrderRef.current = null;
        setOrderedVideoIds(null);
        previewOrderRef.current = [];
        previewItemOrderRef.current = [];
      }
      return;
    }

    setOrderedVideoIds(null);
    previewOrderRef.current = [];
    previewItemOrderRef.current = [];
  }, [data?.videos, serverOrderKey]);

  useLayoutEffect(() => {
    const previousRects = pendingFlipRef.current;
    if (!previousRects) return;
    pendingFlipRef.current = null;

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-reorder-card]")).filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const movedCards = cards.flatMap((card) => {
      const videoId = Number(card.dataset.videoId);
      const key = card.dataset.reorderKey ?? `video:${videoId}`;
      const previousRect = previousRects.get(key);
      if (!previousRect) return [];

      const currentRect = card.getBoundingClientRect();
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return [];

      card.style.transition = "none";
      card.style.willChange = "transform";
      card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      return [card];
    });

    if (movedCards.length === 0) return;
    if (flipFrameRef.current !== null) cancelAnimationFrame(flipFrameRef.current);
    flipFrameRef.current = requestAnimationFrame(() => {
      flipFrameRef.current = null;
      movedCards.forEach((card) => {
        card.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        card.style.transform = "translate3d(0, 0, 0)";
      });
      const generation = flipGenRef.current + 1;
      flipGenRef.current = generation;
      movedCards.forEach((card) => {
        flipCardGenRef.current.set(card, generation);
      });
      window.setTimeout(() => {
        movedCards.forEach((card) => {
          if (!card.isConnected) return;
          if (flipCardGenRef.current.get(card) !== generation) return;
          flipCardGenRef.current.delete(card);
          card.style.transition = "";
          card.style.willChange = "";
          card.style.transform = "";
        });
      }, 240);
    });
  }, [orderedVideoIds]);

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

  // Glide the liquid-glass pill behind the active level tab. Re-measured on
  // every level change plus resizes (window resize, fonts loading, zoom).
  // NOTE: must stay above the early returns below (Rules of Hooks).
  useLayoutEffect(() => {
    const list = tabsListRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(`[data-level-tab="${activeLevel}"]`);
      if (!active) return;
      const left = active.offsetLeft;
      const width = active.offsetWidth;
      setLevelPill((prev) =>
        prev.ready && prev.left === left && prev.width === width
          ? prev
          : { left, width, ready: true },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(list);
    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver.disconnect();
    };
  }, [activeLevel]);

  const enqueuePositionSave = useCallback((entry: PositionSave) => {
    // A rapid series of drops can make earlier queued positions obsolete.
    // Keep the latest intent so the network never becomes a visible cooldown.
    positionSaveQueueRef.current = [entry];
    if (positionSaveActiveRef.current) return;

    positionSaveActiveRef.current = true;
    void (async () => {
      while (true) {
        const current = positionSaveQueueRef.current.shift();
        if (!current) {
          break;
        }

        try {
          await updatePosition.mutateAsync({
            videoId: current.videoId,
            data: { order: current.order },
          });
          undoStackRef.current.push({ kind: "reorder", action: current.action });
        } catch {
          positionSaveQueueRef.current = [];
          optimisticOrderRef.current = current.action.beforeOrder;
          setOrderedVideoIds(current.action.beforeOrder);
          toast.error("Impossibile salvare il nuovo ordine");
          break;
        }
      }

      positionSaveActiveRef.current = false;
    })();
  }, [updatePosition]);

  useEffect(() => {
    // Radix Dialog owns pointer events while the compression dialog is open.
    // Do not let the document-level selection listener clear the selected
    // videos when the user clicks the dialog label, input, or buttons.
    if (selectedIds.length === 0 || compressOpen) return;
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (compressionDialogOpenRef.current) return;
      if (isPointerOnScrollBar(event.clientX, event.clientY)) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest("[data-video-card]") ||
        target?.closest("[data-playlist-card]") ||
        target?.closest("[role='menuitem'], [data-selection-control], [data-selection-toolbar]")
      ) {
        return;
      }
      if (target?.closest("[data-theme-toggle]")) return;
      if (target?.closest("button, a")) {
        clearSelection();
        return;
      }
      clearSelection();
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  }, [compressOpen, selectedIds.length]);

  const invalidateCategoryData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(categoryName) }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() }),
    ]);
  }, [categoryName, queryClient]);

  const undoLastAction = useCallback(async () => {
    if (updatePosition.isPending || updateVideoSources.isPending) return;
    const historyAction = undoStackRef.current.pop();
    if (!historyAction) return;

    try {
      if (historyAction.kind === "reorder") {
        optimisticOrderRef.current = historyAction.action.beforeOrder;
        setOrderedVideoIds(historyAction.action.beforeOrder);
        await updatePosition.mutateAsync({
          videoId: historyAction.action.videoId,
          data: { order: historyAction.action.beforeOrder },
        });
        toast.success("Ultimo spostamento annullato");
      } else {
        await updateVideoSources.mutateAsync({
          categoryName,
          data: { updates: historyAction.before },
        });
        await invalidateCategoryData();
        selectionAnchorRef.current = null;
        playlistSelectionAnchorRef.current = null;
        setSelectedIds([]);
        setSelectionMode(false);
        toast.success("Ultima azione annullata");
      }
    } catch {
      undoStackRef.current.push(historyAction);
      if (historyAction.kind === "reorder") {
        optimisticOrderRef.current = historyAction.action.afterOrder;
        setOrderedVideoIds(historyAction.action.afterOrder);
      }
      toast.error("Impossibile annullare l'ultima azione");
    }
  }, [categoryName, invalidateCategoryData, updatePosition, updateVideoSources]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], [role='dialog']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoLastAction();
      }
    };

    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [undoLastAction]);

  useEffect(() => {
    const handleSelectAllShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]",
        )
      ) {
        return;
      }

      const categoryVideoIds = data?.videos.map((video) => video.id) ?? [];
      if (categoryVideoIds.length === 0) return;

      event.preventDefault();
      selectionAnchorRef.current = null;
      setSelectedIds(categoryVideoIds);
      setSelectionMode(true);
    };

    window.addEventListener("keydown", handleSelectAllShortcut);
    return () => window.removeEventListener("keydown", handleSelectAllShortcut);
  }, [data?.videos]);

  useEffect(() => {
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || reorderEnabled || selectedIds.length === 0) return;
      if (event.key !== "Delete" && event.key !== "Del" && event.code !== "Delete") return;

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]",
        )
      ) {
        return;
      }

      event.preventDefault();
      setDeleteShortcutRequest((request) => request + 1);
    };

    window.addEventListener("keydown", handleDeleteShortcut);
    return () => window.removeEventListener("keydown", handleDeleteShortcut);
  }, [reorderEnabled, selectedIds.length]);

  const openBulkDeleteDialog = useCallback(() => {
    if (selectedIds.length === 0 || bulkDeleteInProgress) return;
    bulkDeleteSelectionRef.current = [...selectedIds];
    setBulkDeleteProgress({ completed: 0, total: selectedIds.length });
    setBulkDeleteFailed(false);
    setBulkDeleteOpen(true);
  }, [bulkDeleteInProgress, selectedIds]);

  useEffect(() => {
    if (deleteShortcutRequest > 0) {
      openBulkDeleteDialog();
    }
  }, [deleteShortcutRequest, openBulkDeleteDialog]);

  const removeSelectedVideos = async () => {
    if (bulkDeleteInProgress) return;
    const idsToDelete = [...bulkDeleteSelectionRef.current];
    if (idsToDelete.length === 0) return;

    setBulkDeleteInProgress(true);
    setBulkDeleteFailed(false);
    setBulkDeleteProgress({ completed: 0, total: idsToDelete.length });

    try {
      for (const videoId of idsToDelete) {
        await deleteVideo.mutateAsync({ videoId });
        setBulkDeleteProgress((current) => ({
          ...current,
          completed: current.completed + 1,
        }));
      }
      await invalidateCategoryData();
      bulkDeleteSelectionRef.current = [];
      setBulkDeleteOpen(false);
      setBulkDeleteProgress({ completed: 0, total: 0 });
      clearSelection();
      toast.success(`${idsToDelete.length} video eliminati dalla skill`);
    } catch {
      setBulkDeleteFailed(true);
      toast.error("Impossibile eliminare tutti i video");
    } finally {
      setBulkDeleteInProgress(false);
    }
  };

  const clearSelection = useCallback(() => {
    if (compressionDialogOpenRef.current) {
      setSelectedIds(compressionSelectionRef.current);
      setSelectionMode(true);
      return;
    }
    selectionAnchorRef.current = null;
    playlistSelectionAnchorRef.current = null;
    setSelectedIds([]);
    setSelectionMode(false);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [categoryName, clearSelection]);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-72 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-12 text-center bg-card rounded-3xl border shadow-sm mt-10">
        <h2 className="text-2xl font-serif font-bold mb-2">Track Not Found</h2>
        <p className="text-muted-foreground mb-6">This skill track might not exist or failed to load.</p>
        <Button asChild><Link href="/">Return to Dashboard</Link></Button>
      </div>
    );
  }

  const { category, videos } = data;
  const levels = ['All', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];
  const orderedDisplayVideos = orderedVideoIds
    ? [...videos].sort((a, b) => orderedVideoIds.indexOf(a.id) - orderedVideoIds.indexOf(b.id))
    : [...videos].sort((a, b) => a.position - b.position || a.id - b.id);
  const displayVideos = orderReversed ? [...orderedDisplayVideos].reverse() : orderedDisplayVideos;
  latestDisplayOrderRef.current = displayVideos.map((video) => video.id);

  const uncompletedVideo = videos.find(v => !v.watched);
  const selectableVideos = activeLevel === "All"
    ? displayVideos
    : displayVideos.filter((item) => item.level === activeLevel);

  const invertOrder = () => {
    const beforeOrder = displayVideos.map((video) => video.id);
    const afterOrder = [...beforeOrder].reverse();
    if (sameOrder(beforeOrder, afterOrder)) return;

    // Inversion is a persistent reorder, not a temporary presentation mode.
    // Store the effective order and render it directly so a reload keeps it.
    optimisticOrderRef.current = afterOrder;
    setOrderedVideoIds(afterOrder);
    setOrderReversed(false);
    enqueuePositionSave({
      videoId: afterOrder[0],
      order: afterOrder,
      action: {
        videoId: afterOrder[0],
        beforeOrder,
        afterOrder,
        beforePosition: 0,
        afterPosition: afterOrder.length - 1,
      },
    });
  };

  const playlistGroups = new Map<string, Video[]>();
  for (const video of displayVideos) {
    if (video.sourceType !== "playlist") continue;
    playlistGroups.set(video.sourceName, [
      ...(playlistGroups.get(video.sourceName) ?? []),
      video,
    ]);
  }
  const displayOrderIndex = new Map(displayVideos.map((video, index) => [video.id, index]));

  const buildReorderItems = (videoList: Video[], level: string): ReorderItem[] => {
    const items: ReorderItem[] = [];
    const seenPlaylists = new Set<string>();

    for (const video of videoList) {
      if (video.sourceType === "playlist") {
        const playlistVideos = playlistGroups.get(video.sourceName) ?? [];
        if (seenPlaylists.has(video.sourceName)) continue;
        if (level !== "All" && !playlistVideos.some((item) => item.level === level)) continue;
        seenPlaylists.add(video.sourceName);
        items.push({
          key: `playlist:${video.sourceName}`,
          playlistName: video.sourceName,
          videoIds: playlistVideos.map((item) => item.id),
        });
        continue;
      }
      if (level !== "All" && video.level !== level) continue;
      items.push({ key: `video:${video.id}`, videoIds: [video.id] });
    }

    return items;
  };

  const reorderItemsForActiveLevel = buildReorderItems(displayVideos, activeLevel);
  const allReorderItems = buildReorderItems(displayVideos, "All");
  const reorderItemsByKey = new Map(allReorderItems.map((item) => [item.key, item]));
  const mergeVisibleReorderItems = (visibleKeys: string[]) =>
    mergeVisibleOrder(
      allReorderItems.map((item) => item.key),
      visibleKeys,
    );

  const selectedPlaylistNames = new Set(
    [...playlistGroups.entries()]
      .filter(([, playlistVideos]) => playlistVideos.some((video) => selectedIds.includes(video.id)))
      .map(([playlistName]) => playlistName),
  );
  const selectedStandaloneCount = selectedIds.filter((videoId) => {
    const video = videos.find((item) => item.id === videoId);
    return video?.sourceType !== "playlist";
  }).length;
  const selectedItemCount = reorderEnabled
    ? selectedIds.length
    : selectedPlaylistNames.size + selectedStandaloneCount;
  const selectionLabel = selectedItemCount === 1
    ? (selectedPlaylistNames.size === 1 ? "1 selezionata" : "1 selezionato")
    : `${selectedItemCount} selezionati`;

  const selectPlaylist = (playlistVideos: Video[], mode: "toggle" | "range") => {
    const playlistIds = playlistVideos.map((video) => video.id);
    const playlistNames = [...playlistGroups.entries()]
      .sort(([, left], [, right]) => (
        Math.min(...left.map((video) => displayOrderIndex.get(video.id) ?? Number.MAX_SAFE_INTEGER)) -
        Math.min(...right.map((video) => displayOrderIndex.get(video.id) ?? Number.MAX_SAFE_INTEGER))
      ))
      .map(([playlistName]) => playlistName);

    setSelectedIds((current) => {
      if (mode === "range") {
        const targetName = playlistVideos[0]?.sourceName;
        const anchorName = playlistSelectionAnchorRef.current;
        if (!targetName || !anchorName) {
          playlistSelectionAnchorRef.current = targetName ?? null;
          return playlistIds;
        }
        const anchorIndex = playlistNames.indexOf(anchorName);
        const targetIndex = playlistNames.indexOf(targetName);
        if (anchorIndex < 0 || targetIndex < 0) {
          playlistSelectionAnchorRef.current = targetName;
          return playlistIds;
        }
        const selectedPlaylistNames = new Set(
          playlistNames.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1),
        );
        return [
          ...new Set([
            ...current.filter((id) => !playlistGroupsByNameHasId(selectedPlaylistNames, id)),
            ...[...playlistGroups.entries()]
              .filter(([name]) => selectedPlaylistNames.has(name))
              .flatMap(([, group]) => group.map((video) => video.id)),
          ]),
        ];
      }

      playlistSelectionAnchorRef.current = playlistVideos[0]?.sourceName ?? null;
      const allSelected = playlistIds.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !playlistIds.includes(id))
        : [...new Set([...current, ...playlistIds])];
    });
  };

  const playlistGroupsByNameHasId = (names: Set<string>, videoId: number) =>
    [...playlistGroups.entries()].some(([name, group]) =>
      names.has(name) && group.some((video) => video.id === videoId),
    );

  const handleSelectVideo = (video: Video, mode: "toggle" | "range") => {
    setSelectedIds((current) => {
      if (mode === "range") {
        const orderedIds = selectableVideos.map((item) => item.id);
        if (selectionAnchorRef.current === null) {
          selectionAnchorRef.current = video.id;
          return [video.id];
        }

        const anchorId = selectionAnchorRef.current;
        const anchorIndex = orderedIds.indexOf(anchorId);
        const targetIndex = orderedIds.indexOf(video.id);

        if (anchorIndex < 0 || targetIndex < 0) {
          selectionAnchorRef.current = video.id;
          return [video.id];
        }

        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        return orderedIds.slice(start, end + 1);
      }

      selectionAnchorRef.current = video.id;
      return current.includes(video.id)
        ? current.filter((id) => id !== video.id)
        : [...current, video.id];
    });
  };

  const applySourceAction = async (
    before: VideoSourceUpdate[],
    after: VideoSourceUpdate[],
    successMessage: string,
  ): Promise<boolean> => {
    if (updateVideoSources.isPending || after.length === 0) return false;
    try {
      await updateVideoSources.mutateAsync({
        categoryName,
        data: { updates: after },
      });
      undoStackRef.current.push({ kind: "source", before, after });
      await invalidateCategoryData();
      clearSelection();
      toast.success(successMessage);
      return true;
    } catch (error) {
      console.error("Failed to update video grouping", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Impossibile aggiornare il raggruppamento dei video",
      );
      return false;
    }
  };

  const toSourceUpdate = (video: Video): VideoSourceUpdate => ({
    videoId: video.id,
    sourceType: video.sourceType === "channel" ? "channel" : video.sourceType,
    sourceName: video.sourceName,
    playlistUrl: video.playlistUrl ?? null,
  });

  const extractPlaylist = async (playlistVideos: Video[]) => {
    const before = playlistVideos.map(toSourceUpdate);
    const after = playlistVideos.map((video) => ({
      videoId: video.id,
      sourceType: "video" as const,
      sourceName: "YouTube video",
      playlistUrl: null,
    }));
    return applySourceAction(before, after, "Playlist estratta nella skill");
  };

  const openCompressDialog = () => {
    if (selectedStandaloneCount < 2) {
      toast.error("Seleziona almeno due video per creare una playlist");
      return;
    }
    compressionSelectionRef.current = [...selectedIds];
    compressionDialogOpenRef.current = true;
    setCompressName("");
    setCompressOpen(true);
  };

  const closeCompressDialog = () => {
    if (compressionInProgress || compressionSubmitRef.current) return;
    compressionDialogOpenRef.current = false;
    compressionSelectionRef.current = [];
    setCompressionProgress({ completed: 0, total: 0 });
    setCompressOpen(false);
  };

  const compressSelectedVideos = async () => {
    if (compressionSubmitRef.current || updateVideoSources.isPending) return;
    const name = compressName.trim();
    if (!name) {
      toast.error("Inserisci il nome della playlist");
      return;
    }
    if (playlistGroups.has(name)) {
      toast.error("Esiste già una playlist con questo nome");
      return;
    }
    const selectedIdsForCompression = compressionSelectionRef.current.length
      ? compressionSelectionRef.current
      : selectedIds;
    const selected = videos.filter((video) => selectedIdsForCompression.includes(video.id));
    if (selected.length < 2 || selected.some((video) => video.sourceType === "playlist")) {
      toast.error("Seleziona almeno due video per creare una playlist");
      return;
    }
    const before = selected.map(toSourceUpdate);
    const after = selected.map((video) => ({
      videoId: video.id,
      sourceType: "playlist" as const,
      sourceName: name,
      playlistUrl: null,
    }));
    compressionSubmitRef.current = true;
    setCompressionInProgress(true);
    setCompressionProgress({ completed: 0, total: selected.length });

    const progressTimer = window.setInterval(() => {
      setCompressionProgress((current) => ({
        ...current,
        completed: Math.min(current.completed + 1, Math.max(current.total - 1, 0)),
      }));
    }, 180);

    try {
      const succeeded = await applySourceAction(before, after, "Video compressi nella playlist");
      window.clearInterval(progressTimer);
      if (succeeded) {
        setCompressionProgress((current) => ({ ...current, completed: current.total }));
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        compressionDialogOpenRef.current = false;
        compressionSelectionRef.current = [];
        setCompressOpen(false);
        setSelectedIds([]);
        setSelectionMode(false);
      }
    } finally {
      window.clearInterval(progressTimer);
      setCompressionInProgress(false);
      setCompressionProgress({ completed: 0, total: 0 });
      compressionSubmitRef.current = false;
    }
  };

  const toggleSelectionMode = () => {
    if (selectedIds.length > 0) {
      clearSelection();
      return;
    }
    setSelectionMode((enabled) => !enabled);
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (compressionDialogOpenRef.current) return;
    if (isPointerOnScrollBar(event.clientX, event.clientY)) return;

    const target = event.target as HTMLElement;
    if (
      target.closest("[data-video-card]") ||
      target.closest("[data-playlist-card]") ||
      target.closest(
        "button, a, [role='tab'], [role='menuitem'], [data-selection-control], [data-selection-toolbar]",
      )
    ) {
      return;
    }
    clearSelection();
  };

  const levelTabFromTarget = (target: EventTarget | null) => {
    const tab = (target as HTMLElement | null)?.closest?.("[data-level-tab]") ?? null;
    return tab instanceof HTMLElement && tabsListRef.current?.contains(tab) ? tab : null;
  };

  const selectLevelTabAtPoint = (clientX: number, clientY: number) => {
    const list = tabsListRef.current;
    if (!list) return;
    const tab = document
      .elementFromPoint(clientX, clientY)
      ?.closest?.("[data-level-tab]") ?? null;
    if (!(tab instanceof HTMLElement) || !list.contains(tab)) return;
    const value = tab.dataset.levelTab;
    if (!value || value === activeLevel) return;
    setActiveLevel(value);
    // On narrow viewports the row scrolls horizontally: keep the selected
    // tab in view so a continuous scrub can walk hand-over-hand to far tabs.
    // block:"nearest" never moves the page vertically while scrubbing.
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  // Press-hold-drag across the level tabs selects whatever tab is under the
  // pointer (liquid-glass segmented control feel). No pointer capture and no
  // document listeners: touch gets implicit capture for free, and for mouse
  // the move handler self-heals when the button is released outside
  // (buttons === 0). Taps and keyboard selection keep working as before.
  const beginLevelScrub = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const tab = levelTabFromTarget(event.target);
    // eslint-disable-next-line no-console
    console.debug(`[dbg-scrub] down ok tab=${tab?.dataset.levelTab ?? "null"}`);
    if (!tab) return;
    scrubPointerRef.current = event.pointerId;
    const value = tab.dataset.levelTab;
    if (value && value !== activeLevel) setActiveLevel(value);
  };

  const moveLevelScrub = (event: React.PointerEvent) => {
    if (scrubPointerRef.current === null || scrubPointerRef.current !== event.pointerId) return;
    if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
      scrubPointerRef.current = null;
      return;
    }
    selectLevelTabAtPoint(event.clientX, event.clientY);
  };

  const endLevelScrub = (event: React.PointerEvent) => {
    if (scrubPointerRef.current === null || scrubPointerRef.current !== event.pointerId) return;
    scrubPointerRef.current = null;
  };

  const expandReorderItems = (keys: string[]) =>
    keys.flatMap((key) => reorderItemsByKey.get(key)?.videoIds ?? []);
  const handleDragStartItem = (key: string) => {
    const currentOrder = optimisticOrderRef.current?.length
      ? [...optimisticOrderRef.current]
      : displayVideos.map((video) => video.id);
    const currentVideos = currentOrder
      .map((id) => videos.find((video) => video.id === id))
      .filter((video): video is Video => Boolean(video));
    const currentItems = buildReorderItems(currentVideos, "All");
    const currentKeys = currentItems.map((item) => item.key);
    const visibleKeys = buildReorderItems(currentVideos, activeLevel).map((item) => item.key);
    draggedItemKeyRef.current = key;
    dragOriginItemOrderRef.current = currentKeys;
    dragOriginVisibleItemOrderRef.current = visibleKeys;
    previewItemOrderRef.current = [...visibleKeys];
    dragOriginOrderRef.current = expandReorderItems(currentKeys);
    dragDropHandledRef.current = false;
  };

  const handleDragOverItem = (targetKey: string) => {
    const draggedKey = draggedItemKeyRef.current;
    if (!reorderEnabled || draggedKey === null || draggedKey === targetKey) return;

    const currentKeys = previewItemOrderRef.current.length
      ? previewItemOrderRef.current
      : reorderItemsForActiveLevel.map((item) => item.key);
    const fromIndex = currentKeys.indexOf(draggedKey);
    const toIndex = currentKeys.indexOf(targetKey);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    // Retarget any in-flight FLIP animation: clear its inline styles first so
    // the First rects below are the true layout positions, not mid-flight
    // transforms. Everything happens before the next paint, and the layout
    // effect re-applies a fresh invert, so there is no flash.
    document.querySelectorAll<HTMLElement>("[data-reorder-card]").forEach((card) => {
      card.style.transition = "none";
      card.style.transform = "";
      card.style.willChange = "";
    });

    pendingFlipRef.current = getVisibleVideoCardRects();

    const nextOrder = moveItem(currentKeys, fromIndex, toIndex);
    previewItemOrderRef.current = nextOrder;
    setOrderedVideoIds(expandReorderItems(mergeVisibleReorderItems(nextOrder)));
  };

  const handleDragEndItem = () => {
    if (!dragDropHandledRef.current && dragOriginOrderRef.current) {
      // Glide back to the origin instead of snapping: measure first so the
      // FLIP effect below animates from the current on-screen positions.
      document.querySelectorAll<HTMLElement>("[data-reorder-card]").forEach((card) => {
        card.style.transition = "none";
        card.style.transform = "";
        card.style.willChange = "";
      });
      pendingFlipRef.current = getVisibleVideoCardRects();
      setOrderedVideoIds(dragOriginOrderRef.current);
    }
    draggedItemKeyRef.current = null;
    dragOriginOrderRef.current = null;
    dragOriginItemOrderRef.current = null;
    dragOriginVisibleItemOrderRef.current = null;
    previewItemOrderRef.current = [];
    dragDropHandledRef.current = false;
  };

  const handleDropItem = async (draggedKey: string, targetKey: string, isDirectHit = false) => {
    const beforeItemOrder = dragOriginItemOrderRef.current ?? allReorderItems.map((item) => item.key);
    const beforeVisibleItemOrder = dragOriginVisibleItemOrderRef.current
      ?? reorderItemsForActiveLevel.map((item) => item.key);
    const beforeOrder = dragOriginOrderRef.current ?? expandReorderItems(beforeItemOrder);
    const draggedItem = reorderItemsByKey.get(draggedKey);
    const draggedVideoId = draggedItem?.videoIds[0];
    if (!draggedVideoId) return;
    const beforePosition = beforeOrder.indexOf(draggedVideoId);
    if (beforePosition < 0) return;

    // The live preview is authoritative: it already contains every processed
    // hover, so the drop commits it as-is. Re-applying a direct release hit
    // on top of it would move twice (overshoot by one card lands two slots
    // away). Only a fast flick with no interleaved preview resolves the
    // release point against the origin order; a release over the dragged
    // card's own slot, a gap, or outside the grid keeps the last preview.
    const currentItemOrder = resolveDropOrder(
      beforeVisibleItemOrder,
      previewItemOrderRef.current,
      draggedKey,
      targetKey,
      isDirectHit,
    );
    const afterItemOrder = mergeVisibleReorderItems(currentItemOrder);
    const afterOrder = expandReorderItems(afterItemOrder);
    const afterPosition = afterOrder.indexOf(draggedVideoId);
    if (
      afterPosition < 0 ||
      beforePosition === afterPosition ||
      sameKeyOrder(currentItemOrder, beforeVisibleItemOrder)
    ) {
      // The release implies no net move: revert any live preview so the
      // rendered grid matches the saved order instead of stranding the
      // preview with nothing saved.
      dragDropHandledRef.current = true;
      if (
        previewItemOrderRef.current.length > 0 &&
        !sameKeyOrder(previewItemOrderRef.current, beforeVisibleItemOrder)
      ) {
        document.querySelectorAll<HTMLElement>("[data-reorder-card]").forEach((card) => {
          card.style.transition = "none";
          card.style.transform = "";
          card.style.willChange = "";
        });
        pendingFlipRef.current = getVisibleVideoCardRects();
        setOrderedVideoIds(beforeOrder);
      }
      return;
    }

    dragDropHandledRef.current = true;
    optimisticOrderRef.current = afterOrder;
    // Animate the commit from the cards' current on-screen positions instead
    // of snapping when the release target differs from the last preview.
    document.querySelectorAll<HTMLElement>("[data-reorder-card]").forEach((card) => {
      card.style.transition = "none";
      card.style.transform = "";
      card.style.willChange = "";
    });
    pendingFlipRef.current = getVisibleVideoCardRects();
    setOrderedVideoIds(afterOrder);
    enqueuePositionSave({
      videoId: draggedVideoId,
      order: afterOrder,
      action: {
        videoId: draggedVideoId,
        beforeOrder,
        afterOrder,
        beforePosition,
        afterPosition,
      },
    });
  };

  return (
    <div
      className="space-y-8 animate-in fade-in duration-500 pb-12"
      onPointerDownCapture={handleBackgroundPointerDown}
    >
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors py-2 px-3 -ml-3 rounded-lg hover:bg-primary/5">
        <ChevronLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      <header className="bg-card border-border/50 border rounded-[2rem] p-8 md:p-12 shadow-sm relative overflow-hidden group">
        <div className="absolute -top-12 -right-12 p-12 opacity-[0.02] text-primary pointer-events-none group-hover:scale-105 group-hover:opacity-[0.03] transition-all duration-1000">
          <GraduationCap className="w-96 h-96" />
        </div>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-10">
          <div className="space-y-5 flex-1 max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary uppercase tracking-widest">
              Skill Track
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold tracking-tight text-foreground leading-tight">
              {category.name}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-base text-muted-foreground font-medium">
              <span className="flex items-center gap-1.5">
                <Play className="w-4 h-4" /> {category.totalVideos} videos
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
              <span className="text-foreground">{category.watchedVideos} completed</span>
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
              <span className="text-primary">{videos.filter(v => !v.watched).length} remaining</span>
            </div>
            
            {uncompletedVideo && (
              <div className="pt-4">
                 <Button
                   onClick={() => setPlayerOpen(true)}
                   className="h-12 rounded-xl px-6 font-semibold shadow-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/20 active:translate-y-0 active:scale-[0.98]"
                 >
                  <Play className="w-4 h-4 mr-2 fill-current" /> Continue Learning
                </Button>
              </div>
            )}
          </div>
          
          <div className="w-full lg:w-80 bg-background/50 backdrop-blur p-6 rounded-2xl border border-border/50 space-y-4 shadow-sm">
            <div className="flex items-center justify-between font-serif">
              <span className="text-lg font-bold">Mastery</span>
              <span className="text-3xl font-bold text-primary">{Math.round(category.progressPercent)}%</span>
            </div>
            <Progress value={category.progressPercent} className="h-3 rounded-full" />
            <div className="flex justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">
              <span>Novice</span>
              <span>Expert</span>
            </div>
          </div>
        </div>
      </header>

      <Tabs value={activeLevel} onValueChange={setActiveLevel} className="space-y-8">
        <div
          ref={controlsRowRef}
          className="relative z-40"
          style={controlsPinned ? { minHeight: controlsHeight || undefined } : undefined}
        >
           <div
             className="overflow-hidden border-b border-border/60 bg-background/98 py-2 shadow-sm"
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
             <div className="flex min-w-0 items-center gap-2" data-controls-rail>
              <TabsList
                ref={tabsListRef}
                onPointerDown={beginLevelScrub}
                onPointerMove={moveLevelScrub}
                onPointerUp={endLevelScrub}
                onPointerCancel={endLevelScrub}
                className="relative inline-flex max-w-full flex-nowrap justify-start overflow-x-auto rounded-xl border bg-card/80 p-1 shadow-sm touch-pan-y [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
              <span
                aria-hidden
                data-testid="level-pill"
                className="absolute inset-y-1 rounded-lg bg-primary shadow-md transition-[left,width] duration-200 ease-out"
                style={{ left: levelPill.left, width: levelPill.width, opacity: levelPill.ready ? 1 : 0 }}
              />
             {levels.map(level => (
               <TabsTrigger
                 key={level}
                 value={level}
                 data-level-tab={level}
                  className="relative min-w-0 shrink-0 rounded-lg px-2 py-2 text-[11px] font-semibold whitespace-nowrap transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 active:translate-y-0 active:scale-[0.98] data-[state=active]:bg-transparent data-[state=active]:text-primary-foreground data-[state=active]:shadow-none data-[state=active]:hover:bg-transparent data-[state=active]:hover:text-primary-foreground sm:px-2.5 sm:text-xs 2xl:px-4 2xl:py-2.5 2xl:text-sm"
               >
                 {level}
               </TabsTrigger>
             ))}
           </TabsList>
           <div
            data-selection-toolbar
            onPointerDownCapture={(event) => event.stopPropagation()}
              className="shrink-0 pb-0.5"
          >
              <div className="flex min-w-0 flex-nowrap items-center gap-2" data-selection-control>
              <Button
                variant="outline"
                onClick={toggleSelectionMode}
                 className={`group h-9 shrink-0 whitespace-nowrap rounded-xl border-primary/20 px-2 text-xs font-semibold 2xl:h-10 2xl:px-3 2xl:text-sm ${
                  selectionMode || selectedIds.length > 0
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                }`}
                title={
                  selectedIds.length > 0
                    ? "Deseleziona i video"
                    : selectionMode
                      ? "Esci dalla modalità selezione"
                        : "Attiva la selezione"
                }
              >
                 <MousePointer2 className="h-4 w-4 shrink-0" />
                 <span className={toolLabelClass}>
                   {selectedIds.length > 0
                     ? selectionLabel
                     : selectionMode
                       ? "Selezione attiva"
                       : "Attiva la selezione"}
                 </span>
                {selectedIds.length > 0 && <X className="h-4 w-4" />}
              </Button>

              <Button
                variant={reorderEnabled ? "default" : "outline"}
                onClick={() => setReorderEnabled((enabled) => !enabled)}
                 className={`group h-9 shrink-0 whitespace-nowrap rounded-xl border-primary/20 px-2 text-xs font-semibold 2xl:h-10 2xl:px-3 2xl:text-sm ${
                  reorderEnabled
                    ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                    : "text-primary hover:bg-primary hover:text-primary-foreground"
                }`}
                title="Trascina le card nella posizione desiderata"
              >
                 <GripVertical className="h-4 w-4 shrink-0" />
                 <span className={toolLabelClass}>{reorderEnabled ? "Fine riordino" : "Riordina"}</span>
              </Button>

               {selectedStandaloneCount >= 2 && !reorderEnabled && (
                 <Button
                   variant="outline"
                   onClick={openCompressDialog}
                   className="group h-9 shrink-0 whitespace-nowrap rounded-xl border-primary/20 px-2 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground 2xl:h-10 2xl:px-3 2xl:text-sm"
                   title="Comprimi in una playlist"
                   aria-label="Comprimi in una playlist"
                 >
                   <ListVideo className="h-4 w-4 shrink-0" />
                   <span className={toolLabelClass}>Comprimi in playlist</span>
                 </Button>
               )}

               <Button
                 variant="outline"
                 asChild
                 className="group h-9 shrink-0 whitespace-nowrap rounded-xl border-primary/20 px-2 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground 2xl:h-10 2xl:px-3 2xl:text-sm"
                 title="Importa traccia"
                 aria-label="Importa traccia"
               >
                 <Link
                   href={`/add?category=${encodeURIComponent(category.name)}${activeLevel !== "All" ? `&level=${activeLevel}` : ""}`}
                 >
                   <Upload className="h-4 w-4 shrink-0" />
                   <span className={toolLabelClass}>Importa traccia</span>
                 </Link>
               </Button>

               <div className="ml-auto flex shrink-0 items-center border-l border-border/60 pl-2">
                 <Button
                   variant="outline"
                   onClick={invertOrder}
                   className="group h-9 shrink-0 whitespace-nowrap rounded-xl border-primary/20 px-2 text-xs font-semibold text-primary transition-all duration-300 hover:bg-primary hover:text-primary-foreground 2xl:h-10 2xl:px-3 2xl:text-sm"
                   title="Inverti l'ordine dei video"
                   aria-label="Inverti l'ordine dei video"
                 >
                   <ArrowDownUp className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:rotate-180" />
                   <span className={toolLabelClass}>Inverti ordine</span>
                 </Button>
               </div>
            </div>
          </div>
            </div>
          </div>
        </div>

        {levels.map((level) => {
          const filteredVideos = level === "All"
            ? displayVideos
            : displayVideos.filter((video) => video.level === level);
          const visiblePlaylistGroups = [...playlistGroups.entries()]
            .filter(([, group]) => level === "All" || group.some((video) => video.level === level))
            .sort(([, left], [, right]) => (
              Math.min(...left.map((video) => displayOrderIndex.get(video.id) ?? Number.MAX_SAFE_INTEGER)) -
              Math.min(...right.map((video) => displayOrderIndex.get(video.id) ?? Number.MAX_SAFE_INTEGER))
            ));
          const reorderItems = buildReorderItems(displayVideos, level);
          const individualVideos = filteredVideos.filter((video) => video.sourceType !== "playlist");
          const hasVisibleContent = reorderEnabled
            ? reorderItems.length > 0
            : individualVideos.length > 0 || visiblePlaylistGroups.length > 0;

          return (
            <TabsContent key={level} value={level} className="mt-0 outline-none focus:outline-none">
              {hasVisibleContent ? (
                <div className="space-y-6">
                  {reorderEnabled && reorderItems.length > 0 && (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {reorderItems.map((item) => {
                        if (item.playlistName) {
                          const playlistVideos = playlistGroups.get(item.playlistName) ?? [];
                          return (
                            <PlaylistCard
                              key={item.key}
                              name={item.playlistName}
                              videos={playlistVideos}
                              selectedCount={playlistVideos.filter((video) => selectedIds.includes(video.id)).length}
                              selectedItemCount={selectedItemCount}
                              selectedVideos={selectedVideos}
                              selectionMode={selectionMode}
                              categoryName={categoryName}
                              reorderEnabled
                              reorderKey={item.key}
                              onDragStartItem={handleDragStartItem}
                              onDragOverItem={handleDragOverItem}
                              onDragEndItem={handleDragEndItem}
                              onDropItem={handleDropItem}
                              onOpen={() => navigate(`/category/${encodeURIComponent(categoryName)}/playlist/${encodeURIComponent(item.playlistName!)}`)}
                              onSelect={(mode) => selectPlaylist(playlistVideos, mode)}
                              onExtract={() => extractPlaylist(playlistVideos)}
                              onSelectionActionComplete={clearSelection}
                            />
                          );
                        }

                        const video = videos.find((candidate) => candidate.id === item.videoIds[0]);
                        if (!video) return null;
                        return (
                          <VideoCard
                            key={item.key}
                            video={video}
                            videos={displayVideos}
                            onOpenVideo={(selected) => {
                              setSelectedVideo(selected);
                              setPlayerOpen(true);
                            }}
                            categoryName={categoryName}
                            selected={selectedIds.includes(video.id)}
                            selectedVideos={selectedVideos}
                            selectedItemCount={selectedItemCount}
                            selectionMode={selectionMode}
                            onSelectVideo={handleSelectVideo}
                            reorderEnabled
                            reorderKey={item.key}
                            onDragStartItem={handleDragStartItem}
                            onDragOverItem={handleDragOverItem}
                            onDragEndItem={handleDragEndItem}
                            onDropItem={handleDropItem}
                            onSelectionActionComplete={clearSelection}
                          />
                        );
                      })}
                    </div>
                  )}
                  {!reorderEnabled && visiblePlaylistGroups.length > 0 && (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {visiblePlaylistGroups.map(([playlistName, playlistVideos]) => (
                        <PlaylistCard
                          key={playlistName}
                          name={playlistName}
                          videos={playlistVideos}
                          selectedCount={playlistVideos.filter((video) => selectedIds.includes(video.id)).length}
                          selectedItemCount={selectedItemCount}
                          selectedVideos={selectedVideos}
                          selectionMode={selectionMode}
                          categoryName={categoryName}
                          onOpen={() => navigate(`/category/${encodeURIComponent(categoryName)}/playlist/${encodeURIComponent(playlistName)}`)}
                          onSelect={(mode) => selectPlaylist(playlistVideos, mode)}
                          onExtract={() => extractPlaylist(playlistVideos)}
                          onSelectionActionComplete={clearSelection}
                        />
                      ))}
                    </div>
                  )}
                  {!reorderEnabled && individualVideos.length > 0 && (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {individualVideos.map((video) => (
                        <VideoCard
                          key={video.id}
                          video={video}
                          videos={displayVideos}
                          onOpenVideo={(selected) => {
                            setSelectedVideo(selected);
                            setPlayerOpen(true);
                          }}
                          categoryName={categoryName}
                          selected={selectedIds.includes(video.id)}
                          selectedVideos={selectedVideos}
                          selectedItemCount={selectedItemCount}
                          selectionMode={selectionMode}
                          onSelectVideo={handleSelectVideo}
                          reorderEnabled={reorderEnabled}
                          reorderKey={`video:${video.id}`}
                          onDragStartItem={handleDragStartItem}
                          onDragOverItem={handleDragOverItem}
                          onDragEndItem={handleDragEndItem}
                          onDropItem={handleDropItem}
                          onSelectionActionComplete={clearSelection}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-border/80 bg-card/40 py-24 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                    <Play className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <h3 className="mb-2 font-serif text-xl font-bold">No videos found</h3>
                  <p className="mx-auto max-w-sm font-medium text-muted-foreground">
                    You haven't added any {level !== "All" ? level.toLowerCase() : ""} content to this track yet.
                  </p>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
       <VideoPlayerDialog
         video={selectedVideo ?? uncompletedVideo ?? null}
         videos={displayVideos}
         initialVideoId={(selectedVideo ?? uncompletedVideo)?.id}
         open={playerOpen}
         onOpenChange={setPlayerOpen}
       />
       <Dialog open={compressOpen} onOpenChange={(open) => {
         if (open) {
           setCompressOpen(true);
         } else {
           closeCompressDialog();
         }
       }}>
         <DialogContent
           data-compression-dialog
           className="rounded-2xl border-border/80"
         >
           <DialogHeader>
             <DialogTitle>Comprimi in playlist</DialogTitle>
             <DialogDescription>
               I {selectedStandaloneCount} video selezionati verranno raggruppati in una nuova playlist.
             </DialogDescription>
           </DialogHeader>
            {(compressionInProgress || compressionProgress.completed > 0) && (
              <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4 text-sm font-semibold">
                  <span>
                    {compressionInProgress
                      ? `Compressi ${compressionProgress.completed} di ${compressionProgress.total}`
                      : `Compressione completata`}
                  </span>
                  <span className="text-muted-foreground">
                    {compressionProgress.total > 0
                      ? `${Math.round((compressionProgress.completed / compressionProgress.total) * 100)}%`
                      : "0%"}
                  </span>
                </div>
                <Progress
                  value={
                    compressionProgress.total > 0
                      ? (compressionProgress.completed / compressionProgress.total) * 100
                      : 0
                  }
                  className="h-2.5"
                  aria-label={`Compressi ${compressionProgress.completed} di ${compressionProgress.total} video`}
                />
                {compressionInProgress && (
                  <p className="text-xs text-muted-foreground">
                    Attendi mentre aggiorniamo i video selezionati…
                  </p>
                )}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void compressSelectedVideos();
              }}
            >
              <Input
                autoFocus
                value={compressName}
                onChange={(event) => setCompressName(event.target.value)}
                placeholder="Nome della playlist"
                maxLength={120}
               disabled={compressionInProgress}
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={closeCompressDialog} disabled={compressionInProgress}>
                  Annulla
                </Button>
                <Button
                  type="submit"
                  disabled={compressionInProgress || updateVideoSources.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void compressSelectedVideos();
                  }}
                >
                  {compressionInProgress ? "Compressione…" : "Comprimi"}
                </Button>
              </DialogFooter>
            </form>
         </DialogContent>
       </Dialog>
        <Dialog
          open={bulkDeleteOpen}
          onOpenChange={(open) => {
            if (!bulkDeleteInProgress) setBulkDeleteOpen(open);
          }}
        >
          <DialogContent className="rounded-2xl border-border/80">
            <DialogHeader>
              <DialogTitle>
                Eliminare {bulkDeleteProgress.total > 1 ? `${bulkDeleteProgress.total} video` : "questo video"}?
              </DialogTitle>
              <DialogDescription>
                I video selezionati verranno rimossi dalla skill, ma la skill resterà intatta.
              </DialogDescription>
            </DialogHeader>
            {(bulkDeleteInProgress || bulkDeleteProgress.completed > 0 || bulkDeleteFailed) && (
              <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4 text-sm font-semibold">
                  <span>
                    {bulkDeleteFailed
                      ? "Eliminazione interrotta"
                      : `Eliminati ${bulkDeleteProgress.completed} di ${bulkDeleteProgress.total}`}
                  </span>
                  <span className="text-muted-foreground">
                    {bulkDeleteFailed
                      ? `${Math.max(bulkDeleteProgress.total - bulkDeleteProgress.completed, 0)} rimanenti`
                      : `${Math.max(bulkDeleteProgress.total - bulkDeleteProgress.completed, 0)} da eliminare`}
                  </span>
                </div>
                <Progress
                  value={
                    bulkDeleteProgress.total > 0
                      ? (bulkDeleteProgress.completed / bulkDeleteProgress.total) * 100
                      : 0
                  }
                  className="h-2.5"
                  aria-label={`Eliminati ${bulkDeleteProgress.completed} di ${bulkDeleteProgress.total} video`}
                />
                {bulkDeleteFailed && (
                  <p className="text-xs text-destructive">
                    Alcuni video potrebbero essere già stati eliminati. Riprova per continuare.
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleteInProgress}
              >
                Annulla
              </Button>
              <Button
                type="button"
                onClick={() => void removeSelectedVideos()}
                disabled={bulkDeleteInProgress}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {bulkDeleteInProgress ? "Eliminazione…" : "Elimina"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
