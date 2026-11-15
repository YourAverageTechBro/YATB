import { useEffect, useState } from 'react'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import type { FileKind } from '#/domain/mcp-files'

export function FileTags({ kind, fileId, name }: { kind: FileKind; fileId: string; name: string }) {
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/files/${kind}/${fileId}/tags`, { credentials: 'same-origin' })
      .then(async (response) => {
        const body = await response.json() as { tags?: string[]; error?: string }
        if (cancelled) return
        if (!response.ok) {
          setMessage(body.error ?? 'Tags are unavailable.')
          return
        }
        setValue((body.tags ?? []).join(', '))
      })
      .catch(() => {
        if (!cancelled) setMessage('Tags are unavailable.')
      })
    return () => { cancelled = true }
  }, [kind, fileId])

  async function save() {
    setMessage('')
    const tags = value.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0)
    const response = await fetch(`/api/files/${kind}/${fileId}/tags`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    })
    const body = await response.json() as { tags?: string[]; error?: string }
    if (!response.ok) {
      setMessage(body.error ?? 'Tags could not be saved.')
      return
    }
    setValue((body.tags ?? []).join(', '))
  }

  return <div className="file-tags">
    <Label>Tags<Input
      aria-label={`Tags for ${name}`}
      value={value}
      placeholder="b-roll, product shot"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { void save() }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save() } }}
    /></Label>
    {message && <small role="status">{message}</small>}
  </div>
}
