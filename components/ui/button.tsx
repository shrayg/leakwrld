"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-[1px]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_4px_0_0_var(--accent-shadow)] hover:-translate-y-px hover:shadow-[0_6px_0_0_var(--accent-shadow)] active:shadow-[0_2px_0_0_var(--accent-shadow)]",
        secondary:
          "bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border-1)] shadow-[0_4px_0_0_var(--shadow-flat)] hover:-translate-y-px hover:shadow-[0_6px_0_0_var(--shadow-flat)] active:shadow-[0_2px_0_0_var(--shadow-flat)]",
        ghost:
          "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] active:bg-[var(--surface-3)]",
        danger:
          "bg-[var(--danger)] text-white shadow-[0_4px_0_0_var(--danger-shadow)] hover:-translate-y-px hover:shadow-[0_6px_0_0_var(--danger-shadow)] active:shadow-[0_2px_0_0_var(--danger-shadow)]",
      },
      size: {
        sm: "h-9 px-3 rounded-[8px]",
        md: "h-10 px-4 rounded-[10px]",
        lg: "h-12 px-6 rounded-[10px]",
        icon: "h-10 w-10 rounded-[10px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
