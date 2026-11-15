import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Activity,
  ArrowDownUp,
  Award,
  ChevronDown,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Trophy,
  WalletCards,
  X,
} from 'lucide-react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles.css';
import { api, ApiError, fmt, useApi, useMarketFeed } from './api';
import type { MarketState, Profile } from './api';
import { AuthPage } from './auth';
import { Logo, Notice, Pending, Status } from './components';
import {
  AchievementsPage,
  Admin,
  Dashboard,
  HistoryPage,
  Leaderboard,
  MarketDetail,
  Markets,
  Missing,
  PortfolioPage,
} from './pages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500),
    },
  },
});

const links = [
  { to: '/', title: 'Dashboard', icon: LayoutDashboard },
  { to: '/markets', title: 'Markets', icon: Activity },
  { to: '/portfolio', title: 'Portfolio', icon: WalletCards },
  { to: '/history', title: 'Trade History', icon: ArrowDownUp },
  { to: '/leaderboard', title: 'Leaderboard', icon: Trophy },
  { to: '/achievements', title: 'Achievements', icon: Award },
  { to: '/admin', title: 'Admin', icon: Settings2, admin: true },
];

function Shell({ user }: { user: Profile }) {
  const client = useQueryClient();
  const location = useLocation();
  const summary = useApi<MarketState>('/market/summary');
  const online = useMarketFeed();
  const [open, setOpen] = useState(false);
  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  const active = links.find(
    (link) =>
      link.to === location.pathname ||
      (link.to !== '/' && location.pathname.startsWith(link.to + '/')),
  );
  async function clearSession() {
    await client.cancelQueries();
    client.setQueryData(['/auth/me'], null);
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== '/auth/me' });
  }
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', {}),
    onSuccess: clearSession,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return clearSession();
    },
  });
  useEffect(() => {
    if (location.hash !== '#trade') window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  const logOut = () => {
    if (!logout.isPending) logout.mutate();
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={'sidebar ' + (open ? 'open' : '')}
        id="navigation"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <div className="sidebar-brand">
          <Link to="/" onClick={() => setOpen(false)} aria-label="ChainTrade dashboard">
            <Logo />
          </Link>
          <button
            className="icon-btn mobile-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {links
            .filter((link) => !link.admin || user.role === 'ADMIN')
            .map(({ to, title, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
                <Icon size={19} />
                {title}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="simulation-label">
            <ShieldCheck size={17} />
            <span>
              Simulation mode<small>Virtual funds only</small>
            </span>
          </div>
          <div className="sidebar-user">
            <span className="avatar">{initials}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === 'ADMIN' ? 'Administrator' : 'Trader'}</small>
            </span>
            <button
              className="icon-btn"
              aria-label="Sign out"
              disabled={logout.isPending}
              onClick={logOut}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon-btn menu-toggle"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="navigation"
              onClick={() => setOpen(!open)}
            >
              <Menu size={22} />
            </button>
            <span className="top-title">{active?.title ?? 'ChainTrade'}</span>
          </div>
          <div className="top-actions">
            <Status online={online && !summary.isError} paused={summary.data?.paused} />
            <div className="top-balance">
              <WalletCards size={17} />
              <strong>
                {fmt(user.balance)} <small>CST</small>
              </strong>
            </div>
            <code className="wallet-id" aria-label="Masked wallet address">
              {user.wallet}
            </code>
            <details className="profile-menu">
              <summary aria-label="Account menu">
                <span className="avatar">{initials}</span>
                <ChevronDown size={14} />
              </summary>
              <div className="profile-popover">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
                <small>Wallet {user.wallet}</small>
                <button className="btn secondary" disabled={logout.isPending} onClick={logOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        <main className="content" id="main-content">
          {logout.error && <Notice>{logout.error.message}</Notice>}
          <div className="route-content" key={location.pathname}>
            <Outlet />
          </div>
          <footer className="footer">
            <CircleHelp size={15} /> ChainTrade · Simulated markets on local Ethereum
          </footer>
        </main>
      </div>
    </div>
  );
}

function Root() {
  const user = useApi<Profile | null>('/auth/me');
  if (user.isPending)
    return (
      <div className="center-page">
        <Pending label="Opening ChainTrade…" />
      </div>
    );
  if (user.error && (!(user.error instanceof ApiError) || user.error.status !== 401)) {
    return (
      <div className="center-page">
        <div className="panel missing">
          <Logo />
          <h1>ChainTrade is unavailable</h1>
          <p>{user.error.message}</p>
          <button className="btn primary" onClick={() => void user.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const profile = user.error instanceof ApiError && user.error.status === 401 ? null : user.data;
  return (
    <Routes>
      <Route
        path="/login"
        element={profile ? <Navigate to="/" replace /> : <AuthPage key="login" register={false} />}
      />
      <Route
        path="/register"
        element={profile ? <Navigate to="/" replace /> : <AuthPage key="register" register />}
      />
      <Route element={profile ? <Shell user={profile} /> : <Navigate to="/login" replace />}>
        <Route index element={profile && <Dashboard user={profile} />} />
        <Route path="markets" element={<Markets />} />
        <Route path="markets/:symbol" element={<MarketDetail />} />
        <Route path="portfolio" element={<PortfolioPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="achievements" element={<AchievementsPage />} />
        <Route
          path="admin"
          element={profile?.role === 'ADMIN' ? <Admin /> : <Navigate to="/" replace />}
        />
        {profile && <Route path="*" element={<Missing />} />}
      </Route>
      {!profile && (
        <Route
          path="*"
          element={
            <div className="center-page">
              <Missing />
            </div>
          }
        />
      )}
    </Routes>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
