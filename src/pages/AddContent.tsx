import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useImportContent,
  useListCategories,
  getGetCategoryQueryKey,
  getGetDashboardQueryKey,
  getListCategoriesQueryKey,
  type SkillLevel,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Youtube, Link as LinkIcon, ImagePlus, X, ChevronDown, Check, UploadCloud, BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const importSchema = z.object({
  url: z.string().url("Please enter a valid URL").refine((val) => val.includes("youtube.com") || val.includes("youtu.be"), {
    message: "Must be a YouTube URL",
  }),
  categoryName: z.string().min(1, "Skill track name is required").max(50, "Name is too long"),
  level: z.enum(["Beginner", "Intermediate", "Advanced", "Expert"]).optional(),
  iconUrl: z.string().max(1_500_000, "Image is too large").nullable().optional(),
});

type ImportFormValues = z.infer<typeof importSchema>;

export default function AddContent() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const importContent = useImportContent();
  const { data: categories } = useListCategories();
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [isDraggingIcon, setIsDraggingIcon] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const categoryFromQuery = useMemo(
    () => new URLSearchParams(window.location.search).get('category')?.trim() ?? '',
    [],
  );
  const levelFromQuery = useMemo(() => {
    const level = new URLSearchParams(window.location.search).get('level');
    return level === "Beginner" || level === "Intermediate" || level === "Advanced" || level === "Expert"
      ? level as SkillLevel
      : undefined;
  }, []);
  const lockedCategory = categories?.find((category) => category.name === categoryFromQuery);
  const isTrackImport = Boolean(categoryFromQuery);

  const form = useForm<ImportFormValues>({
    resolver: zodResolver(importSchema),
    defaultValues: {
      url: '',
      categoryName: '',
      level: undefined,
      iconUrl: null,
    },
  });

  useEffect(() => {
    if (!categoryFromQuery) return;
    form.setValue('categoryName', categoryFromQuery, { shouldValidate: true });
    form.setValue('level', levelFromQuery);
    form.setValue('iconUrl', lockedCategory?.iconUrl ?? null);
  }, [categoryFromQuery, form, levelFromQuery, lockedCategory?.iconUrl]);

  const onSubmit = (values: ImportFormValues) => {
    importContent.mutate({ data: values }, {
      onSuccess: async (result) => {
        toast.success(`Imported ${result.importedCount} videos!`, {
          description: `Successfully added to ${result.category.name}.`
        });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        queryClient.removeQueries({ queryKey: getGetCategoryQueryKey(result.category.name) });
        await queryClient.refetchQueries({
          queryKey: getGetCategoryQueryKey(result.category.name),
          type: "all",
        });
        setLocation(`/category/${encodeURIComponent(result.category.name)}`);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "Please check the URL and try again.";
        const isYouTubeAccessIssue = /YouTube quota|YouTube API access|YouTube could not be reached|YouTube returned no usable/i.test(message);
        toast.error("Failed to import content", {
          description: isYouTubeAccessIssue
            ? `${message} Previously imported metadata is reused automatically when it is available.`
            : message,
        });
      }
    });
  };

  const handleIconChange = (event: React.ChangeEvent<HTMLInputElement>, onChange: (value: string | null) => void) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    readIconFile(file, onChange);
  };

  const readIconFile = (file: File | undefined, onChange: (value: string | null) => void) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error("Scegli un file immagine.");
      return;
    }
    if (file.size > 1_000_000) {
      toast.error("L'icona della skill deve essere più piccola di 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => toast.error("Impossibile leggere questa immagine.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12 mt-4">
      <header className="mb-10 text-center">
        <h1 className="text-4xl md:text-5xl font-serif font-bold mb-4 text-foreground tracking-tight">Expand Your Knowledge</h1>
        <p className="text-lg text-muted-foreground max-w-lg mx-auto font-medium">
          Import a YouTube video, playlist, or entire channel to build up your skill tracks.
        </p>
      </header>

      <Card className="shadow-lg border-primary/10 overflow-hidden rounded-[2rem]">
        <CardHeader className="bg-primary/5 border-b border-primary/10 pb-8 pt-8">
          <div className="flex items-center gap-4 mb-3 justify-center">
            <div className="p-3 bg-red-500/10 text-red-500 rounded-2xl shadow-inner">
              <Youtube className="w-8 h-8" />
            </div>
            <CardTitle className="text-3xl font-serif">YouTube Import</CardTitle>
          </div>
          <CardDescription className="text-base text-center font-medium">
            We'll automatically extract titles, durations, and sort them.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 md:p-10 bg-card">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="text-base font-bold text-foreground flex items-center gap-2">
                      <LinkIcon className="w-4 h-4 text-primary" /> Source URL
                    </FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://www.youtube.com/watch?v=... or playlist" 
                        {...field} 
                        autoComplete="off"
                        spellCheck={false}
                        className="h-14 text-base shadow-sm bg-background border-border/60 rounded-xl px-4 focus-visible:ring-primary/50"
                        data-testid="input-youtube-url"
                      />
                    </FormControl>
                    <FormDescription className="font-medium text-xs">
                      Supports individual videos, full playlists, and channel pages.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isTrackImport ? (
                <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                    {lockedCategory?.iconUrl ? (
                      <img src={lockedCategory.iconUrl} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <BookOpen className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-primary">Importing into</p>
                    <p className="truncate font-semibold text-foreground">{categoryFromQuery}</p>
                    {levelFromQuery && (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-primary">
                        Tutti i video saranno {levelFromQuery.toLowerCase()}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="categoryName"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel className="text-base font-bold text-foreground flex items-center gap-2">
                          <Plus className="w-4 h-4 text-primary" /> Skill Track Name
                        </FormLabel>
                        <FormControl>
                          <Popover open={skillMenuOpen} onOpenChange={setSkillMenuOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex h-14 w-full items-center gap-3 rounded-xl border border-border/60 bg-background px-4 text-left text-base shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/50"
                            data-testid="input-category-name"
                          >
                            {(() => {
                              const selected = categories?.find((category) => category.name === field.value);
                              return selected?.iconUrl ? (
                                <img src={selected.iconUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
                              ) : (
                                <BookOpen className="h-5 w-5 shrink-0 text-primary" />
                              );
                            })()}
                            <span className={cn("flex-1 truncate", !field.value && "text-muted-foreground")}>
                              {field.value || "Scegli una skill o scrivi un nuovo nome..."}
                            </span>
                            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={8}
                          className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-2xl border-border/80 bg-popover p-2 shadow-2xl"
                        >
                          <Input
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Cerca o crea una skill..."
                            className="mb-2 h-11 rounded-xl border-border/70 bg-background"
                            autoFocus
                            autoComplete="off"
                          />
                          <div className="max-h-56 space-y-1 overflow-y-auto">
                            {categories
                              ?.filter((category) =>
                                category.name.toLowerCase().includes((field.value || "").toLowerCase()),
                              )
                              .map((category) => (
                                <button
                                  key={category.id}
                                  type="button"
                                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
                                  onClick={() => {
                                    field.onChange(category.name);
                                    setSkillMenuOpen(false);
                                  }}
                                >
                                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
                                    {category.iconUrl ? (
                                      <img src={category.iconUrl} alt="" className="h-full w-full object-contain" />
                                    ) : (
                                      <BookOpen className="h-4 w-4" />
                                    )}
                                  </span>
                                  <span className="flex-1 truncate font-semibold">{category.name}</span>
                                  {field.value === category.name && <Check className="h-4 w-4 text-primary" />}
                                </button>
                              ))}
                            {field.value.trim() && !categories?.some((category) => category.name === field.value.trim()) && (
                              <button
                                type="button"
                                className="flex w-full items-center gap-3 rounded-xl bg-primary/5 px-3 py-3 text-left text-primary transition-colors hover:bg-primary/10"
                                onClick={() => setSkillMenuOpen(false)}
                              >
                                <Plus className="h-5 w-5" />
                                <span className="font-semibold">Crea “{field.value.trim()}”</span>
                              </button>
                            )}
                            {!categories?.length && !field.value && (
                              <p className="px-3 py-3 text-sm text-muted-foreground">Scrivi il nome della tua prima skill.</p>
                            )}
                          </div>
                        </PopoverContent>
                            </Popover>
                        </FormControl>
                        <FormDescription className="font-medium text-xs">
                          Scegli una skill esistente o creane una nuova.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="iconUrl"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel className="text-base font-bold text-foreground flex items-center gap-2">
                          <ImagePlus className="w-4 h-4 text-primary" /> Skill Icon
                        </FormLabel>
                        <FormControl>
                          <div
                        className={cn(
                          "group relative flex min-h-28 cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-dashed p-4 transition-all duration-300",
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
                          readIconFile(event.dataTransfer.files[0], field.onChange);
                        }}
                        onClick={() => iconInputRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") iconInputRef.current?.click();
                        }}
                        data-testid="input-skill-icon"
                      >
                        <input
                          ref={iconInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(event) => handleIconChange(event, field.onChange)}
                          className="sr-only"
                          tabIndex={-1}
                        />
                        <div className={cn(
                          "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl transition-all duration-300",
                          field.value ? "bg-transparent" : "bg-primary/10 text-primary",
                          isDraggingIcon && "scale-110 rotate-3",
                        )}>
                          {field.value ? (
                            <img src={field.value} alt="Anteprima icona skill" className="h-full w-full object-contain" />
                          ) : (
                            <UploadCloud className={cn("h-7 w-7 transition-transform duration-300", isDraggingIcon && "animate-bounce")} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground">
                            {isDraggingIcon ? "Rilascia qui la tua icona" : field.value ? "Cambia icona skill" : "Trascina qui un’immagine"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            oppure clicca per selezionare un file
                          </p>
                        </div>
                        {field.value && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              field.onChange(null);
                            }}
                            aria-label="Rimuovi icona skill"
                            className="relative z-10 shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <div className="pt-4">
                <Button 
                  type="submit" 
                  className="w-full h-14 text-lg font-bold rounded-xl shadow-md hover:shadow-lg transition-all"
                  disabled={importContent.isPending}
                  data-testid="btn-import-submit"
                >
                  {importContent.isPending ? (
                    <>
                      <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                      Analyzing Content...
                    </>
                  ) : (
                    <>
                      <Youtube className="mr-3 h-6 w-6" />
                      Import Content
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
