import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Check,
  Compass,
  GraduationCap,
  Loader2,
  PlayCircle,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  useBuildLearningPath,
  getGetDashboardQueryKey,
  getListCategoriesQueryKey,
  type LearningPathResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const levelCopy = {
  Beginner: {
    eyebrow: "Start here",
    title: "Beginner",
    description: "Foundations, interface, and your first projects.",
    color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  },
  Intermediate: {
    eyebrow: "Build fluency",
    title: "Intermediate",
    description: "Workflows, consistency, and practical techniques.",
    color: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  },
  Advanced: {
    eyebrow: "Go further",
    title: "Advanced",
    description: "Complex systems, problem solving, and production methods.",
    color: "bg-violet-500/10 text-violet-300 border-violet-500/20",
  },
  Expert: {
    eyebrow: "Mastery",
    title: "Expert",
    description: "Professional pipelines, precision, and creative direction.",
    color: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  },
} as const;

const progressStages = [
  { label: "Analyzing user request...", progress: 6 },
  { label: "Understanding your learning goal...", progress: 11 },
  { label: "Building a tailored search strategy...", progress: 16 },
  { label: "Searching recent and relevant playlists...", progress: 22 },
  { label: "Comparing beginner-friendly results...", progress: 28 },
  { label: "Searching for the best Beginner path...", progress: 34 },
  { label: "Searching for the best Intermediate path...", progress: 41 },
  { label: "Searching for the best Advanced path...", progress: 48 },
  { label: "Searching for the best Expert path...", progress: 55 },
  { label: "Checking tutorial freshness and quality...", progress: 61 },
  { label: "Checking playlist completeness...", progress: 66 },
  { label: "Filtering duplicates and weak matches...", progress: 71 },
  { label: "Assigning playlist difficulty...", progress: 76 },
  { label: "Reorganizing playlists into a learning sequence...", progress: 81 },
  { label: "Generating beginner level...", progress: 85 },
  { label: "Generating intermediate level...", progress: 88 },
  { label: "Generating advanced level...", progress: 91 },
  { label: "Generating expert level...", progress: 94 },
  { label: "Creating your personalized path...", progress: 97 },
  { label: "Almost done...", progress: 99 },
] as const;

