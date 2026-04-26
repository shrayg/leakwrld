import { cn } from "@/lib/utils";

export function Chip({
  className,
  active = false,
  children,
}: {
  className?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[8px] border px-2.5 py-1 text-xs font-medium",
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-1)]"
          : "border-[var(--border-1)] bg-[var(--surface-2)] text-[var(--text-2)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
