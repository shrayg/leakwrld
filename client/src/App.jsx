import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider } from './components/AuthContext';
import { CategoriesPage } from './pages/CategoriesPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CreatorDetailPage } from './pages/CreatorDetailPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ShortsPage } from './pages/ShortsPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/shorts" element={<ShortsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/creators/:slug" element={<CreatorDetailPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/premium" element={<Navigate to="/checkout" replace />} />
          <Route path="/login" element={<Navigate to="/?auth=login" replace />} />
          <Route path="/signup" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="/create-account" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
