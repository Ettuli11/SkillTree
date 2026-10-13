import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';

import { Shell } from '@/components/layout/Shell';
import Dashboard from '@/pages/Dashboard';
import CategoryDetail from '@/pages/CategoryDetail';
import PlaylistDetail from '@/pages/PlaylistDetail';
import AddContent from '@/pages/AddContent';
import NotFound from '@/pages/not-found';
import LearningCoach from '@/pages/LearningCoach';
import Favorites from '@/pages/Favorites';
import Archived from '@/pages/Archived';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/category/:name/playlist/:playlist" component={PlaylistDetail} />
        <Route path="/category/:name" component={CategoryDetail} />
        <Route path="/add" component={AddContent} />
          <Route path="/favorites" component={Favorites} />
          <Route path="/archived" component={Archived} />
         <Route path="/coach" component={LearningCoach} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
        <Router />
      </WouterRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}

export default App;
