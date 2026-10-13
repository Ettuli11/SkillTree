import { useState } from "react";
import { Link } from "wouter";
import {
  Bookmark,
  ChevronRight,
  FolderHeart,
  ListVideo,
  Star,
  Video as VideoIcon,
} from "lucide-react";
import { useGetCategory, useGetFavorites, type Video } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VideoCard } from "@/components/shared/VideoCard";
import { PlaylistCard } from "@/components/shared/PlaylistCard";
import { VideoPlayerDialog } from "@/components/shared/VideoPlayerDialog";

type FavoriteTab = "playlists" | "skills" | "videos";

export default function Favorites() {
  const { data, isLoading, isError } = useGetFavorites();
  const [activeTab, setActiveTab] = useState<FavoriteTab>("skills");
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-64 rounded-xl" />
        <Skeleton className="h-6 w-96 max-w-full rounded-md" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => <Skeleton key={item} className="h-52 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-destructive">Impossibile caricare i preferiti.</div>;
  }

  const counts = {
    playlists: data.playlists.length,
    skills: data.skills.length,
    videos: data.videos.length,
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><FolderHeart className="h-7 w-7" /></div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Favorites</h1>
        </div>
        <p className="max-w-2xl text-lg font-medium text-muted-foreground">Raccogli qui playlist, skill e video che vuoi ritrovare velocemente.</p>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FavoriteTab)} className="space-y-8">
        <TabsList className="h-auto flex-wrap rounded-xl border bg-card/80 p-1 shadow-sm">
          <TabsTrigger value="skills" className="gap-2 rounded-lg px-5 py-2.5 font-semibold">
            <Bookmark className="h-4 w-4" /> Skills <span className="text-xs opacity-70">({counts.skills})</span>
          </TabsTrigger>
          <TabsTrigger value="playlists" className="gap-2 rounded-lg px-5 py-2.5 font-semibold">
            <ListVideo className="h-4 w-4" /> Playlist <span className="text-xs opacity-70">({counts.playlists})</span>
          </TabsTrigger>
          <TabsTrigger value="videos" className="gap-2 rounded-lg px-5 py-2.5 font-semibold">
            <VideoIcon className="h-4 w-4" /> Videos <span className="text-xs opacity-70">({counts.videos})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="mt-0">
          {data.skills.length ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.skills.map((skill) => (
                <Link key={skill.id} href={`/category/${encodeURIComponent(skill.name)}`} className="group">
                  <Card className="h-full border-transparent bg-card/80 transition-all hover:border-primary/20 hover:shadow-md">
                    <CardContent className="flex items-center gap-4 p-6">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-primary">
                        {skill.iconUrl ? <img src={skill.iconUrl} alt="" className="h-full w-full object-contain" /> : <Bookmark className="h-6 w-6" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-xl font-bold">{skill.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{skill.totalVideos} video · {Math.round(skill.progressPercent)}% completato</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : <EmptyFavorites label="skill" />}
        </TabsContent>
        <TabsContent value="playlists" className="mt-0">
          <FavoritePlaylists playlists={data.playlists} videos={data.videos} />
        </TabsContent>
        <TabsContent value="videos" className="mt-0">
          {data.videos.length ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.videos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  videos={data.videos}
                  onOpenVideo={(selected) => {
                    setSelectedVideo(selected);
                    setPlayerOpen(true);
                  }}
                  categoryName={video.categoryName}
                />
              ))}
            </div>
          ) : <EmptyFavorites label="video" />}
        </TabsContent>
      </Tabs>

      <VideoPlayerDialog
        video={selectedVideo}
        videos={data.videos}
        initialVideoId={selectedVideo?.id}
        open={playerOpen}
        onOpenChange={setPlayerOpen}
      />
    </div>
  );
}

function FavoritePlaylists({
  playlists,
  videos,
}: {
  playlists: Array<{ sourceName: string; categoryName: string; videoCount: number; thumbnailUrl: string }>;
  videos: Video[];
}) {
  if (!playlists.length) return <EmptyFavorites label="playlist" />;
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {playlists.map((playlist) => (
        <FavoritePlaylistCard
          key={`${playlist.categoryName}-${playlist.sourceName}`}
          playlist={playlist}
          favoriteVideos={videos}
        />
      ))}
    </div>
  );
}

function FavoritePlaylistCard({
  playlist,
  favoriteVideos,
}: {
  playlist: { sourceName: string; categoryName: string; videoCount: number; thumbnailUrl: string };
  favoriteVideos: Video[];
}) {
  const { data } = useGetCategory(playlist.categoryName);
  const playlistVideos = data?.videos.filter(
    (video) => video.sourceType === "playlist" && video.sourceName === playlist.sourceName,
  ) ?? favoriteVideos.filter(
    (video) => video.categoryName === playlist.categoryName && video.sourceName === playlist.sourceName,
  );

  return (
    <PlaylistCard
      name={playlist.sourceName}
      videos={playlistVideos}
      selectedCount={0}
      selectionMode={false}
      categoryName={playlist.categoryName}
      onOpen={() => window.location.assign(
        `/category/${encodeURIComponent(playlist.categoryName)}/playlist/${encodeURIComponent(playlist.sourceName)}`,
      )}
      onSelect={() => undefined}
    />
  );
}

function EmptyFavorites({ label }: { label: string }) {
  return (
    <Card className="border-dashed bg-card/40">
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <Star className="mb-4 h-10 w-10 text-muted-foreground/40" />
        <h2 className="font-serif text-xl font-bold">Nessun {label} preferito</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Apri il menu con il tasto destro su un elemento e aggiungilo ai preferiti.</p>
      </CardContent>
    </Card>
  );
}