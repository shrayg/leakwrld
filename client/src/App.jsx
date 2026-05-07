import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CheckoutPage } from './pages/CheckoutPage';
import { AdminPage } from './pages/AdminPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { AccountPage } from './pages/AccountPage';
import { CustomRequestsPage } from './pages/CustomRequestsPage';
import { BlogPage } from './pages/BlogPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AgeGateModal } from './components/shell/AgeGateModal';
import { ScrollToTop } from './components/layout/ScrollToTop';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import {
  AboutPage,
  BrandPage,
  ChangelogPage,
  FaqsPage,
  HelpPage,
  PrivacyPage,
  TermsPage,
} from './pages/InfoPages';

export default function App() {
  return (
    <>
      <AgeGateModal />
      <ScrollToTop />
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/checkout.html" element={<Navigate to="/checkout" replace />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/categories" replace />} />
          <Route path="/recommended" element={<Navigate to="/categories" replace />} />
          <Route path="/recommended.html" element={<Navigate to="/categories" replace />} />
          <Route path="/popular" element={<Navigate to="/categories" replace />} />
          <Route path="/popular.html" element={<Navigate to="/categories" replace />} />
          <Route path="/newly-added" element={<Navigate to="/categories" replace />} />
          <Route path="/newly-added.html" element={<Navigate to="/categories" replace />} />
          <Route path="/random-video" element={<Navigate to="/categories" replace />} />
          <Route path="/random-video.html" element={<Navigate to="/categories" replace />} />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/shorts" element={<Navigate to="/categories" replace />} />
          <Route path="/shorts.html" element={<Navigate to="/categories" replace />} />
          <Route path="/search" element={<Navigate to="/categories" replace />} />
          <Route path="/search.html" element={<Navigate to="/categories" replace />} />
          <Route path="/new-releases" element={<Navigate to="/categories" replace />} />
          <Route path="/new-releases.html" element={<Navigate to="/categories" replace />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/categories.html" element={<Navigate to="/categories" replace />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/upload" element={<Navigate to="/account" replace />} />
          <Route path="/upload.html" element={<Navigate to="/account" replace />} />
          <Route path="/live-cams" element={<Navigate to="/categories" replace />} />
          <Route path="/live-cams.html" element={<Navigate to="/categories" replace />} />
          <Route path="/custom-requests" element={<CustomRequestsPage />} />
          <Route path="/custom-requests.html" element={<Navigate to="/custom-requests" replace />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog.html" element={<Navigate to="/blog" replace />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/faqs" element={<FaqsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="/brand" element={<BrandPage />} />
          <Route path="/premium" element={<Navigate to="/checkout" replace />} />
          <Route path="/login" element={<Navigate to="/?auth=login" replace />} />
          <Route path="/login.html" element={<Navigate to="/?auth=login" replace />} />
          <Route path="/signup" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="/signup.html" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="/create-account" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="/create-account.html" element={<Navigate to="/?auth=signup" replace />} />
          <Route path="/folder" element={<Navigate to="/categories" replace />} />
          <Route path="/folder.html" element={<Navigate to="/categories" replace />} />
          <Route path="/video" element={<Navigate to="/categories" replace />} />
          <Route path="/video.html" element={<Navigate to="/categories" replace />} />
          <Route path="/nsfw-straight" element={<Navigate to="/categories" replace />} />
          <Route path="/alt-and-goth" element={<Navigate to="/categories" replace />} />
          <Route path="/petite" element={<Navigate to="/categories" replace />} />
          <Route path="/petitie" element={<Navigate to="/petite" replace />} />
          <Route path="/teen-18-plus" element={<Navigate to="/categories" replace />} />
          <Route path="/milf" element={<Navigate to="/categories" replace />} />
          <Route path="/asian" element={<Navigate to="/categories" replace />} />
          <Route path="/ebony" element={<Navigate to="/categories" replace />} />
          <Route path="/feet" element={<Navigate to="/categories" replace />} />
          <Route path="/hentai" element={<Navigate to="/categories" replace />} />
          <Route path="/yuri" element={<Navigate to="/categories" replace />} />
          <Route path="/yaoi" element={<Navigate to="/categories" replace />} />
          <Route path="/nip-slips" element={<Navigate to="/categories" replace />} />
          <Route path="/omegle" element={<Navigate to="/categories" replace />} />
          <Route path="/of-leaks" element={<Navigate to="/categories" replace />} />
          <Route path="/premium-leaks" element={<Navigate to="/categories" replace />} />
          <Route path="/onlyfans" element={<Navigate to="/categories" replace />} />
          <Route path="/:categorySlug/:videoSlug" element={<Navigate to="/categories" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
