import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '@yatb/ui/badge'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { createPostDraft, listPostDrafts } from '#/server/posts.functions'

export const Route = createFileRoute('/_app/posts')({
  loader: () => listPostDrafts(),
  component: PostsPage,
})

function PostsPage() {
  const drafts = Route.useLoaderData()
  const navigate = useNavigate()

  async function create() {
    const draft = await createPostDraft()
    await navigate({ to: '/posts/$postId', params: { postId: draft.id } })
  }

  return <main className="workspace posts-library">
    <header className="workspace-header">
      <div>
        <p className="eyebrow">Shared drafts</p>
        <h1>Posts</h1>
      </div>
      <Button type="button" onClick={() => void create()}>New draft</Button>
    </header>
    {drafts.length === 0
      ? <p className="library-empty">No posts yet</p>
      : <div className="video-list">{drafts.map((draft) => <a className="video-card-link" href={`/posts/${draft.id}`} key={draft.id}>
        <Card className="video-card">
          <strong>{draft.preview || 'Untitled draft'}</strong>
          <p>{draft.postCount === 1 ? 'Single post' : `${draft.postCount} posts`} · {draft.target === 'x' ? 'X' : draft.target === 'threads' ? 'Threads' : 'X and Threads'}</p>
          <Badge variant="secondary">{draft.status}</Badge>
        </Card>
      </a>)}</div>}
  </main>
}
