import React, { useState } from 'react';
import { useGetDashboard, type Video } from '@workspace/api-client-react';
import { CategoryCard } from '@/components/shared/CategoryCard';
import { VideoCard } from '@/components/shared/VideoCard';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, CheckCircle, Clock, Trophy } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { VideoPlayerDialog } from '@/components/shared/VideoPlayerDialog';

export default function Dashboard() {
  const { data, isLoading, isError } = useGetDashboard();
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-10 animate-in fade-in duration-500 pb-12">
        <div className="space-y-4">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-6 w-96 rounded-md" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48 rounded-md" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-72 w-full rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center bg-destructive/5 text-destructive rounded-2xl border border-destructive/20 mt-10">
        <p className="font-medium text-lg mb-2">Failed to load dashboard.</p>
        <p className="text-sm opacity-80">Please check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-12 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground tracking-tight">
          Your Studio.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl font-medium">
          A clear view of your learning journey across all skill tracks.
        </p>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<BookOpen />} label="Total Videos" value={data.totalVideos} />
        <StatCard icon={<CheckCircle />} label="Completed" value={data.watchedVideos} />
        <StatCard icon={<Clock />} label="Hours Watched" value={data.totalHoursWatched.toFixed(1)} />
        <StatCard icon={<Trophy />} label="Overall Progress" value={`${Math.round(data.progressPercent)}%`} />
      </div>

      {/* Continue Learning */}
      {data.currentlyLearning.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-serif font-bold tracking-tight">Continue Learning</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {data.currentlyLearning.map(video => (
              <VideoCard
                key={video.id}
                video={video}
                videos={data.currentlyLearning}
                onOpenVideo={(selected) => {
                  setSelectedVideo(selected);
                  setPlayerOpen(true);
                }}
                categoryName={video.categoryName}
              />
            ))}
          </div>
        </section>
      )}

      <VideoPlayerDialog
        video={selectedVideo}
        videos={data.currentlyLearning}
        initialVideoId={selectedVideo?.id}
        open={playerOpen}
        onOpenChange={setPlayerOpen}
      />

      {/* Categories */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-2xl font-serif font-bold tracking-tight">Skill Tracks</h2>
          {data.categories.length > 0 && (
            <Button variant="outline" asChild className="shrink-0 bg-background/50 backdrop-blur border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground">
              <Link href="/add">Add More Content</Link>
            </Button>
          )}
        </div>
        
        {data.categories.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.categories.map(cat => (
              <CategoryCard key={cat.id} category={cat} />
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-2 shadow-none border-primary/20">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                <BookOpen className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-3">No tracks yet</h3>
              <p className="text-muted-foreground max-w-sm mb-8 font-medium">
                Start building your library by importing YouTube videos, playlists, or channels to create your first skill track.
              </p>
              <Button size="lg" asChild className="px-8 font-semibold shadow-md">
                <Link href="/add">Import Content</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number }) {
  return (
    <Card className="border-transparent bg-card/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6 flex items-center gap-5">
        <div className="p-3.5 rounded-2xl bg-primary/10 text-primary shadow-inner">
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "w-6 h-6" })}
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-serif font-bold mt-1 tracking-tight text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
