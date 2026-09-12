import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '../lib/utils'

const badgeVariants = cva('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
      secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
      destructive: 'border-destructive bg-background text-destructive [a&]:hover:bg-destructive [a&]:hover:text-background',
      outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

function Badge({ className, variant = 'default', asChild = false, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'span'
  return <Component data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
