import { useState } from "react";
import { Archive, ArchiveRestore, AlertTriangle, Trash2 } from "lucide-react";
import {
  getGetDashboardQueryKey,
  getGetFavoritesQueryKey,
  getListArchivedCategoriesQueryKey,
  getListCategoriesQueryKey,
  useListArchivedCategories,
  usePermanentlyDeleteCategory,
  useRestoreCategory,
  type Category,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Button } from "@/components/ui/button";

export default function Archived() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListArchivedCategories();
  const restoreCategory = useRestoreCategory();
  const permanentlyDeleteCategory = usePermanentlyDeleteCategory();
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const invalidateLibrary = () => {
    queryClient.invalidateQueries({ queryKey: getListArchivedCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
  };

  const handleRestore = (category: Category) => {
    restoreCategory.mutate(
      { categoryName: category.name },
      {
        onSuccess: () => {
          invalidateLibrary();
          toast.success(`“${category.name}” è stata ripristinata`, {
            description: "Video, preferiti e progressi sono di nuovo disponibili.",
          });
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Impossibile ripristinare il percorso"),
      },
    );
  };

  const handlePermanentDelete = () => {
    if (!deleteTarget) return;
    const category = deleteTarget;
    permanentlyDeleteCategory.mutate(
      { categoryName: category.name },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          invalidateLibrary();
          toast.success(`“${category.name}” è stata eliminata definitivamente`);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Impossibile eliminare definitivamente il percorso"),
      },
    );
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Archive className="h-7 w-7" /></div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Archived</h1>
        </div>
        <p className="max-w-2xl text-lg font-medium text-muted-foreground">
          I percorsi archiviati conservano video, progressi e preferiti finché non scegli di ripristinarli o eliminarli definitivamente.
        </p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {[1, 2].map((item) => <Skeleton key={item} className="h-44 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-destructive">
          Impossibile caricare i percorsi archiviati.
        </div>
      ) : data?.length ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {data.map((category) => (
            <ArchivedCard
              key={category.id}
              category={category}
              restoring={restoreCategory.isPending}
              deleting={permanentlyDeleteCategory.isPending && deleteTarget?.id === category.id}
              onRestore={() => handleRestore(category)}
              onDelete={() => setDeleteTarget(category)}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-card/60">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Archive className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="font-serif text-2xl font-bold">Nothing archived</h2>
            <p className="max-w-md text-muted-foreground">Quando archivi un percorso, lo troverai qui e potrai recuperare tutto il suo progresso.</p>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-serif">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Eliminare definitivamente “{deleteTarget?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione rimuoverà per sempre il percorso, tutti i video e ogni progresso di visione. Non sarà possibile annullarla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {permanentlyDeleteCategory.isPending ? "Eliminazione…" : "Elimina definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ArchivedCard({
  category,
  restoring,
  deleting,
  onRestore,
  onDelete,
}: {
  category: Category;
  restoring: boolean;
  deleting: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="overflow-hidden border-border/70 bg-card/80">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-primary">
            {category.iconUrl ? <img src={category.iconUrl} alt="" className="h-full w-full object-contain" /> : <Archive className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-2xl font-bold">{category.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {category.totalVideos} video · {category.watchedVideos} completati · {Math.round(category.progressPercent)}% progresso
            </p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${category.progressPercent}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRestore} disabled={restoring || deleting} className="gap-2">
            <ArchiveRestore className="h-4 w-4" />
            {restoring ? "Ripristino…" : "Ripristina"}
          </Button>
          <Button variant="outline" onClick={onDelete} disabled={restoring || deleting} className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
            {deleting ? "Eliminazione…" : "Elimina definitivamente"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}