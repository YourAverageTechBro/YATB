import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { normalizeEmail, sessionEmailAuthorized } from '#/domain/auth'
import { sendStudioEmail } from './email.server'

const PRIVATE_NO_STORE = 'private, no-store, max-age=0'
const bindings = env as Cloudflare.Env & {
  BETTER_AUTH_SECRET: string
  EMAIL_FROM: string
  EMAIL_MODE: string
}

async function enabledEmail(email: string): Promise<boolean> {
  const row = await bindings.DB.prepare(
    'SELECT enabled FROM allowed_email WHERE email = ?',
  )
    .bind(normalizeEmail(email))
    .first<{ enabled: number }>()
  return row?.enabled === 1
}

export function createAuth() {
  const origin = new URL(bindings.APP_ORIGIN).origin
  return betterAuth({
    appName: 'YATB Studio',
    baseURL: origin,
    secret: bindings.BETTER_AUTH_SECRET,
    database: bindings.DB,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await sendStudioEmail(bindings, {
          to: user.email,
          subject: 'Reset your Studio password',
          text: `Reset your password: ${url}`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url }) {
        await sendStudioEmail(bindings, {
          to: user.email,
          subject: 'Verify your Studio email',
          text: `Verify your email: ${url}`,
        })
      },
    },
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      cookiePrefix: 'yatb_studio',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: origin.startsWith('https://'),
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== '/sign-up/email') return
        const email = context.body?.email
        if (typeof email !== 'string' || !(await enabledEmail(email))) {
          throw new APIError('BAD_REQUEST', {
            message: 'Unable to create this account.',
          })
        }
        context.body.email = normalizeEmail(email)
      }),
    },
    plugins: [tanstackStartCookies()],
  })
}

export type StudioSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createAuth>['api']['getSession']>>
>

export async function getStudioSession(): Promise<StudioSession | null> {
  const session = await createAuth().api.getSession({
    headers: getRequestHeaders(),
  })
  if (
    !session ||
    !sessionEmailAuthorized(
      session.user.email,
      await enabledEmail(session.user.email),
    )
  ) {
    return null
  }
  return session
}

export { PRIVATE_NO_STORE }
