import React from 'react';
import { Link } from 'wouter';
import { Category } from '@workspace/api-client-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { BookOpen } from 'lucide-react';

interface CategoryCardProps {
  category: Category;
}

export function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link href={`/category/${encodeURIComponent(category.name)}`} className="block h-full group" data-testid={`card-category-${category.id}`}>
      <Card className="h-full hover-elevate transition-all duration-300 cursor-pointer border-transparent hover:border-primary/20 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
              {category.iconUrl ? (
                <img src={category.iconUrl} alt="" className="w-5 h-5 rounded-md object-cover" />
              ) : (
                <BookOpen className="w-5 h-5" />
              )}
            </div>
            <div className="text-right">
              <span className="text-sm font-semibold text-foreground">
                {category.watchedVideos}
              </span>
              <span className="text-sm text-muted-foreground ml-1">
                / {category.totalVideos} videos
              </span>
            </div>
          </div>
          <CardTitle className="mt-4 font-serif text-xl line-clamp-1">{category.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">Progress</span>
              <span className="font-bold text-primary">{Math.round(category.progressPercent)}%</span>
            </div>
            <Progress value={category.progressPercent} className="h-2" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
