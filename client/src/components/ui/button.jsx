import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

const buttonVariants = cva('ui-btn', {
  variants: {
    variant: {
      default: 'ui-btn--default inline-flex items-center justify-center',
      destructive: 'ui-btn--destructive',
      outline: 'ui-btn--outline border border-[color:color-mix(in_srgb,var(--color-primary)_28%,transparent)]',
      secondary: 'ui-btn--secondary',
      ghost: 'ui-btn--ghost',
      link: 'ui-btn--link',
    },
    size: {
      default: 'ui-btn--default-size h-10 px-4',
      sm: 'ui-btn--sm',
      lg: 'ui-btn--lg',
      icon: 'ui-btn--icon h-9 w-9',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);

Button.displayName = 'Button';

export { Button, buttonVariants };
