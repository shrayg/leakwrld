import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { TopNavModern } from '../navigation/TopNavModern';
import { MobileSidebar } from '../navigation/MobileSidebar';
import { BgCanvas } from '../shell/BgCanvas';
import { AdTopBanner } from '../shell/AdTopBanner';
import { LeaderboardDock } from '../shell/LeaderboardDock';
import { AuthModal } from '../shell/AuthModal';
import { ReferralModals } from '../shell/ReferralModals';
import { GlobalUrlHooks } from '../shell/GlobalUrlHooks';
import { FooterSection } from '../ui/footer-section';

export function AppLayout() {
  const { pathname, search } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return (
    <div className="app-root site-theme-pornwrld">
      <GlobalUrlHooks />
      <BgCanvas />
      <AdTopBanner />
      <TopNavModern
        menuOpen={sidebarOpen}
        onToggleMenu={() => setSidebarOpen((prev) => !prev)}
      />
      <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <Outlet />
      </main>
      <LeaderboardDock />
      <AuthModal />
      <ReferralModals />
      <FooterSection />
    </div>
  );
}
