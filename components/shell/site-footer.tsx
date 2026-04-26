import Link from "next/link";

const links = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/community-guidelines", label: "Community Guidelines" },
];

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-[var(--border-1)] bg-[var(--surface-1)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[var(--text-2)] sm:px-6">
        <p className="max-w-2xl">
          18+ only. By entering this site you acknowledge the legal age requirements in your region and agree to our policies.
        </p>
        <div className="flex flex-wrap gap-3">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-[var(--text-1)]">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
