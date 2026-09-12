import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Clapperboard, LogOut } from 'lucide-react'
import { ThemeControl } from '#/components/theme-control'
import { authClient } from '#/lib/auth-client'
import { loadSession } from '#/server/auth.functions'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const session = await loadSession()
    if (!session) throw redirect({ to: '/', search: { token: undefined } })
    return { session }
  },
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useRouteContext()
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    await navigate({ to: '/', search: { token: undefined } })
  }

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <a className="wordmark compact" href="/videos"><span>YATB</span> Studio</a>
        <ThemeControl compact />
        <nav aria-label="Studio navigation">
          <a className="nav-item active" href="/videos"><Clapperboard size={17} /> Videos</a>
        </nav>
        <div className="account">
          <span>{session.user.name}</span>
          <small>{session.user.email}</small>
          <button className="quiet-button" type="button" onClick={() => void signOut()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <Outlet />
    </div>
  )
}
