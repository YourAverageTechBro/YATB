import { Button } from '@/components/ui/button'
import { loadPaidOnboarding } from '@/server/stripe.functions'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

type SuccessSearch = {
  session_id?: string
}

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export const Route = createFileRoute('/success')({
  validateSearch: (search: Record<string, unknown>): SuccessSearch => ({
    session_id:
      typeof search.session_id === 'string' ? search.session_id : undefined,
  }),
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  loader: ({ deps }) => {
    if (!deps.sessionId) {
      throw redirect({ to: '/', headers: PRIVATE_NO_STORE_HEADERS })
    }

    return loadPaidOnboarding({ data: deps.sessionId })
  },
  headers: () => PRIVATE_NO_STORE_HEADERS,
  component: SuccessPage,
})

function SuccessPage() {
  const onboarding = Route.useLoaderData()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-bold mb-6">Payment Successful!</h1>
        <p className="text-lg mb-8 font-mono">
          Thank you for subscribing to the monthly coaching service. Here's how
          to get started:
        </p>

        <div className="bg-muted/30 p-6 rounded-lg mb-8">
          <h2 className="text-xl font-bold mb-4">Next Steps</h2>

          <div className="text-left font-mono space-y-6">
            <div className="flex flex-col gap-2">
              <h3 className="font-bold">1. Contact me for 1:1 chatting</h3>
              <p>Choose your preferred messaging platform:</p>

              <div className="space-y-3">
                <div className="bg-background p-3 rounded-md">
                  <p className="text-sm font-semibold mb-1">Discord:</p>
                  <code className="font-bold">{onboarding.discordHandle}</code>
                </div>

                <div className="bg-background p-3 rounded-md">
                  <p className="text-sm font-semibold mb-1">WhatsApp:</p>
                  <a
                    href={onboarding.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-bold"
                  >
                    {onboarding.whatsappLabel}
                  </a>
                </div>
              </div>

              <p className="text-sm mt-2 text-muted-foreground">
                If you have any issues, please email me at{' '}
                <a
                  href={`mailto:${onboarding.supportEmail}`}
                  className="text-primary hover:underline"
                >
                  {onboarding.supportEmail}
                </a>
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-bold">2. Book your first call</h3>
              <p>Schedule your first coaching call using the link below</p>
              <Button className="w-full" asChild>
                <a
                  href={onboarding.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2"
                >
                  Book Your First Call <ExternalLink size={16} />
                </a>
              </Button>
            </div>
          </div>
        </div>

        <Button variant="outline" asChild className="font-mono">
          <Link to="/">Return to Home</Link>
        </Button>
      </div>
    </div>
  )
}
