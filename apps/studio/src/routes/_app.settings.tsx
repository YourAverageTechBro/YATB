import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Checkbox } from '@yatb/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@yatb/ui/dialog'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { MCP_SCOPES, type McpAccessToken, type McpScope } from '#/domain/mcp-tokens'
import { createMcpAccessToken, loadMcpTokens, revokeMcpAccessToken } from '#/server/mcp-tokens.functions'

export const Route = createFileRoute('/_app/settings')({
  loader: () => loadMcpTokens(),
  component: SettingsPage,
})

function formatTime(value: number | null): string {
  if (value === null) return 'Never'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC'
}

function SettingsPage() {
  const tokens = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<McpScope[]>(['posts:read', 'posts:mark_posted'])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [plaintext, setPlaintext] = useState<string | null>(null)

  function toggleScope(scope: McpScope, checked: boolean) {
    setScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope))
  }

  async function createToken() {
    setBusy(true)
    setMessage('')
    try {
      const created = await createMcpAccessToken({ data: { name, scopes } })
      setPlaintext(created.plaintext)
      setName('')
      await router.invalidate()
    } catch {
      setMessage('Could not create the token.')
    } finally { setBusy(false) }
  }

  async function revoke(token: McpAccessToken) {
    setBusy(true)
    setMessage('')
    try {
      await revokeMcpAccessToken({ data: token.id })
      setMessage(`Revoked ${token.name}`)
      await router.invalidate()
    } catch { setMessage('Could not revoke the token.') }
    finally { setBusy(false) }
  }

  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">Studio</p><h1>Settings</h1></div></header>
    <p className="library-intro">Create access tokens for the Posts MCP endpoint at /mcp. The plaintext token is shown once.</p>
    <form className="mcp-token-form" onSubmit={(event) => { event.preventDefault(); void createToken() }}>
      <Label>Token name<Input aria-label="Token name" name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></Label>
      <fieldset className="mcp-token-scopes">
        <legend>Scopes</legend>
        {MCP_SCOPES.map((scope) => (
          <Label key={scope} className="mcp-token-scope">
            <Checkbox
              checked={scopes.includes(scope)}
              onCheckedChange={(checked) => toggleScope(scope, checked === true)}
              aria-label={scope}
            />
            {scope}
          </Label>
        ))}
      </fieldset>
      <Button type="submit" disabled={busy || name.trim().length < 1 || scopes.length < 1}>Create token</Button>
    </form>
    {message && <p className="form-message" role="status">{message}</p>}
    <section className="mcp-token-list" aria-label="Access tokens">
      {tokens.length === 0
        ? <p className="library-empty">No access tokens yet.</p>
        : tokens.map((token) => (
          <Card key={token.id} className="mcp-token-card">
            <strong>{token.name}</strong>
            <small>Scopes: {token.scopes.join(', ')}</small>
            <small>Created: {formatTime(token.createdAt)}</small>
            <small>Last used: {formatTime(token.lastUsedAt)}</small>
            {token.revokedAt
              ? <small>Revoked: {formatTime(token.revokedAt)}</small>
              : <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(token)}>Revoke</Button>}
          </Card>
        ))}
    </section>
    <Dialog open={plaintext !== null} onOpenChange={(open) => { if (!open) setPlaintext(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy this token now</DialogTitle>
          <DialogDescription>It will not be shown again. Send it as Authorization: Bearer &lt;token&gt; to /mcp.</DialogDescription>
        </DialogHeader>
        {plaintext && <Input aria-label="New access token" readOnly value={plaintext} />}
        <Button type="button" onClick={() => { if (plaintext) void navigator.clipboard.writeText(plaintext) }}>Copy token</Button>
      </DialogContent>
    </Dialog>
  </main>
}
