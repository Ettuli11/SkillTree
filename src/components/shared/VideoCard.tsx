import React, { useEffect, useRef, useState } from "react";
import {
  Video,
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListCategoriesQueryKey,
  useDeleteVideo,
  useUpdateVideoFavorite,
   useUpdateVideoPlayback,
   useUpdateVideoProgress,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, RotateCcw, Star, Trash2, Volume2, VolumeX, Youtube } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { directReorderTargetAt } from "@/lib/reorder";
import { Progress } from "@/components/ui/progress";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Zoom e origine dell'anteprima hover — regolabili qui
// Anteprima in card: zoom e ancoraggio dell'iframe YouTube.
// Zoom piu alto = titolo/autore/logo escono dall'inquadratura (ma si tagliano i bordi).
// Origine verticale piu alta (es. 92%) = si taglia di piu in alto e meno in basso (sottotitoli).
const PREVIEW_ZOOM = 1;
const PREVIEW_ORIGIN = "50% 50%";
// Dimensione sottotitoli YouTube (non documentata, puo essere ignorata): 0 = normale, 1, 2, 3 = sempre piu grandi.
const PREVIEW_CAPTION_FONT_SIZE = 1;

// Modalita' dell'anteprima quando passi il mouse sulla card:
//  "frames" = scorrono 3 fotogrammi del video (nessuna interfaccia YouTube, nessun logo, nessun pulsante);
//  "video"  = iframe YouTube con zoom (mostra anche i sottotitoli, ma YouTube lascia logo/overlay).
const PREVIEW_MODE = "video" as "frames" | "video";

// Stato condiviso globale per le impostazioni dell'anteprima (CC e audio)
interface SharedPreviewState {
  ccEnabled: boolean;
  muted: boolean;
}
const sharedPreviewState: SharedPreviewState = {
  ccEnabled: true,
  muted: true,
};
const sharedListeners = new Set<(s: SharedPreviewState) => void>();

function subscribeShared(listener: (s: SharedPreviewState) => void) {
  sharedListeners.add(listener);
  return () => sharedListeners.delete(listener);
}

function getSharedSnapshot(): SharedPreviewState {
  return sharedPreviewState;
}

function setSharedPreviewState(partial: Partial<SharedPreviewState>) {
  Object.assign(sharedPreviewState, partial);
  sharedListeners.forEach((l) => l({ ...sharedPreviewState }));
}

function useSharedPreviewState() {
  return React.useSyncExternalStore(subscribeShared, getSharedSnapshot, getSharedSnapshot);
}
const FRAME_INTERVAL_MS = 900;

