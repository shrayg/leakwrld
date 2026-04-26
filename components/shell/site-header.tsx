import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/shorts", label: "Shorts" },
  { href: "/explore", label: "Categories" },
  { href: "/upload", label: "Upload" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-1)] bg-[var(--surface-1)]/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-3 sm:px-6">
        <Link href="/" className="shrink-0 text-lg font-extrabold tracking-tight text-[var(--text-1)]">
          pornwrld
        </Link>
        <nav className="hidden items-center gap-2 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[8px] px-3 py-2 text-sm font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden w-full max-w-sm items-center gap-2 sm:flex">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-2)]" />
            <Input className="pl-9" placeholder="Search creators, videos, tags" />
          </div>
          <Button size="sm">Sign in</Button>
        </div>
      </div>
    </header>
  );
}
