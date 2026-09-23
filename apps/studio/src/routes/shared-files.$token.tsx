import { createFileRoute, notFound } from '@tanstack/react-router'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Download } from 'lucide-react'
import { MediaPreview } from '#/components/media-preview'
import { ThemeControl } from '#/components/theme-control'
import { loadSharedFile } from '#/server/file-library.functions'
import { parseShareToken } from '#/domain/file-library'

export const Route = createFileRoute('/shared-files/$token')({
  loader: async ({ params }) => {
    try { parseShareToken(params.token) } catch { throw notFound() }
    const shared = await loadSharedFile({ data: params.token })
    if (!shared) throw notFound()
    return shared
  },
  component: SharedFilePage,
})

function SharedFilePage() {
  const { file, videoTitle } = Route.useLoaderData()
  const { token } = Route.useParams()
  const mediaUrl = `/api/shared-files/${token}`
  return <main className="shared-file-page">
    <header><a className="wordmark shared-file-brand" href="/"><span>YATB</span> Studio</a><ThemeControl /></header>
    <Card className="shared-file-card">
      <p className="eyebrow">Shared file</p>
      <h1>{file.displayName}</h1>
      <p className="shared-file-context">From {videoTitle} · Uploaded {new Date(file.createdAt).toLocaleDateString()}</p>
      <MediaPreview contentType={file.contentType} name={file.displayName} src={mediaUrl} />
      <Button asChild variant="outline"><a href={`${mediaUrl}?download=1`}><Download /> Download file</a></Button>
    </Card>
  </main>
}
