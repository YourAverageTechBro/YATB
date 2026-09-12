import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarProvider } from '@yatb/ui/sidebar'
import { AppSidebar } from '../src/components/app-sidebar'

describe('Studio sidebar', () => {
  it('keeps navigation, theme, identity, and sign out available through shared Sidebar', () => {
    const markup = renderToStaticMarkup(createElement(SidebarProvider, null,
      createElement(AppSidebar, { user: { name: 'Dohyun', email: 'dohyun@example.com' }, onSignOut: () => undefined }),
    ))
    expect(markup).toContain('data-slot="sidebar"')
    expect(markup).toContain('aria-label="Studio navigation"')
    expect(markup).toContain('>Videos</span>')
    expect(markup).toContain('aria-label="Color theme"')
    expect(markup).toContain('dohyun@example.com')
    expect(markup).toContain('>Sign out</span>')
  })
})
