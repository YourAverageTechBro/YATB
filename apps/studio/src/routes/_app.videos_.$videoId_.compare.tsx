import { createFileRoute, Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '@yatb/ui/alert'
import { Label } from '@yatb/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { useEffect } from 'react'
import { ReviewPane } from '#/components/review-pane'
import { parseComparisonQuery, partitionComparison, type ComparisonSelection, type Draft } from '#/domain/reviews'
import { loadComparison } from '#/server/reviews.functions'

export const Route = createFileRoute('/_app/videos_/$videoId_/compare')({
  validateSearch: parseComparisonQuery,
  loaderDeps: ({ search }) => ({ left: search.left, right: search.right }),
  loader: ({ params, deps }) => loadComparison({ data: { videoId: params.videoId, ...deps } }),
  errorComponent: ComparisonUnavailable,
  component: ComparisonPage,
})

function ComparisonUnavailable() {
  return <main className="comparison-page">
    <a href="/videos">← Videos</a>
    <Alert><AlertTitle>Comparison unavailable</AlertTitle><AlertDescription>Choose two different drafts from the same video.</AlertDescription></Alert>
  </main>
}

function ComparisonPage() {
  const model = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const { videoId } = Route.useParams()
  const search = Route.useSearch()
  const pair = partitionComparison(model)
  const selection = model.selection

  useEffect(() => {
    if (selection && (!search.left || !search.right)) {
      void navigate({ search: selection, replace: true })
    }
  }, [navigate, search.left, search.right, selection])

  function select(current: Readonly<{ left: Draft; right: Draft }>, side: keyof ComparisonSelection, draftId: string) {
    void navigate({
      search: {
        left: side === 'left' ? draftId : current.left.id,
        right: side === 'right' ? draftId : current.right.id,
      },
    })
  }

  return <main className="comparison-page">
    <Link to="/videos/$videoId" params={{ videoId }}>← Single review</Link>
    <header><p className="eyebrow">Versioned review</p><h1>Compare drafts</h1><p>Review two immutable versions with independent playback and comments.</p></header>
    {!pair
      ? <Alert><AlertTitle>Comparison unavailable</AlertTitle><AlertDescription>Upload at least two drafts to compare versions.</AlertDescription></Alert>
      : <div className="comparison-grid">
        <section className="comparison-side" aria-labelledby="left-draft-heading">
          <header><div><p className="eyebrow">Left side</p><h2 id="left-draft-heading">Version {pair.left.version}</h2></div><Label>Left draft<Select value={pair.left.id} onValueChange={(value) => select(pair, 'left', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{model.drafts.map((draft) => <SelectItem key={draft.id} value={draft.id} disabled={draft.id === pair.right.id}>Version {draft.version} · {draft.file.displayName}</SelectItem>)}</SelectContent></Select></Label></header>
          <ReviewPane key={`left:${pair.left.id}`} draft={pair.left} />
        </section>
        <section className="comparison-side" aria-labelledby="right-draft-heading">
          <header><div><p className="eyebrow">Right side</p><h2 id="right-draft-heading">Version {pair.right.version}</h2></div><Label>Right draft<Select value={pair.right.id} onValueChange={(value) => select(pair, 'right', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{model.drafts.map((draft) => <SelectItem key={draft.id} value={draft.id} disabled={draft.id === pair.left.id}>Version {draft.version} · {draft.file.displayName}</SelectItem>)}</SelectContent></Select></Label></header>
          <ReviewPane key={`right:${pair.right.id}`} draft={pair.right} />
        </section>
      </div>}
  </main>
}
