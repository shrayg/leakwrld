import { AgeGate } from "@/components/shell/age-gate";
import { CookieConsent } from "@/components/shell/cookie-consent";
import { MobileTabbar } from "@/components/shell/mobile-tabbar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-3 pb-20 pt-4 sm:px-6">{children}</main>
      <SiteFooter />
      <MobileTabbar />
      <AgeGate />
      <CookieConsent />
    </>
  );
}
