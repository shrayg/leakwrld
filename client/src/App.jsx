import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CheckoutPage } from './pages/CheckoutPage';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { ShortsPage } from './pages/ShortsPage';
import { FolderPage } from './pages/FolderPage';
import { VideoPage } from './pages/VideoPage';
import { SearchPage } from './pages/SearchPage';
import { OnlyFansPage } from './pages/OnlyFansPage';
import { VideoSectionPage } from './pages/VideoSectionPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { AccountPage } from './pages/AccountPage';
import { CustomRequestsPage } from './pages/CustomRequestsPage';
import { BlogPage } from './pages/BlogPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { VideoBySlugPage } from './pages/VideoBySlugPage';
import { AgeGateModal } from './components/shell/AgeGateModal';
import { ScrollToTop } from './components/layout/ScrollToTop';
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
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/recommended" element={<VideoSectionPage variant="recommended" />} />
          <Route path="/recommended.html" element={<Navigate to="/recommended" replace />} />
          <Route path="/popular" element={<VideoSectionPage variant="popular" />} />
          <Route path="/popular.html" element={<Navigate to="/popular" replace />} />
          <Route path="/newly-added" element={<VideoSectionPage variant="newlyAdded" />} />
          <Route path="/newly-added.html" element={<Navigate to="/newly-added" replace />} />
          <Route path="/random-video" element={<VideoSectionPage variant="random" />} />
          <Route path="/random-video.html" element={<Navigate to="/random-video" replace />} />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/shorts" element={<ShortsPage />} />
          <Route path="/shorts.html" element={<Navigate to="/shorts" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/search.html" element={<Navigate to="/search" replace />} />
          <Route path="/new-releases" element={<Navigate to="/newly-added" replace />} />
          <Route path="/new-releases.html" element={<Navigate to="/newly-added" replace />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/categories.html" element={<Navigate to="/categories" replace />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/upload" element={<Navigate to="/account" replace />} />
          <Route path="/upload.html" element={<Navigate to="/account" replace />} />
          <Route path="/live-cams" element={<Navigate to="/search" replace />} />
          <Route path="/live-cams.html" element={<Navigate to="/search" replace />} />
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
          <Route path="/folder" element={<FolderPage />} />
          <Route path="/folder.html" element={<FolderPage />} />
          <Route path="/video" element={<VideoPage />} />
          <Route path="/video.html" element={<VideoPage />} />
          <Route path="/nsfw-straight" element={<FolderPage seoFolder="NSFW Straight" />} />
          <Route path="/alt-and-goth" element={<FolderPage seoFolder="Alt and Goth" />} />
          <Route path="/petitie" element={<FolderPage seoFolder="Petitie" />} />
          <Route path="/teen-18-plus" element={<FolderPage seoFolder="Teen (18+ only)" />} />
          <Route path="/milf" element={<FolderPage seoFolder="MILF" />} />
          <Route path="/asian" element={<FolderPage seoFolder="Asian" />} />
          <Route path="/ebony" element={<FolderPage seoFolder="Ebony" />} />
          <Route path="/feet" element={<FolderPage seoFolder="Feet" />} />
          <Route path="/hentai" element={<FolderPage seoFolder="Hentai" />} />
          <Route path="/yuri" element={<FolderPage seoFolder="Yuri" />} />
          <Route path="/yaoi" element={<FolderPage seoFolder="Yaoi" />} />
          <Route path="/nip-slips" element={<FolderPage seoFolder="Nip Slips" />} />
          <Route path="/omegle" element={<FolderPage seoFolder="Omegle" />} />
          <Route path="/of-leaks" element={<FolderPage seoFolder="OF Leaks" />} />
          <Route path="/premium-leaks" element={<FolderPage seoFolder="Premium Leaks" />} />
          <Route path="/onlyfans" element={<OnlyFansPage />} />
          <Route path="/:categorySlug/:videoSlug" element={<VideoBySlugPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
