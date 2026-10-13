import React from 'react';
import { Sidebar } from './Sidebar';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      <Sidebar />
      <main data-app-scroll-container className="h-[100dvh] min-h-0 flex-1 w-full overflow-y-auto">
        <div className="container relative mx-auto max-w-7xl px-4 py-8 md:px-8 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  );
}
