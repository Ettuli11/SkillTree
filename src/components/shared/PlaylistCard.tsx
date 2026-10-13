import React, { useEffect, useRef, useState } from "react";
 import { CheckCircle2, Copy, ListVideo, Loader2, RotateCcw, Star, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { directReorderTargetAt } from "@/lib/reorder";
import { Badge } from "@/components/ui/badge";
import {
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListCategoriesQueryKey,
  useUpdatePlaylistLevel,
  useDeleteVideo,
  useUpdateVideoFavorite,
  useUpdateVideoPlayback,
  useUpdateVideoProgress,
  type SkillLevel,
  type Video,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
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

interface PlaylistCardProps {
  name: string;
  videos: Video[];
  selectedCount: number;
  selectedItemCount?: number;
  selectedVideos?: Video[];
  selectionMode: boolean;
  categoryName: string;
  onOpen: () => void;
  onSelect: (mode: "toggle" | "range") => void;
  onExtract?: () => Promise<boolean>;
  onSelectionActionComplete?: () => void;
  reorderEnabled?: boolean;
  reorderKey?: string;
  onDragStartItem?: (key: string) => void;
  onDragOverItem?: (key: string) => void;
  onDragEndItem?: () => void;
  onDropItem?: (draggedKey: string, targetKey: string, isDirectHit?: boolean) => void;
}

const levelLabel = (videos: Video[]) => {
  const levels = [...new Set(videos.map((video) => video.level))];
  return levels.length === 1 ? levels[0] : "Mista";
};

export function PlaylistCard({
  name,
  videos,
  selectedCount,
  selectedItemCount,
  selectedVideos = [],
  selectionMode,
  categoryName,
  onOpen,
  onSelect,
  onExtract,
  onSelectionActionComplete,
  reorderEnabled = false,
  reorderKey = `playlist:${name}`,
  onDragStartItem,
  onDragOverItem,
  onDragEndItem,
  onDropItem,
}: PlaylistCardProps) {
  const queryClient = useQueryClient();
  const updatePlaylistLevel = useUpdatePlaylistLevel();
  const updateProgress = useUpdateVideoProgress();
  const updatePlayback = useUpdateVideoPlayback();
  const updateFavorite = useUpdateVideoFavorite();
  const deleteVideo = useDeleteVideo();
  const thumbnail = videos[0]?.thumbnailUrl;
  const [pendingLevel, setPendingLevel] = useState<SkillLevel | null>(null);
  const level = pendingLevel ?? levelLabel(videos);
  const selected = selectedCount > 0;
  const playlistFavorite = videos.length > 0 && videos.every((video) => video.favorite);
  const actionVideos = selected && selectedVideos.length > 0 ? selectedVideos : videos;
  const actionItemCount = selected ? (selectedItemCount ?? 1) : 1;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractInProgress, setExtractInProgress] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractFailed, setExtractFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const dragSourceCardRef = useRef<HTMLElement | null>(null);
  const dragPointerRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
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
    }
  };

  const startAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) return;
    autoScrollFrameRef.current = window.setInterval(tickAutoScroll, 16);
  };

  const cleanupDrag = () => {
    const attached = docListenersRef.current;
    if (attached) {
      document.removeEventListener("pointermove", attached.move);
      document.removeEventListener("pointerup", attached.up);
      document.removeEventListener("pointercancel", attached.up);
      docListenersRef.current = null;
    }
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
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
    dragPositionRef.current = { x: event.clientX, y: event.clientY };
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const preview = dragPreviewRef.current;
      const activePointer = dragPointerRef.current;
      if (!preview || !activePointer) return;
      const { x, y } = dragPositionRef.current;
      preview.style.transform = `translate3d(${x - activePointer.offsetX}px, ${y - activePointer.offsetY}px, 0)`;

      // Auto-scroll when near top/bottom of the scroll container
      const scrollContainer = document.querySelector<HTMLElement>("[data-app-scroll-container]");
      if (scrollContainer) {
        const rect = scrollContainer.getBoundingClientRect();
        const threshold = 80;
        const maxSpeed = 15;
        if (y < rect.top + threshold + 60) {
          const intensity = (rect.top + threshold + 60 - y) / (threshold + 60);
          scrollContainer.scrollTop -= Math.round(intensity * maxSpeed);
        } else if (y > rect.bottom - threshold) {
          const intensity = (y - (rect.bottom - threshold)) / threshold;
          scrollContainer.scrollTop += Math.round(intensity * maxSpeed);
        }
      }

      // Fire a hover only when the pointer actually moved since the last one:
      // cards gliding underneath a stationary pointer (mid-FLIP) must not
      // trigger phantom reorders.
      const lastFire = lastFirePositionRef.current;
      if (lastFire && Math.hypot(x - lastFire.x, y - lastFire.y) <= 2) return;
      lastFirePositionRef.current = { x, y };
      const targetKey = getDirectDropTargetKey(x, y);
      if (targetKey && targetKey !== reorderKey) {
        lastDragTargetRef.current = targetKey;
        onDragOverItem?.(targetKey);
      }
    });
  };

  const handlePointerUp = (event: PointerEvent) => {
    const pointer = dragPointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const directTargetKey = getDirectDropTargetKey(event.clientX, event.clientY);
    const targetKey = directTargetKey ?? lastDragTargetRef.current;
    if (targetKey && targetKey !== reorderKey) onDropItem?.(reorderKey, targetKey, Boolean(directTargetKey));
    setDragging(false);
    cleanupDrag();
    onDragEndItem?.();
  };
  useEffect(() => {
    if (!pendingLevel || updatePlaylistLevel.isPending) return;
    const levels = new Set(videos.map((video) => video.level));
    if (levels.size === 1 && levels.has(pendingLevel)) {
      setPendingLevel(null);
    }
  }, [pendingLevel, updatePlaylistLevel.isPending, videos]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(categoryName) }),
    ]);
  };
  const updateLevel = (nextLevel: SkillLevel) => {
    if (updatePlaylistLevel.isPending) return;
    setPendingLevel(nextLevel);
    updatePlaylistLevel.mutate(
      {
        categoryName,
        playlistName: name,
        data: { level: nextLevel },
      },
      {
        onSuccess: async () => {
          await invalidate();
          setPendingLevel(null);
          toast.success("Difficoltà aggiornata per tutta la playlist");
        },
        onError: () => {
          setPendingLevel(null);
          toast.error("Impossibile aggiornare la difficoltà della playlist");
        },
      },
    );
  };

  const invalidateVideoData = () => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(categoryName) });
  };

  const markComplete = async () => {
    try {
      await Promise.all(actionVideos.map((video) => updateProgress.mutateAsync({
        videoId: video.id,
        data: { watched: true },
      })));
      invalidateVideoData();
      toast.success(actionItemCount > 1
        ? `${actionItemCount} elementi segnati come completati`
        : "Playlist segnata come completata");
    } catch {
      toast.error("Impossibile aggiornare il completamento");
    }
  };

  const toggleFavorite = async () => {
    const nextFavorite = !playlistFavorite;
    try {
      await Promise.all(videos.map((video) => updateFavorite.mutateAsync({
        videoId: video.id,
        data: { favorite: nextFavorite },
      })));
      invalidateVideoData();
      toast.success(nextFavorite
        ? "Playlist aggiunta ai preferiti"
        : "Playlist rimossa dai preferiti");
    } catch {
      toast.error("Impossibile aggiornare i preferiti");
    }
  };

  const resetProgress = async () => {
    if (resetInProgress) return;
    setResetInProgress(true);
    try {
      await Promise.all(
        actionVideos.flatMap((video) => [
          updateProgress.mutateAsync({
            videoId: video.id,
            data: { watched: false },
          }),
          updatePlayback.mutateAsync({
            videoId: video.id,
            data: { seconds: 0 },
          }),
        ]),
      );
      setResetOpen(false);
      invalidate();
      toast.success(actionItemCount > 1
        ? `${actionItemCount} elementi reimpostati`
        : "Progressi playlist reimpostati");
    } catch {
      toast.error("Impossibile azzerare i progressi");
    } finally {
      setResetInProgress(false);
    }
  };

  const copyLinks = async () => {
    const playlistUrl = videos.find((video) => video.playlistUrl)?.playlistUrl;
    if (!playlistUrl) {
      toast.error("Link playlist non disponibile: reimporta la playlist dal suo URL YouTube");
      return;
    }
    try {
      await navigator.clipboard.writeText(playlistUrl);
      toast.success("Link della playlist copiato");
    } catch {
      toast.error("Impossibile copiare i link");
    }
  };

  const removePlaylistVideos = async () => {
    if (deleteInProgress) return;
    setDeleteInProgress(true);
    setDeleteProgress(0);
    try {
      for (const video of videos) {
        await deleteVideo.mutateAsync({ videoId: video.id });
        setDeleteProgress((current) => current + 1);
      }
      setDeleteOpen(false);
      invalidateVideoData();
      onSelectionActionComplete?.();
      toast.success("Playlist rimossa dalla skill");
    } catch {
      toast.error("Impossibile eliminare tutti i video della playlist");
    } finally {
      setDeleteInProgress(false);
    }
  };

  const extractPlaylistVideos = async () => {
    if (!onExtract || extractInProgress) return;
    setExtractOpen(true);
    setExtractInProgress(true);
    setExtractFailed(false);
    setExtractProgress(0);

    const progressTimer = window.setInterval(() => {
      setExtractProgress((current) => Math.min(current + 1, Math.max(videos.length - 1, 0)));
    }, 180);

    try {
      const succeeded = await onExtract();
      window.clearInterval(progressTimer);
      if (succeeded) {
        setExtractProgress(videos.length);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setExtractOpen(false);
      } else {
        setExtractFailed(true);
      }
    } catch {
      window.clearInterval(progressTimer);
      setExtractFailed(true);
      toast.error("Impossibile estrarre la playlist");
    } finally {
      window.clearInterval(progressTimer);
      setExtractInProgress(false);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card
            className={`group relative flex cursor-pointer flex-col overflow-hidden border-border/60 shadow-sm transition-all hover:border-primary/30 hover:shadow-md ${
              selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
            } ${reorderEnabled ? "cursor-grab select-none touch-none active:cursor-grabbing" : ""} ${dragging ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : ""}`}
            data-playlist-card
            data-reorder-card
            data-reorder-key={reorderKey}
            role="button"
            tabIndex={0}
            aria-label={`Apri la playlist ${name}`}
            onClick={(event) => {
              if (reorderEnabled) {
                event.preventDefault();
                return;
              }
              if (event.target instanceof HTMLElement && event.target.closest("[data-playlist-level-select]")) return;
              event.preventDefault();
              if ((event.ctrlKey || event.metaKey) && onSelect) onSelect("range");
              else if (event.shiftKey && onSelect) onSelect("toggle");
              else if (selectionMode) onSelect("toggle");
              else onOpen();
            }}
            onContextMenu={() => {
              if (!selected) onSelect("toggle");
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (reorderEnabled) return;
              if (selectionMode) onSelect("toggle");
              else onOpen();
            }}
            onPointerDown={(event) => {
              if (!reorderEnabled || event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              setDragging(true);
              onDragStartItem?.(reorderKey);
              const sourceCard = event.currentTarget;
              sourceCard.style.pointerEvents = "none";
              dragSourceCardRef.current = sourceCard;
              const preview = sourceCard.cloneNode(true) as HTMLElement;
              const { width, height, left, top } = sourceCard.getBoundingClientRect();
              preview.removeAttribute("data-playlist-card");
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
              preview.style.zIndex = "9999";
              preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
              document.body.appendChild(preview);
              dragPreviewRef.current = preview;
              dragPointerRef.current = {
                id: event.pointerId,
                offsetX: event.clientX - left,
                offsetY: event.clientY - top,
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
      {selected && (
        <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow-lg">
          Playlist selezionata
        </div>
      )}
       <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={`Immagine della playlist ${name}`}
            draggable={false}
            decoding="async"
            className="h-full w-full select-none object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ListVideo className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pb-3 pt-8 text-xs font-bold text-white">
          <span className="flex items-center gap-1.5">
            <ListVideo className="h-4 w-4" />
            {videos.length} video
          </span>
        </div>
      </div>
      <CardContent className="flex flex-1 flex-col bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Badge variant="outline" className="border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            Playlist
          </Badge>
          <div
            data-playlist-level-select
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Select value={level} onValueChange={(value) => updateLevel(value as SkillLevel)} disabled={updatePlaylistLevel.isPending}>
              <SelectTrigger className="h-6 w-[118px] border-primary/20 bg-primary/5 px-2 py-0 text-[10px] font-bold uppercase tracking-wider text-primary focus:ring-0">
                {updatePlaylistLevel.isPending ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {(pendingLevel ?? level).toUpperCase()}
                  </span>
                ) : (
                  <SelectValue />
                )}
              </SelectTrigger>
              <SelectContent>
                {level === "Mista" && (
                  <SelectItem value="Mista" disabled className="text-xs font-medium">MISTA</SelectItem>
                )}
                {(["Beginner", "Intermediate", "Advanced", "Expert"] as const).map((item) => (
                  <SelectItem key={item} value={item} className="text-xs font-medium">{item.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <h4 className="line-clamp-2 font-sans text-sm font-bold leading-snug">{name}</h4>
      </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-80 rounded-2xl border-border/80 bg-popover p-2 shadow-2xl">
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => void markComplete()}>
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {actionItemCount > 1 ? `Mark as complete (${actionItemCount})` : "Mark as complete"}
            <ContextMenuShortcut>M</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => void toggleFavorite()}>
            <Star className={`h-5 w-5 shrink-0 ${playlistFavorite ? "fill-primary text-primary" : ""}`} />
            {playlistFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            <ContextMenuShortcut>F</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => void copyLinks()}>
            <Copy className="h-5 w-5 shrink-0" />
            Copy playlist link
          </ContextMenuItem>
           {onExtract && (
             <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => void extractPlaylistVideos()}>
              <ListVideo className="h-5 w-5 shrink-0" />
              Estrai playlist
            </ContextMenuItem>
          )}
          <ContextMenuSeparator className="my-1.5" />
           <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={() => setResetOpen(true)}>
             <RotateCcw className="h-5 w-5 shrink-0" />
             {actionItemCount > 1 ? `Reset progress (${actionItemCount})` : "Reset progress"}
           </ContextMenuItem>
           <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 className="h-5 w-5 shrink-0" />
            Delete playlist
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
             <AlertDialogTitle>Reset playlist progress?</AlertDialogTitle>
             <AlertDialogDescription>
               {actionItemCount > 1
                 ? `I progressi di ${actionItemCount} elementi verranno azzerati. Tutti i video torneranno non visti e ripartiranno da 0.`
                 : `I progressi di tutti i ${videos.length} video della playlist verranno azzerati. Torneranno non visti e ripartiranno da 0.`}
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
        open={extractOpen}
        onOpenChange={(open) => {
          if (!extractInProgress) setExtractOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-2xl border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle>Estrai playlist</AlertDialogTitle>
            <AlertDialogDescription>
              I {videos.length} video verranno trasformati in video singoli.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-4 text-sm font-semibold">
              <span>
                {extractFailed
                  ? "Estrazione interrotta"
                  : `Estratti ${extractProgress} di ${videos.length}`}
              </span>
              <span className="text-muted-foreground">
                {Math.round((extractProgress / Math.max(videos.length, 1)) * 100)}%
              </span>
            </div>
            <Progress
              value={(extractProgress / Math.max(videos.length, 1)) * 100}
              className="h-2.5"
              aria-label={`Estratti ${extractProgress} di ${videos.length} video`}
            />
            {extractFailed && (
              <p className="text-xs text-destructive">
                Nessuna modifica completata. Chiudi e riprova.
              </p>
            )}
            {extractInProgress && (
              <p className="text-xs text-muted-foreground">
                Attendi mentre estraiamo i video selezionati…
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={extractInProgress}>
              {extractFailed ? "Chiudi" : "Annulla"}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleteInProgress && setDeleteOpen(open)}>
        <AlertDialogContent className="rounded-2xl border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              I {videos.length} video verranno rimossi dalla skill, ma la skill resterà intatta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteInProgress && (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm font-semibold">
              Eliminati {deleteProgress} di {videos.length}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInProgress}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteInProgress}
              onClick={(event) => {
                event.preventDefault();
                void removePlaylistVideos();
              }}
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