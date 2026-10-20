import { createFileRoute } from '@tanstack/react-router'

async function download({ params }: { params: { videoId: string; draftId: string } }) {
  return (await import('#/server/draft-ai.server')).handleTranscriptDownload(params.videoId, params.draftId)
}

export const Route = createFileRoute('/api/videos/$videoId/drafts/$draftId/transcript')({
  server: { handlers: { GET: download } },
})
