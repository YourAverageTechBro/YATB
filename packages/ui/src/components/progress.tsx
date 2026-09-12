import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils'

function Progress({ className, value = 0, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const percentage = value ?? 0
  return <ProgressPrimitive.Root data-slot="progress" className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)} value={value} {...props}>
    <ProgressPrimitive.Indicator data-slot="progress-indicator" className="h-full w-full flex-1 bg-primary transition-all" style={{ transform: `translateX(-${100 - percentage}%)` }} />
  </ProgressPrimitive.Root>
}

export { Progress }
