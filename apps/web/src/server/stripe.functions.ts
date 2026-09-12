import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

const PRIVATE_NO_STORE = 'private, no-store, max-age=0'

export const loadPaidOnboarding = createServerFn({ method: 'GET' })
  .validator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
    setResponseHeader('Cache-Control', PRIVATE_NO_STORE)
    const { verifyPaidOnboarding } = await import('./stripe.server')
    const onboarding = await verifyPaidOnboarding(sessionId)

    if (!onboarding) {
      throw redirect({
        to: '/',
        headers: { 'Cache-Control': PRIVATE_NO_STORE },
      })
    }

    return onboarding
  })

export const beginMonthlyCoachingCheckout = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { createMonthlyCheckout } = await import('./stripe.server')
    return { checkoutUrl: await createMonthlyCheckout() }
  })
