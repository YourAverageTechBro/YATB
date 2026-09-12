import '@tanstack/react-start/server-only'

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

  await bindings.AUTH_EMAIL.send({
    from: { name: 'Your Average Tech Bro Studio', email: bindings.EMAIL_FROM },
    to: email.to,
    subject: email.subject,
    text: email.text,
  })
}
