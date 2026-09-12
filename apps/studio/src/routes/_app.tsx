import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
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
  return <Outlet />
}
