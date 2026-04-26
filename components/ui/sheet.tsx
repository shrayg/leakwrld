"use client";

import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 rounded-t-[14px] border-t border-[var(--border-1)] bg-[var(--surface-2)] p-4 transition-transform",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        {children}
      </aside>
    </>
  );
}
