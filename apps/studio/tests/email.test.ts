import { describe, expect, it } from 'vitest'
import { sendStudioEmail } from '../src/server/email.server'

type EmailBindings = Parameters<typeof sendStudioEmail>[0]

const email = {
  to: 'dohyun@youraveragetechbro.com',
  subject: 'Verify your Studio account',
  text: 'Open the verification link.',
}

describe('Studio email delivery', () => {
  it('sends a structured message through the native Cloudflare binding', async () => {
    const sent: unknown[] = []
    const bindings = {
      AUTH_EMAIL: { send: async (message: unknown) => { sent.push(message) } },
      DB: { prepare: () => { throw new Error('Capture storage was used.') } },
      EMAIL_FROM: 'studio@studio-mail.youraveragetechbro.com',
      EMAIL_MODE: 'cloudflare',
    } as unknown as EmailBindings

    await sendStudioEmail(bindings, email)

    expect(sent).toEqual([{
      from: {
        name: 'Your Average Tech Bro Studio',
        email: 'studio@studio-mail.youraveragetechbro.com',
      },
      to: 'dohyun@youraveragetechbro.com',
      subject: 'Verify your Studio account',
      text: 'Open the verification link.',
    }])
  })

  it('stores local captures without calling the Cloudflare binding', async () => {
    const calls: unknown[][] = []
    const bindings = {
      AUTH_EMAIL: { send: async () => { throw new Error('Email was sent.') } },
      DB: {
        prepare: (query: string) => ({
          bind: (...values: unknown[]) => ({
            run: async () => { calls.push([query, ...values]) },
          }),
        }),
      },
      EMAIL_FROM: 'studio@studio-mail.youraveragetechbro.com',
      EMAIL_MODE: 'capture',
    } as unknown as EmailBindings

    await sendStudioEmail(bindings, email)

    expect(calls).toEqual([[
      'INSERT INTO email_outbox (recipient, subject, body) VALUES (?, ?, ?)',
      'dohyun@youraveragetechbro.com',
      'Verify your Studio account',
      'Open the verification link.',
    ]])
  })
})
