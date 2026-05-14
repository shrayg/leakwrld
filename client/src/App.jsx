import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider } from './components/AuthContext';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';

const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const CreatorDetailPage = lazy(() => import('./pages/CreatorDetailPage').then((m) => ({ default: m.CreatorDetailPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const ReferralPage = lazy(() => import('./pages/ReferralPage').then((m) => ({ default: m.ReferralPage })));
const ShortsPage = lazy(() => import('./pages/ShortsPage').then((m) => ({ default: m.ShortsPage })));

function RouteFallback() {
  return (
    <div className="lw-page-head py-16 text-center text-white/60 text-sm" aria-busy="true">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/shorts" element={<ShortsPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/creators/:slug" element={<CreatorDetailPage />} />
              <Route path="/refer" element={<ReferralPage />} />
              <Route path="/account" element={<Navigate to="/refer" replace />} />
              <Route path="/refer/guide" element={<Navigate to="/refer" replace />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/premium" element={<Navigate to="/checkout" replace />} />
              <Route path="/login" element={<Navigate to="/?auth=login" replace />} />
              <Route path="/signup" element={<Navigate to="/?auth=signup" replace />} />
              <Route path="/create-account" element={<Navigate to="/?auth=signup" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </AuthProvider>
  );
}
