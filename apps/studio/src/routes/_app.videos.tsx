import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Clapperboard, LogOut, Plus, Search } from 'lucide-react'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/_app/videos')({ component: Videos })

function Videos() {
  const { session } = Route.useRouteContext()
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    await router.navigate({ to: '/', search: { token: undefined } })
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <a className="wordmark compact" href="/videos">
          <span>YATB</span> Studio
        </a>
        <nav aria-label="Studio navigation">
          <a className="nav-item active" href="/videos">
            <Clapperboard size={17} /> Videos
          </a>
        </nav>
        <div className="account">
          <span>{session.user.name}</span>
          <small>{session.user.email}</small>
          <button className="quiet-button" type="button" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Production</p>
            <h1>Videos</h1>
          </div>
          <button className="primary-button" type="button" disabled>
            <Plus size={17} /> New video
          </button>
        </header>
        <div className="toolbar">
          <span><Search size={16} /> Search videos</span>
          <span>All statuses</span>
          <span>All formats</span>
        </div>
        <section className="empty-state">
          <div className="empty-icon"><Clapperboard size={25} /></div>
          <h2>No videos yet</h2>
          <p>Your production schedule will live here.</p>
        </section>
      </main>
    </div>
  )
}
