import { createFileRoute } from '@tanstack/react-router'
import { parseShareToken } from '#/domain/file-library'
import { GuestReviewPage } from '#/components/guest-review-page'
import { loadSharedReview } from '#/server/reviews.functions'

export const Route = createFileRoute('/shared-reviews/$token')({
  loader: async ({ params }) => {
    try { parseShareToken(params.token) } catch {
      return { available: false as const }
    }
    return loadSharedReview({ data: params.token })
  },
  component: SharedReviewRoute,
})

function SharedReviewRoute() {
  const data = Route.useLoaderData()
  const { token } = Route.useParams()
  return <GuestReviewPage token={token} data={data} />
}
