import { Clapperboard, Files, LogOut } from 'lucide-react'
import { Button } from '@yatb/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@yatb/ui/sidebar'
import { ThemeControl } from './theme-control'

type AppSidebarProps = Readonly<{
  user: { name: string; email: string }
  onSignOut: () => void
  pathname?: string
}>

export function AppSidebar({ user, onSignOut, pathname = '/videos' }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()

  function closeMobileNavigation() {
    if (isMobile) setOpenMobile(false)
  }

  return <Sidebar collapsible="icon">
    <SidebarHeader className="studio-sidebar-header">
      <div className="studio-sidebar-brand-row">
        <a className="wordmark compact" href="/videos" onClick={closeMobileNavigation}><span>YATB</span><b>Studio</b></a>
        <SidebarTrigger className="studio-sidebar-collapse" />
      </div>
      <ThemeControl compact />
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <nav aria-label="Studio navigation">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/videos')} tooltip="Videos">
                  <a href="/videos" onClick={closeMobileNavigation}><Clapperboard /><span>Videos</span></a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/files'} tooltip="Files">
                  <a href="/files" onClick={closeMobileNavigation}><Files /><span>Files</span></a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <div className="studio-sidebar-account">
        <span>{user.name}</span>
        <small>{user.email}</small>
      </div>
      <Button className="studio-sidebar-signout" variant="ghost" type="button" aria-label="Sign out" onClick={onSignOut}>
        <LogOut /><span>Sign out</span>
      </Button>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
}
