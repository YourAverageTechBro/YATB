import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import Stripe from 'stripe'

export type PaidOnboarding = Readonly<{
  discordHandle: string
  whatsappLabel: string
  whatsappUrl: string
  supportEmail: string
  bookingUrl: string
}>

const ONBOARDING: PaidOnboarding = {
  discordHandle: 'youraveragetechbro',
  whatsappLabel: '+1 (714) 365-9744',
  whatsappUrl: 'https://wa.me/17143659744',
  supportEmail: 'dohyun@youraveragetechbro.com',
  bookingUrl: 'https://cal.com/youraveragetechbro/60-min-free',
}

function requireBinding(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required Cloudflare binding: ${name}`)
  }

  return value
}

function createStripeClient() {
  const secretKey = requireBinding('STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY)

  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  })
}

function getCheckoutConfiguration() {
  const subscriptionPriceId = requireBinding(
    'STRIPE_SUBSCRIPTION_PRICE_ID',
    env.STRIPE_SUBSCRIPTION_PRICE_ID,
  )
  const originValue = requireBinding('APP_ORIGIN', env.APP_ORIGIN)
  const origin = new URL(originValue)

  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') {
    throw new Error('APP_ORIGIN must use HTTPS outside local development')
  }

  return {
    subscriptionPriceId,
    origin: origin.origin,
  }
}

export async function verifyPaidOnboarding(
  sessionId: string,
): Promise<PaidOnboarding | null> {
  try {
    const session = await createStripeClient().checkout.sessions.retrieve(
      sessionId,
    )

    return session.payment_status === 'paid' ? ONBOARDING : null
  } catch (error) {
    console.error('Unable to verify Stripe checkout session', error)
    return null
  }
}

export async function createMonthlyCheckout(): Promise<string> {
  const stripe = createStripeClient()
  const { subscriptionPriceId, origin } = getCheckoutConfiguration()
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: subscriptionPriceId, quantity: 1 }],
    mode: 'subscription',
    allow_promotion_codes: true,
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
    metadata: { productType: 'monthly_coaching' },
  })

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL')
  }

  return session.url
}
