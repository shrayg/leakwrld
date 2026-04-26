"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, House, PlusSquare, UserRound, Video } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "Home", icon: House },
  { href: "/shorts", label: "Shorts", icon: Video },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/upload", label: "Uploads", icon: PlusSquare },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function MobileTabbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border-1)] bg-[var(--surface-1)] md:hidden">
      <div className="grid grid-cols-5 px-2 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-[8px] text-[11px] font-medium",
                active ? "text-[var(--text-1)]" : "text-[var(--text-2)]",
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