// Anteprima pulita: alterna i fotogrammi mq1/mq2/mq3 che YouTube genera per ogni video.
function FramePreview({ youtubeId }: { youtubeId: string }) {
  const [frames, setFrames] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFrames([]);
    setIndex(0);
    const urls = [1, 2, 3].map((n) => `https://i.ytimg.com/vi/${youtubeId}/mq${n}.jpg`);
    Promise.all(
      urls.map(
        (url) =>
          new Promise<string | null>((resolve) => {
            const img = new Image();
            // Il segnaposto "non disponibile" di YouTube e' piccolo (120x90): lo scartiamo.
            img.onload = () => resolve(img.naturalWidth > 120 ? url : null);
            img.onerror = () => resolve(null);
            img.src = url;
          }),
      ),
    ).then((list) => {
      if (!cancelled) setFrames(list.filter((url): url is string => Boolean(url)));
    });
    return () => {
      cancelled = true;
    };
  }, [youtubeId]);

  useEffect(() => {
    if (frames.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [frames]);

  if (frames.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {frames.map((url, i) => (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full select-none object-cover transition-opacity duration-500 ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </div>
  );
}

type VideoSelectionMode = "toggle" | "range";

interface VideoCardProps {
  video: Video;
  videos?: Video[];
  onOpenVideo: (video: Video) => void;
  categoryName?: string;
  selected?: boolean;
  selectedVideos?: Video[];
  selectedItemCount?: number;
  selectionMode?: boolean;
  onSelectVideo?: (video: Video, mode: VideoSelectionMode) => void;
  reorderEnabled?: boolean;
  onDragStartVideo?: (videoId: number) => void;
  onDragOverVideo?: (videoId: number) => void;
  onDragEndVideo?: () => void;
  onDropVideo?: (draggedVideoId: number, targetVideoId: number) => void;
  reorderKey?: string;
  onDragStartItem?: (key: string) => void;
  onDragOverItem?: (key: string) => void;
  onDragEndItem?: () => void;
  onDropItem?: (draggedKey: string, targetKey: string, isDirectHit?: boolean) => void;
  onSelectionActionComplete?: () => void;
  deleteShortcutRequest?: number;
}

export function VideoCard({
  video,
  videos = [],
  onOpenVideo,
  categoryName,
  selected = false,
  selectedVideos = [],
  selectedItemCount,
  selectionMode = false,
  onSelectVideo,
  reorderEnabled = false,
  onDragStartVideo,
  onDragOverVideo,
  onDragEndVideo,
  onDropVideo,
  reorderKey = `video:${video.id}`,
  onDragStartItem,
  onDragOverItem,
  onDragEndItem,
  onDropItem,
  onSelectionActionComplete,
  deleteShortcutRequest = 0,
}: VideoCardProps) {
  const queryClient = useQueryClient();
  const updateProgress = useUpdateVideoProgress();
  const updatePlayback = useUpdateVideoPlayback();
  const updateFavorite = useUpdateVideoFavorite();
  const deleteVideo = useDeleteVideo();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ completed: 0, total: 0 });
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [hoverPreview, setHoverPreview] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const shared = useSharedPreviewState();
  const hoverTimerRef = useRef<number | null>(null);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const dragSourceCardRef = useRef<HTMLElement | null>(null);
  const playerRef = useRef<HTMLIFrameElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const dragPointerRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const dragPositionRef = useRef({ x: 0, y: 0 });
  const lastDragTargetRef = useRef<string | null>(null);
  const lastFirePositionRef = useRef<{ x: number; y: number } | null>(null);
  // Identities of the document-level drag listeners currently attached, so
  // removal always targets exactly what was added even if the component
  // re-rendered (new closures) between pointerdown and pointerup.
  const docListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const resolvedCategoryName = categoryName ?? video.categoryName;

  const startHoverPreview = () => {
    if (hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverPreview(true);
    }, 300);
  };

  const stopHoverPreview = () => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverPreview(false);
  };
  const actionVideos = selected && selectedVideos.length ? selectedVideos : [video];
  const actionCount = actionVideos.length;
  const actionItemCount = selected ? (selectedItemCount ?? actionCount) : 1;
  const getDirectDropTargetKey = (x: number, y: number) =>
    directReorderTargetAt(x, y, reorderKey);

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) {
      clearInterval(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const tickAutoScroll = () => {
    const pointer = dragPointerRef.current;
    if (!pointer) { stopAutoScroll(); return; }
    const { x, y } = dragPositionRef.current;
    const scrollContainer = document.querySelector<HTMLElement>("[data-app-scroll-container]");
    const threshold = 80;
    const maxSpeed = 15;
    if (scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect();
      if (y < rect.top + threshold) {
        const intensity = (rect.top + threshold - y) / threshold;
        scrollContainer.scrollTop -= intensity * maxSpeed;
      } else if (y > rect.bottom - threshold) {
        const intensity = (y - (rect.bottom - threshold)) / threshold;
        scrollContainer.scrollTop += intensity * maxSpeed;
      }
    } else {
      if (y < threshold) {
        const intensity = (threshold - y) / threshold;
        window.scrollBy({ top: -intensity * maxSpeed, behavior: "auto" });
      } else if (y > window.innerHeight - threshold) {
        const intensity = (y - (window.innerHeight - threshold)) / threshold;
        window.scrollBy({ top: intensity * maxSpeed, behavior: "auto" });
      }
    }
  };

  const startAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) return;
    autoScrollFrameRef.current = window.setInterval(tickAutoScroll, 16);
  };

  const removeDragPreview = () => {
    const attached = docListenersRef.current;
    if (attached) {
      document.removeEventListener("pointermove", attached.move);
      document.removeEventListener("pointerup", attached.up);
      document.removeEventListener("pointercancel", attached.up);
      docListenersRef.current = null;
    }
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    stopAutoScroll();
    if (dragSourceCardRef.current) {
      dragSourceCardRef.current.style.pointerEvents = "";
      dragSourceCardRef.current = null;
    }
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    dragPointerRef.current = null;
    dragPositionRef.current = { x: 0, y: 0 };
    lastDragTargetRef.current = null;
    lastFirePositionRef.current = null;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointer = dragPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;

    const preview = dragPreviewRef.current;
    if (preview) {
      dragPositionRef.current = { x: event.clientX, y: event.clientY };
    }
    if (dragFrameRef.current !== null) return;

    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const activePreview = dragPreviewRef.current;
      const activePointer = dragPointerRef.current;
      if (!activePreview || !activePointer) return;

      const { x, y } = dragPositionRef.current;
      activePreview.style.transform = `translate3d(${x - activePointer.offsetX}px, ${y - activePointer.offsetY}px, 0)`;



      // Fire a hover only when the pointer actually moved since the last one:
      // cards gliding underneath a stationary pointer (mid-FLIP) must not
      // trigger phantom reorders.
      const lastFire = lastFirePositionRef.current;
      if (lastFire && Math.hypot(x - lastFire.x, y - lastFire.y) <= 2) return;
      lastFirePositionRef.current = { x, y };

      // Resolve the hover against the DIRECT slot under the pointer: the
      // last-target fallback belongs to the release point (a drop in a gap),
      // and suppressing a repeat of the same key silently dropped the hover
      // that brings a card back over the slot it just left, leaving it one
      // card too far (a right-then-left drag overshot by one). Re-firing is
      // safe: the handlers no-op when the move is already applied.
      const targetKey = getDirectDropTargetKey(x, y);
      if (targetKey && targetKey !== reorderKey) {
        lastDragTargetRef.current = targetKey;
        if (onDragOverItem) onDragOverItem(targetKey);
        else onDragOverVideo?.(Number(targetKey.replace("video:", "")));
      }
    });
  };

  const handlePointerUp = (event: PointerEvent) => {
    const pointer = dragPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;

    const directTargetKey = getDirectDropTargetKey(event.clientX, event.clientY);
    const targetKey = directTargetKey ?? lastDragTargetRef.current;
    if (targetKey && targetKey !== reorderKey) {
      if (onDropItem) onDropItem(reorderKey, targetKey, Boolean(directTargetKey));
      else onDropVideo?.(video.id, Number(targetKey.replace("video:", "")));
    }
    setDragging(false);
    removeDragPreview();
    if (onDragEndItem) onDragEndItem();
    else onDragEndVideo?.();
  };

  const invalidateVideoData = () => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(resolvedCategoryName) });
  };

  const markComplete = async () => {
    try {
      await Promise.all(actionVideos.map((item) => updateProgress.mutateAsync({
        videoId: item.id,
        data: { watched: true },
      })));
      invalidateVideoData();
      onSelectionActionComplete?.();
       toast.success(actionItemCount > 1
         ? `${actionItemCount} elementi segnati come completati`
         : "Video segnato come completato");
    } catch {
      toast.error("Impossibile aggiornare il completamento");
    }
  };

  const toggleFavorite = async () => {
    const nextFavorite = !video.favorite;
    try {
      await Promise.all(actionVideos.map((item) => updateFavorite.mutateAsync({
        videoId: item.id,
        data: { favorite: nextFavorite },
      })));
      invalidateVideoData();
      onSelectionActionComplete?.();
      toast.success(nextFavorite ? `${actionCount} video aggiunti ai preferiti` : `${actionCount} video rimossi dai preferiti`);
    } catch {
      toast.error("Impossibile aggiornare i preferiti");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(actionVideos.map((item) => item.url).join("\n"));
      toast.success(actionCount > 1 ? `${actionCount} link YouTube copiati` : "Link YouTube copiato");
    } catch {
      toast.error("Impossibile copiare il link");
    }
  };

  const resetProgress = async () => {
    if (resetInProgress) return;
    setResetInProgress(true);
    try {
      await Promise.all(
        actionVideos.flatMap((item) => [
          updateProgress.mutateAsync({
            videoId: item.id,
            data: { watched: false },
          }),
          updatePlayback.mutateAsync({
            videoId: item.id,
            data: { seconds: 0 },
          }),
        ]),
      );
      setResetOpen(false);
      invalidateVideoData();
      onSelectionActionComplete?.();
      toast.success(actionItemCount > 1
        ? `${actionItemCount} elementi reimpostati`
        : "Progressi reimpostati");
    } catch {
      toast.error("Impossibile azzerare i progressi");
    } finally {
      setResetInProgress(false);
    }
  };

  const removeVideos = async () => {
    if (deleteInProgress) return;

    const total = actionVideos.length;
    setDeleteInProgress(true);
    setDeleteProgress({ completed: 0, total });
    setDeleteFailed(false);

    try {
      for (const item of actionVideos) {
        await deleteVideo.mutateAsync({ videoId: item.id });
        setDeleteProgress((current) => ({
          ...current,
          completed: current.completed + 1,
        }));
      }
      setDeleteOpen(false);
      invalidateVideoData();
      onSelectionActionComplete?.();
      toast.success(actionCount > 1 ? `${actionCount} video eliminati dalla skill` : "Video eliminato dalla skill");
    } catch {
      setDeleteFailed(true);
      toast.error("Impossibile eliminare tutti i video");
    } finally {
      setDeleteInProgress(false);
    }
  };

  const openDeleteDialog = () => {
    setDeleteProgress({ completed: 0, total: actionCount });
    setDeleteFailed(false);
    setDeleteOpen(true);
  };

  useEffect(() => {
    if (deleteShortcutRequest > 0 && selected && selectedVideos.length > 0) {
      openDeleteDialog();
    }
  }, [deleteShortcutRequest, selected, selectedVideos.length]);

  // Comandi verso l'iframe YouTube (enablejsapi=1) via postMessage.
  const sendPlayerCommand = (func: string, args: unknown[] = []) => {
    const iframe = playerRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "https://www.youtube.com",
    );
  };

  // Sync mute state
  useEffect(() => {
    if (!hoverPreview || PREVIEW_MODE !== "video") return;
    sendPlayerCommand(shared.muted ? "mute" : "unMute");
  }, [shared.muted, hoverPreview]);

  // Sync CC state e dimensione sottotitoli (i comandi vengono ripetuti: il modulo
  // dei sottotitoli si carica solo quando il video e' partito)
  useEffect(() => {
    if (!hoverPreview || PREVIEW_MODE !== "video") return;
    const apply = () => {
      if (shared.ccEnabled) {
        sendPlayerCommand("loadModule", ["captions"]);
        sendPlayerCommand("setOption", ["captions", "fontSize", PREVIEW_CAPTION_FONT_SIZE]);
      } else {
        sendPlayerCommand("unloadModule", ["captions"]);
      }
    };
    const timers = [600, 1500, 3000].map((delay) => window.setTimeout(apply, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [shared.ccEnabled, hoverPreview]);

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reorderEnabled) {
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [role='combobox'], [data-video-level-select]")) {
      return;
    }
    if (selectionMode && onSelectVideo) {
      event.preventDefault();
      event.stopPropagation();
      onSelectVideo(video, "toggle");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && onSelectVideo) {
      event.preventDefault();
      event.stopPropagation();
      onSelectVideo(video, "range");
      return;
    }
    if (event.shiftKey && onSelectVideo) {
      event.preventDefault();
      event.stopPropagation();
      onSelectVideo(video, "toggle");
      return;
    }
    onOpenVideo(video);
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (selectionMode && onSelectVideo) {
        onSelectVideo(video, "toggle");
      } else {
        onOpenVideo(video);
      }
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card
            className={`group relative flex cursor-pointer flex-col overflow-hidden border-border/60 shadow-sm transition-all hover:border-primary/30 hover:shadow-md ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${reorderEnabled ? "cursor-grab select-none touch-none active:cursor-grabbing" : ""} ${dragging ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : ""}`}
            data-testid={`card-video-${video.id}`}
            data-video-card
            data-video-id={video.id}
            data-reorder-card
            data-reorder-key={reorderKey}
            onMouseEnter={undefined}
            onMouseLeave={undefined}
            role="button"
            tabIndex={0}
            aria-label={`Watch ${video.title}`}
            onClick={handleCardClick}
            onContextMenu={() => {
              if (onSelectVideo && !selected) onSelectVideo(video, "toggle");
            }}
            onKeyDown={handleCardKeyDown}
            onPointerDown={(event) => {
              if (!reorderEnabled) return;
               if (event.button !== 0) return;
               event.preventDefault();
               event.stopPropagation();
               setDragging(true);
              if (onDragStartItem) onDragStartItem(reorderKey);
              else onDragStartVideo?.(video.id);
               const sourceCard = event.currentTarget;
               sourceCard.style.pointerEvents = "none";
               dragSourceCardRef.current = sourceCard;
               const preview = sourceCard.cloneNode(true) as HTMLElement;
               const { width, height } = sourceCard.getBoundingClientRect();
                preview.removeAttribute("data-testid");
                preview.removeAttribute("data-video-card");
                preview.removeAttribute("data-video-id");
                preview.removeAttribute("data-reorder-card");
                preview.removeAttribute("data-reorder-key");
                preview.removeAttribute("role");
                preview.removeAttribute("tabindex");
               preview.style.position = "fixed";
               preview.style.left = "0";
               preview.style.top = "0";
               preview.style.width = `${width}px`;
               preview.style.height = `${height}px`;
               preview.style.pointerEvents = "none";
               preview.style.opacity = "1";
               preview.style.willChange = "transform";
               preview.style.transition = "none";
               preview.style.contain = "strict";
               preview.style.backfaceVisibility = "hidden";
               preview.style.transformOrigin = "top left";
               preview.style.boxShadow = "0 24px 50px rgba(0, 0, 0, 0.38)";
               preview.style.zIndex = "9999";
               const sourceRect = sourceCard.getBoundingClientRect();
               preview.style.transform = `translate3d(${sourceRect.left}px, ${sourceRect.top}px, 0)`;
               document.body.appendChild(preview);
               dragPreviewRef.current = preview;
               dragPointerRef.current = {
                 id: event.pointerId,
                 offsetX: event.clientX - sourceRect.left,
                 offsetY: event.clientY - sourceRect.top,
               };
                 dragPositionRef.current = { x: event.clientX, y: event.clientY };
                 lastDragTargetRef.current = null;
                 lastFirePositionRef.current = null;
               // NOTE: no setPointerCapture here: in Chrome it retargets the
               // gesture so pointerup never reaches the document handlers and
               // the drop is lost (verified: stranded preview, DOM≠server).
               document.addEventListener("pointermove", handlePointerMove);
               document.addEventListener("pointerup", handlePointerUp);
               document.addEventListener("pointercancel", handlePointerUp);
               docListenersRef.current = { move: handlePointerMove, up: handlePointerUp };
               startAutoScroll();
            }}
          >

             <div
              className="relative aspect-video w-full overflow-hidden bg-muted/30"
              onMouseEnter={startHoverPreview}
              onMouseLeave={stopHoverPreview}
            >
              {video.thumbnailUrl ? (
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  draggable={false}
                  decoding="async"
                  className={`h-full w-full select-none object-cover transition-opacity duration-300 group-hover:scale-105 ${hoverPreview && PREVIEW_MODE === "video" ? "opacity-0" : "opacity-100"}`}
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center"><Youtube className="h-12 w-12 text-muted-foreground/30" /></div>
              )}
              {hoverPreview && PREVIEW_MODE === "frames" && <FramePreview youtubeId={video.youtubeId} />}
              {hoverPreview && PREVIEW_MODE === "video" && (
                <>
                  <div
                    className="absolute inset-0 z-10"
                    style={{
                      transform: `scale(var(--preview-zoom, ${PREVIEW_ZOOM}))`,
                      transformOrigin: `var(--preview-origin, ${PREVIEW_ORIGIN})`,
                    }}
                    aria-hidden="true"
                  >
                    <iframe
                      src={`https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&rel=0&playsinline=1&cc_load_policy=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
                      title={video.title}
                      className="absolute inset-0 h-full w-full"
                      style={{ pointerEvents: "none" }}
                      allow="autoplay; encrypted-media"
                      tabIndex={-1}
                      ref={playerRef}
                      onLoad={() => {
                        sendPlayerCommand("mute");
                        sendPlayerCommand("setOption", ["captions", "fontSize", PREVIEW_CAPTION_FONT_SIZE]);
                      }}
                    />
                  </div>
                  <div className="absolute right-2 top-2 z-10 flex gap-1.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSharedPreviewState({ ccEnabled: !shared.ccEnabled });
                      }}
                      className={`rounded p-1.5 transition-colors ${
                        shared.ccEnabled
                          ? "bg-primary text-primary-foreground"
                          : "bg-black/60 text-white/70 hover:text-white"
                      }`}
                      title={shared.ccEnabled ? "Disattiva sottotitoli" : "Attiva sottotitoli"}
                      aria-label={shared.ccEnabled ? "Disattiva sottotitoli" : "Attiva sottotitoli"}
                      aria-pressed={shared.ccEnabled}
                    >
                      <span className="text-[10px] font-bold">CC</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSharedPreviewState({ muted: !shared.muted });
                      }}
                      className={`rounded p-1.5 transition-colors ${
                        shared.muted
                          ? "bg-black/60 text-white/70 hover:text-white"
                          : "bg-primary text-primary-foreground"
                      }`}
                      title={shared.muted ? "Attiva audio" : "Muta audio"}
                      aria-label={shared.muted ? "Attiva audio" : "Muta audio"}
                      aria-pressed={!shared.muted}
                    >
                      {shared.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  </div>
                </>
              )}
              {/* Gradiente di transizione video → testo: morbido, lungo */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 z-5 h-28 bg-gradient-to-t from-card via-card/40 to-transparent"
                aria-hidden="true"
              />
            </div>

            <CardContent
              className="relative z-20 flex flex-1 flex-col bg-card p-4"
              onMouseEnter={() => setTitleExpanded(true)}
              onMouseLeave={() => setTitleExpanded(false)}
            >
              <h4
                className={`mb-1 line-clamp-2 font-sans text-sm font-bold leading-snug transition-all duration-300 ease-out ${
                  titleExpanded ? "line-clamp-none translate-y-[-12px]" : "line-clamp-2 translate-y-0"
                }`}
              >
                {video.title}
              </h4>
              <p className="mb-1 line-clamp-1 text-xs font-medium text-muted-foreground">{video.channelName}</p>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-80 rounded-2xl border-border/80 bg-popover p-2 shadow-2xl">
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={markComplete}>
            <CheckCircle2 className="h-5 w-5 shrink-0" />
             {actionItemCount > 1 ? `Mark as complete (${actionItemCount})` : "Mark as complete"}
            <ContextMenuShortcut>M</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={toggleFavorite}>
            <Star className={`h-5 w-5 shrink-0 ${video.favorite ? "fill-primary text-primary" : ""}`} />
            {video.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            <ContextMenuShortcut>F</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={copyLink}>
            <Copy className="h-5 w-5 shrink-0" />
            {actionCount > 1 ? `Copy ${actionCount} links` : "Copy link"}
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1.5" />
           <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => setResetOpen(true)}>
             <RotateCcw className="h-5 w-5 shrink-0" />
             {actionItemCount > 1 ? `Reset progress (${actionItemCount})` : "Reset progress"}
           </ContextMenuItem>
           <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={openDeleteDialog}>
            <Trash2 className="h-5 w-5 shrink-0" />
            {actionCount > 1 ? `Delete ${actionCount} videos` : "Delete"}
            <ContextMenuShortcut>D</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!resetInProgress) setResetOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset progress?</AlertDialogTitle>
            <AlertDialogDescription>
              {actionItemCount > 1
                ? `I progressi di ${actionItemCount} elementi verranno azzerati. Tutti i video torneranno non visti e ripartiranno da 0.`
                : "Il progresso verrà azzerato. Il video tornerà non visto e ripartirà da 0."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetInProgress}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetInProgress}
              onClick={(event) => {
                event.preventDefault();
                void resetProgress();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetInProgress ? "Resetting…" : "Reset progress"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteInProgress) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare {actionCount > 1 ? `${actionCount} video` : "questo video"}?</AlertDialogTitle>
            <AlertDialogDescription>{actionCount > 1 ? "I video" : "Il video"} verranno rimossi dalla skill, ma la skill resterà intatta.</AlertDialogDescription>
          </AlertDialogHeader>
          {(deleteInProgress || deleteProgress.completed > 0 || deleteFailed) && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-4 text-sm font-semibold">
                <span>
                  {deleteFailed ? "Eliminazione interrotta" : `Eliminati ${deleteProgress.completed} di ${deleteProgress.total}`}
                </span>
                <span className="text-muted-foreground">
                  {deleteFailed
                    ? `${Math.max(deleteProgress.total - deleteProgress.completed, 0)} rimanenti`
                    : `${Math.max(deleteProgress.total - deleteProgress.completed, 0)} da eliminare`}
                </span>
              </div>
              <Progress
                value={
                  deleteProgress.total > 0
                    ? (deleteProgress.completed / deleteProgress.total) * 100
                    : 0
                }
                className="h-2.5"
                aria-label={`Eliminati ${deleteProgress.completed} di ${deleteProgress.total} video`}
              />
              {deleteFailed && (
                <p className="text-xs text-destructive">
                  Alcuni video potrebbero essere già stati eliminati. Riprova per continuare.
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInProgress}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void removeVideos();
              }}
              disabled={deleteInProgress}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteInProgress ? "Eliminazione…" : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}