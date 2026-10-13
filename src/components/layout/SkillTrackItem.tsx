import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Eye,
  EyeOff,
  Pencil,
  Star,
  Trash2,
  BookOpen,
  UploadCloud,
  X,
  GripVertical,
} from "lucide-react";
import {
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListCategoriesQueryKey,
  getGetCategoryQueryKey,
  useDeleteCategory,
  useRenameCategory,
  useUpdateCategoryFavorite,
  type Category,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SkillTrackItemProps {
  category: Category;
  index: number;
  onDragStart?: (index: number) => void;
  onDragOver?: (event: React.DragEvent, index: number) => void;
  onDragLeave?: () => void;
  onDrop?: (index: number) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isOver?: boolean;
}

function readStoredBoolean(key: string) {
  return window.localStorage.getItem(key) === "true";
}

export function SkillTrackItem({
  category,
  index,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragging,
  isOver,
}: SkillTrackItemProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const renameCategory = useRenameCategory();
  const deleteCategory = useDeleteCategory();
  const [isUnread, setIsUnread] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState(category.name);
  const [newIconUrl, setNewIconUrl] = useState<string | null>(category.iconUrl);
  const [isDraggingIcon, setIsDraggingIcon] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const categoryPath = `/category/${encodeURIComponent(category.name)}`;

  const unreadKey = `skill-tree:unread:${category.id}`;
  const updateFavorite = useUpdateCategoryFavorite();

  useEffect(() => {
    setIsUnread(readStoredBoolean(unreadKey));
  }, [unreadKey]);

  const toggleFavorite = () => {
    updateFavorite.mutate(
      { categoryName: category.name, data: { favorite: !category.favorite } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
          toast.success(category.favorite ? "Skill rimossa dai preferiti" : "Skill aggiunta ai preferiti");
        },
        onError: () => toast.error("Impossibile aggiornare i preferiti"),
      },
    );
  };

  const toggleUnread = () => {
    const next = !isUnread;
    setIsUnread(next);
    window.localStorage.setItem(unreadKey, String(next));
  };

  const nameChanged = newName.trim() !== category.name;
  const iconChanged = newIconUrl !== category.iconUrl;
  const hasChanges = nameChanged || iconChanged;
  const isNameValid = newName.trim().length > 0 && newName.trim().length <= 50;

  const readIconFile = (file: File | undefined, onChange: (value: string | null) => void) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Scegli un file immagine.");
      return;
    }
    if (file.size > 1_000_000) {
      toast.error("L'icona della skill deve essere più piccola di 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => toast.error("Impossibile leggere questa immagine.");
    reader.readAsDataURL(file);
  };

  const handleIconChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    readIconFile(file, setNewIconUrl);
  };

  const openEdit = () => {
    setNewName(category.name);
    setNewIconUrl(category.iconUrl);
    setEditOpen(true);
  };

  const handleSave = () => {
    if (!isNameValid) {
      toast.error("Il nome deve avere tra 1 e 50 caratteri.");
      return;
    }
    if (!hasChanges) {
      setEditOpen(false);
      return;
    }
    const trimmedName = newName.trim();
    const data: { name?: string; iconUrl?: string | null } = {};
    if (nameChanged) data.name = trimmedName;
    if (iconChanged) data.iconUrl = newIconUrl;

    renameCategory.mutate(
      { categoryName: category.name, data },
      {
        onSuccess: (result) => {
          setEditOpen(false);
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
          // Se il nome è cambiato e l'utente è sulla pagina della skill, aggiorna l'URL
          if (nameChanged && location === categoryPath) {
            setLocation(`/category/${encodeURIComponent(trimmedName)}`, { replace: true });
          }
          // Invalida anche la query della categoria specifica
          queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(category.name) });
          if (nameChanged) {
            queryClient.invalidateQueries({ queryKey: getGetCategoryQueryKey(trimmedName) });
          }
          toast.success("Skill aggiornata");
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Impossibile aggiornare la skill");
        },
      },
    );
  };

  const handleDelete = () => {
    deleteCategory.mutate(
      { categoryName: category.name },
      {
        onSuccess: () => {
          setDeleteOpen(false);
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
          if (location === categoryPath) setLocation("/");
          toast.success("Percorso archiviato", {
            description: "Video e progressi sono stati conservati nella sezione Archived.",
          });
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Impossibile eliminare il percorso");
        },
      },
    );
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              // The row wraps a link, so Chrome would also attach the URL
              // flavor and offer its "split view" drop panel at the window
              // edge. This is a plain reorder: wipe everything and carry only
              // our own payload.
              e.dataTransfer.clearData();
              e.dataTransfer.setData("text/plain", String(index));
              onDragStart?.(index);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDragOver?.(e, index);
            }}
            onDragLeave={() => {
              onDragLeave?.();
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop?.(index);
            }}
            // dragend always fires at the source when the gesture ends
            // (drop anywhere, cancel, Escape): the only guaranteed cleanup
            // for the dragging highlight. Without it a drop outside the
            // items leaves the row gray (opacity-40) forever.
            onDragEnd={() => {
              onDragEnd?.();
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openEdit();
            }}
            className={cn(
              "group relative rounded-md transition-all duration-150",
              isDragging && "opacity-40 scale-95",
              isOver && "border-t-2 border-primary pt-1 shadow-sm",
            )}
          >
            {/* Button (not a link): real <a href> elements make Chrome show
                its link-preview bubble at the window corner on hover. */}
            <button
              type="button"
              onClick={() => {
                if (location !== categoryPath) setLocation(categoryPath);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openEdit();
              }}
              aria-current={location === categoryPath ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors cursor-grab active:cursor-grabbing",
                location === categoryPath
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <GripVertical className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 text-sidebar-foreground transition-opacity shrink-0 -mr-1" />
              {category.iconUrl ? (
                <img
                  src={category.iconUrl}
                  alt=""
                  className="h-5 w-5 rounded-md object-cover shrink-0"
                />
              ) : (
                <BookOpen className="h-4 w-4 opacity-70 shrink-0" />
              )}
              <span className={cn("flex-1 truncate", isUnread && "font-bold")}>{category.name}</span>
              {category.favorite && <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />}
              {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
              {category.watchedVideos === category.totalVideos && category.totalVideos > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              )}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-88 rounded-2xl border-border/80 bg-popover p-2 shadow-2xl">
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={toggleFavorite}>
            <Star className="h-5 w-5 shrink-0" />
            {category.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            <ContextMenuShortcut>P</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem className="h-11 gap-3 px-3 text-sm" onSelect={toggleUnread}>
            {isUnread ? <EyeOff className="h-5 w-5 shrink-0" /> : <Eye className="h-5 w-5 shrink-0" />}
            Segna come da leggere
            <ContextMenuShortcut>U</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem
            className="h-11 gap-3 px-3 text-sm"
            onSelect={openEdit}
          >
            <Pencil className="h-5 w-5 shrink-0" />
            Modifica
            <ContextMenuShortcut>R</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator className="my-1.5" />
          <ContextMenuItem
            className="h-11 gap-3 px-3 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-5 w-5 shrink-0" />
            Archivia
            <ContextMenuShortcut>D</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl border-border/80 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Modifica skill</DialogTitle>
            <DialogDescription>
              Cambia il nome o l'icona di questo percorso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Campo Nome */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Nome</label>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && isNameValid && hasChanges) handleSave();
                }}
                autoFocus
                maxLength={50}
                placeholder="Nome del percorso"
                className={cn(
                  "rounded-xl",
                  newName.trim().length > 50 && "border-destructive focus-visible:ring-destructive",
                )}
              />
              {newName.trim().length === 0 && editOpen && (
                <p className="text-xs text-destructive">Il nome è obbligatorio.</p>
              )}
              {newName.trim().length > 50 && (
                <p className="text-xs text-destructive">Massimo 50 caratteri.</p>
              )}
            </div>

            {/* Selettore Icona */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Icona</label>
              <div
                className={cn(
                  "group relative flex min-h-24 cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-dashed p-4 transition-all duration-300",
                  isDraggingIcon
                    ? "border-primary bg-primary/10 shadow-[0_0_0_4px_hsl(var(--primary)/0.12)] scale-[1.01]"
                    : "border-border/70 bg-background hover:border-primary/60 hover:bg-primary/[0.03]",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDraggingIcon(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) setIsDraggingIcon(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingIcon(false);
                  readIconFile(event.dataTransfer.files[0], setNewIconUrl);
                }}
                onClick={() => iconInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") iconInputRef.current?.click();
                }}
              >
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleIconChange}
                  className="sr-only"
                  tabIndex={-1}
                />
                <div
                  className={cn(
                    "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl transition-all duration-300",
                    newIconUrl ? "bg-transparent" : "bg-primary/10 text-primary",
                    isDraggingIcon && "scale-110 rotate-3",
                  )}
                >
                  {newIconUrl ? (
                    <img src={newIconUrl} alt="Anteprima icona skill" className="h-full w-full object-contain" />
                  ) : (
                    <UploadCloud
                      className={cn("h-6 w-6 transition-transform duration-300", isDraggingIcon && "animate-bounce")}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground text-sm">
                    {isDraggingIcon
                      ? "Rilascia qui la tua icona"
                      : newIconUrl
                        ? "Cambia icona"
                        : "Trascina qui un'immagine"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    oppure clicca per selezionare · Max 1 MB
                  </p>
                </div>
                {newIconUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setNewIconUrl(null);
                    }}
                    aria-label="Rimuovi icona"
                    className="relative z-10 shrink-0 h-8 w-8"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Annulla
            </Button>
            <Button
              onClick={handleSave}
              disabled={renameCategory.isPending || !hasChanges || !isNameValid}
            >
              {renameCategory.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-2xl border-border/80">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Archiviare "{category.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Il percorso scomparirà dalla libreria attiva, ma tutti i video, i preferiti e i progressi verranno conservati. Potrai ripristinarlo dalla sezione Archived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCategory.isPending ? "Archiviazione…" : "Archivia"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
