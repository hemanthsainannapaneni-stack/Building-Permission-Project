'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Radii stay small and the palette stays in tokens — restraint here is a
 * discipline, not a mood. See docs/06-frontend.md K.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium ' +
    'transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none ' +
    'disabled:opacity-50 disabled:scale-100 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 hover:shadow-md hover:shadow-blue-500/20 active:from-blue-800 active:to-indigo-800',
        secondary:
          'border border-border bg-surface text-text hover:bg-surface-sunk hover:border-border-strong shadow-subtle',
        ghost: 'text-text hover:bg-surface-sunk text-text-muted hover:text-text',
        destructive: 'bg-danger text-white hover:bg-danger/90 shadow-sm shadow-danger/20',
        link: 'text-primary underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        // The compact control that sits inside a table row or a card header,
        // where a `sm` button is already too tall for the line it shares.
        xs: 'h-7 px-2 text-caption rounded-md [&_svg]:size-3.5',
        sm: 'h-8 px-3 text-small rounded-md',
        md: 'h-9 px-4 text-body rounded-lg',
        lg: 'h-10 px-5 text-body rounded-xl font-semibold',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        // Tells a screen reader the control is working, not broken.
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