export default function LearningCoach() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const buildPath = useBuildLearningPath();
  const [skill, setSkill] = useState("");
  const [goal, setGoal] = useState("");
  const [result, setResult] = useState<LearningPathResult | null>(null);
  const [progressStage, setProgressStage] = useState(0);

  useEffect(() => {
    if (!buildPath.isPending) {
      setProgressStage(0);
      return;
    }

    const timer = window.setInterval(() => {
      setProgressStage((current) => Math.min(current + 1, progressStages.length - 1));
    }, 900);

    return () => window.clearInterval(timer);
  }, [buildPath.isPending]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedSkill = skill.trim();
    if (trimmedSkill.length < 2) {
      toast.error("Scrivi una skill da imparare.");
      return;
    }

    setResult(null);
    setProgressStage(0);
    buildPath.mutate(
      {
        data: {
          skill: trimmedSkill,
          goal: goal.trim() || undefined,
          categoryName: `${trimmedSkill} — Complete Path`,
        },
      },
      {
        onSuccess: (path) => {
          setResult(path);
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          toast.success("Percorso creato", {
            description: `${path.totalImported} video pronti per il tuo percorso.`,
          });
        },
        onError: (error) => {
          toast.error("Non riesco a creare il percorso", {
            description:
              error instanceof Error
                ? error.message
                : "Controlla la richiesta e riprova.",
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-16 animate-in fade-in duration-500">
      <header className="relative overflow-hidden rounded-[2rem] border border-primary/20 bg-card p-8 shadow-sm md:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 text-primary/5">
          <WandSparkles className="h-80 w-80" />
        </div>
        <div className="relative max-w-3xl space-y-5">
          <Badge className="border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            YouTube Learning Coach
          </Badge>
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Il percorso giusto,
            <br />
            <span className="text-primary">un livello alla volta.</span>
          </h1>
          <p className="max-w-2xl text-base font-medium leading-relaxed text-muted-foreground md:text-lg">
            Dimmi cosa vuoi imparare. Il coach cerca su YouTube una playlist
            completa e pertinente per Beginner, Intermediate, Advanced ed Expert,
            poi organizza tutto in un unico percorso tracciabile.
          </p>
        </div>
      </header>

      <Card className="overflow-hidden rounded-[2rem] border-primary/15 shadow-lg">
        <CardHeader className="border-b border-primary/10 bg-primary/5 p-7 md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Compass className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="font-serif text-2xl">Crea il tuo learning path</CardTitle>
              <CardDescription className="mt-1.5 text-sm">
                La ricerca viene fatta ora, usando il catalogo YouTube aggiornato.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-7 md:p-8">
          <form onSubmit={handleSubmit} className="grid gap-5 md:grid-cols-[0.8fr_1.2fr_auto] md:items-end">
            <label className="space-y-2">
              <span className="text-sm font-bold">Cosa vuoi imparare?</span>
              <Input
                value={skill}
                onChange={(event) => setSkill(event.target.value)}
                placeholder="es. Blender, Python, fotografia"
                className="h-12 rounded-xl"
                maxLength={50}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold">Obiettivo (opzionale)</span>
              <Input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="es. creare personaggi 3D per videogiochi"
                className="h-12 rounded-xl"
                maxLength={180}
              />
            </label>
<Button type="submit" disabled={buildPath.isPending} className="h-12 rounded-xl px-6 font-bold">
              {buildPath.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sto cercando…
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Trova il percorso
                </>
              )}
            </Button>
          </form>
          {buildPath.isPending && (
            <div className="mt-7 space-y-3 rounded-2xl border border-border/60 bg-background/50 p-4">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="truncate pr-4">{progressStages[progressStage].label}</span>
                <span className="shrink-0 text-primary">{progressStages[progressStage].progress}%</span>
              </div>
              <Progress value={progressStages[progressStage].progress} className="h-2" />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <p>Searching YouTube, reasoning over results, and building all four levels.</p>
                <span className="shrink-0 font-medium text-primary">YouTube live</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground/70">
                {progressStages
                  .slice(Math.max(0, progressStage - 3), progressStage + 1)
                  .map((stage) => (
                    <span key={stage.label} className={stage === progressStages[progressStage] ? "font-semibold text-primary" : ""}>
                      {stage.label.replace("...", "")}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <section className="space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">Path ready</p>
              <h2 className="font-serif text-3xl font-bold">Il tuo percorso completo</h2>
              <p className="mt-2 text-muted-foreground">
                {result.totalImported} video importati in “{result.category.name}”.
              </p>
            </div>
            <Button onClick={() => setLocation(`/category/${encodeURIComponent(result.category.name)}`)} className="rounded-xl font-bold">
              <PlayCircle className="mr-2 h-4 w-4" />
              Inizia a imparare
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {result.levels.map((level, index) => {
              const copy = levelCopy[level.level];
              return (
                <Card key={level.level} onClick={() => setLocation(`/category/${encodeURIComponent(result.category.name)}/playlist/${encodeURIComponent(level.playlistTitle)}`)} className="group cursor-pointer overflow-hidden rounded-2xl border-border/70 transition-colors hover:border-primary/40">
                  <CardContent className="p-6">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-serif text-lg font-bold text-primary">
                          {index + 1}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{copy.eyebrow}</p>
                          <h3 className="font-serif text-2xl font-bold">{copy.title}</h3>
                        </div>
                      </div>
                      <Badge variant="outline" className={copy.color}>{level.videoCount} video</Badge>
                    </div>
                    <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Playlist selezionata</p>
                      <p className="line-clamp-2 font-semibold leading-snug">{level.playlistTitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{level.channelName}</p>
                    </div>
                    {level.note && (
                      <p className="mt-2 text-xs text-muted-foreground">{level.note}</p>
                    )}
                    <Button variant="ghost" asChild className="mt-3 h-9 px-2 text-primary hover:bg-primary/10 hover:text-primary">
                      <a href={level.url} target="_blank" rel="noopener noreferrer">
                        Vedi playlist originale <ArrowRight className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="rounded-2xl border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <GraduationCap className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-serif text-xl font-bold">Pronto per iniziare?</h3>
                <p className="text-sm text-muted-foreground">
                  Apri il track: ogni video ha il pulsante Complete e si guarda direttamente qui dentro.
                </p>
              </div>
              <Button onClick={() => setLocation(`/category/${encodeURIComponent(result.category.name)}`)} className="rounded-xl font-bold">
                Continue Learning <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </section>
      )}

      {!result && !buildPath.isPending && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(["Beginner", "Intermediate", "Advanced", "Expert"] as const).map((level, index) => (
            <div key={level} className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-serif text-2xl font-bold text-primary">0{index + 1}</span>
                <Check className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <p className="font-bold">{level}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{levelCopy[level].description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}