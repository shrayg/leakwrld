import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-[var(--border-1)] bg-[var(--surface-2)] p-4 shadow-[0_1px_0_0_var(--shadow-flat)]",
        className,
      )}
      {...props}
    />
  );
}
