import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useListCategories, useUpdateCategoryPosition, getListCategoriesQueryKey, getGetDashboardQueryKey, getGetFavoritesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { PlusCircle, LayoutGrid, Sun, Moon, Sparkles, FolderHeart, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SkillTreeMark } from '@/components/brand/SkillTreeMark';
import { SkillTrackItem } from './SkillTrackItem';

function useDarkMode() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  const toggle = () => {
    const next = !isDark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('skillpath-theme', next ? 'dark' : 'light');
    setIsDark(next);
  };

  return { isDark, toggle };
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { data: categories, isLoading } = useListCategories();
  const { isDark, toggle } = useDarkMode();
  const queryClient = useQueryClient();
  const updateCategoryPosition = useUpdateCategoryPosition();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [localCategories, setLocalCategories] = useState(categories);

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (_e: React.DragEvent, index: number) => {
    setOverIndex(index);
  };

  const handleDragLeave = () => {
    setOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setOverIndex(null);
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex || !localCategories) {
      setDraggedIndex(null);
      setOverIndex(null);
      return;
    }

    const items = [...localCategories];
    const [moved] = items.splice(draggedIndex, 1);
    items.splice(targetIndex, 0, moved);

    setLocalCategories(items);
    setDraggedIndex(null);
    setOverIndex(null);

    const order = items.map((c) => String(c.id));

    updateCategoryPosition.mutate(
      { data: { order } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFavoritesQueryKey() });
          toast.success("Ordine skill aggiornato");
        },
        onError: () => {
          setLocalCategories(categories);
          toast.error("Impossibile salvare il nuovo ordine delle skill");
        },
      }
    );
  };

  return (
    <aside className="sticky top-0 hidden h-[100dvh] max-h-[100dvh] w-64 shrink-0 self-start flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="p-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setLocation("/")}
          aria-label="Vai alla Dashboard"
          className="flex items-center gap-3"
        >
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-black shadow-sm">
            <SkillTreeMark className="h-8 w-8 object-cover" />
          </div>
          <span className="font-serif text-xl font-bold tracking-tight">SkillTree</span>
        </button>
        <button
          data-theme-toggle
          onClick={toggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 px-4 space-y-8 overflow-y-auto pb-6">
        <div>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setLocation("/")}
              aria-current={location === "/" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors",
                location === "/"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setLocation("/add")}
              aria-current={location === "/add" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors",
                location === "/add"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <PlusCircle className="w-4 h-4" />
              Import Content
            </button>
            <button
              type="button"
              onClick={() => setLocation("/favorites")}
              aria-current={location === "/favorites" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors",
                location === "/favorites"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <FolderHeart className="w-4 h-4" />
              Favorites
            </button>
            <button
              type="button"
              onClick={() => setLocation("/coach")}
              aria-current={location === "/coach" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors",
                location === "/coach"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Sparkles className="w-4 h-4" />
              Learning Coach
            </button>
            <button
              type="button"
              onClick={() => setLocation("/archived")}
              aria-current={location === "/archived" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 rounded-md text-left text-sm font-medium transition-colors",
                location === "/archived"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Archive className="w-4 h-4" />
              Archived
            </button>
          </div>
        </div>

        <div>
          <h3 className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2">
            Skill Tracks
          </h3>
          <div className="space-y-1">
            {isLoading ? (
              <div className="px-3 space-y-2">
                <Skeleton className="h-8 w-full bg-sidebar-accent/50" />
                <Skeleton className="h-8 w-full bg-sidebar-accent/50" />
                <Skeleton className="h-8 w-[80%] bg-sidebar-accent/50" />
              </div>
            ) : localCategories?.length ? (
              localCategories.map((category, index) => (
                <SkillTrackItem
                  key={category.id}
                  category={category}
                  index={index}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedIndex === index}
                  isOver={overIndex === index}
                />
              ))
            ) : (
              <p className="px-3 text-sm text-sidebar-foreground/50 italic">
                No skills tracked yet.
              </p>
            )}
          </div>
        </div>
      </nav>
    </aside>
  );
}
