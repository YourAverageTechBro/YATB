import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@yatb/ui/select'
import { Copy, ExternalLink, File, FileAudio, FileImage, FileVideo, Link2Off } from 'lucide-react'
import { useState } from 'react'
import { filterLibraryFiles, formatUploadedTimestamp, groupLibraryFiles, type FileGrouping, type LibraryFile } from '#/domain/file-library'
import { mediaPreviewKind } from '#/domain/media'
import { createSharedFileLink, loadLibraryFiles, revokeSharedFileLink } from '#/server/file-library.functions'

export const Route = createFileRoute('/_app/files')({
  loader: () => loadLibraryFiles(),
  component: FilesPage,
})

function FileCard({ entry }: { entry: LibraryFile }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const kind = mediaPreviewKind(entry.file.contentType)
  const shareUrl = entry.shareToken ? `/shared-files/${entry.shareToken}` : null

  async function copyLink() {
    setBusy(true)
    setMessage('')
    try {
      const token = entry.shareToken ?? await createSharedFileLink({ data: entry.file.id })
      await navigator.clipboard.writeText(`${window.location.origin}/shared-files/${token}`)
      setMessage('Link copied')
      await router.invalidate()
    } catch {
      setMessage('Could not copy the link. Check browser clipboard access.')
      await router.invalidate()
    } finally { setBusy(false) }
  }

  async function revoke() {
    setBusy(true)
    setMessage('')
    try {
      await revokeSharedFileLink({ data: entry.file.id })
      setMessage('Link revoked')
      await router.invalidate()
    } catch { setMessage('Could not revoke the link.') }
    finally { setBusy(false) }
  }

  return <Card className="library-file">
    <span className="library-file-icon" aria-hidden="true">{kind === 'image' ? <FileImage /> : kind === 'video' ? <FileVideo /> : kind === 'audio' ? <FileAudio /> : <File />}</span>
    <div className="library-file-details">
      <strong title={entry.file.displayName}>{entry.file.displayName}</strong>
      <small><a href={`/videos/${entry.file.videoId}`}>{entry.videoTitle}</a> · {entry.file.purpose === 'draft' ? 'Draft' : 'Footage'} · {formatUploadedTimestamp(entry.file.createdAt)}</small>
      {message && <span className="library-file-message" role="status">{message}</span>}
    </div>
    <div className="library-file-actions">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void copyLink()}><Copy /> {shareUrl ? 'Copy link' : 'Create share link'}</Button>
      {shareUrl && <>
        <Button asChild variant="outline" size="sm"><a href={shareUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open</a></Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke()}><Link2Off /> Revoke</Button>
      </>}
    </div>
  </Card>
}

function FilesPage() {
  const files = Route.useLoaderData()
  const [search, setSearch] = useState('')
  const [grouping, setGrouping] = useState<FileGrouping>('date')
  const filtered = filterLibraryFiles(files, search)
  const groups = groupLibraryFiles(filtered, grouping)

  return <main className="workspace file-library">
    <header className="workspace-header"><div><p className="eyebrow">Media library</p><h1>Files</h1></div></header>
    <p className="library-intro">Find uploaded footage, drafts, and review attachments. Share a file with a link that you can revoke at any time.</p>
    <div className="library-controls">
      <Label>Search file name<Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" /></Label>
      <Label>Group by<Select value={grouping} onValueChange={(value) => setGrouping(value as FileGrouping)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="date">Date uploaded</SelectItem><SelectItem value="content">Piece of content</SelectItem></SelectContent></Select></Label>
    </div>
    {groups.length === 0
      ? <p className="library-empty">{files.length === 0 ? 'No files have been uploaded yet.' : 'No file names match your search.'}</p>
      : groups.map((group) => <section className="library-group" key={group.key}><h2>{group.label} <span>{group.files.length}</span></h2><div>{group.files.map((entry) => <FileCard key={entry.file.id} entry={entry} />)}</div></section>)}
  </main>
}
