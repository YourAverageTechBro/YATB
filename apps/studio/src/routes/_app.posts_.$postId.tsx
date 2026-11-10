import { createFileRoute, notFound } from '@tanstack/react-router'
import { PostsComposer } from '#/components/posts-composer'
import { loadPostDraft } from '#/server/posts.functions'

export const Route = createFileRoute('/_app/posts_/$postId')({
  loader: async ({ params }) => {
    const draft = await loadPostDraft({ data: params.postId })
    if (!draft) throw notFound()
    return { draft }
  },
  component: PostDetail,
})

function PostDetail() {
  const { draft } = Route.useLoaderData()
  return <PostsComposer key={draft.id} loaded={draft} />
}
