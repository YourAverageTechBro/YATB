import '@tanstack/react-start/server-only'
import { EmailMessage } from 'cloudflare:email'

export type StudioEmail = Readonly<{
  to: string
  subject: string
  text: string
}>

type EmailBindings = Readonly<{
  AUTH_EMAIL: SendEmail
  DB: D1Database
  EMAIL_FROM: string
  EMAIL_MODE: string
}>

function mimeMessage(from: string, email: StudioEmail): string {
  return [
    `From: Your Average Tech Bro Studio <${from}>`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    email.text,
  ].join('\r\n')
}

export async function sendStudioEmail(
  bindings: EmailBindings,
  email: StudioEmail,
): Promise<void> {
  if (bindings.EMAIL_MODE === 'capture') {
    await bindings.DB.prepare(
      'INSERT INTO email_outbox (recipient, subject, body) VALUES (?, ?, ?)',
    )
      .bind(email.to, email.subject, email.text)
      .run()
    return
  }

  await bindings.AUTH_EMAIL.send(
    new EmailMessage(
      bindings.EMAIL_FROM,
      email.to,
      mimeMessage(bindings.EMAIL_FROM, email),
    ),
  )
}
