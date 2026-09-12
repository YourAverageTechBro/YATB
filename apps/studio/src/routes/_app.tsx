import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { SidebarProvider, SidebarTrigger } from '@yatb/ui/sidebar'
import { AppSidebar } from '#/components/app-sidebar'
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
    <SidebarProvider defaultOpen>
      <AppSidebar user={session.user} onSignOut={() => void signOut()} />
      <div className="studio-content">
        <header className="studio-mobile-header"><SidebarTrigger aria-label="Open Studio navigation" /><a className="wordmark" href="/videos"><span>YATB</span> Studio</a></header>
        <Outlet />
      </div>
    </SidebarProvider>
  )
}
