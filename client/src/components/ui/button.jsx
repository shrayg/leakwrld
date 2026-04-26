import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

const buttonVariants = cva('ui-btn', {
  variants: {
    variant: {
      default: 'ui-btn--default',
      destructive: 'ui-btn--destructive',
      outline: 'ui-btn--outline',
      secondary: 'ui-btn--secondary',
      ghost: 'ui-btn--ghost',
      link: 'ui-btn--link',
    },
    size: {
      default: 'ui-btn--default-size',
      sm: 'ui-btn--sm',
      lg: 'ui-btn--lg',
      icon: 'ui-btn--icon',
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
