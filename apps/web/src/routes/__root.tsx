import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Your Average Tech Bro | 1:1 App Building Consulting',
      },
      {
        name: 'description',
        content:
          'Work with me 1:1 to learn how to build + market your own app. Get personalized coaching to build and grow your SaaS application.',
      },
      {
        name: 'keywords',
        content: 'app development, SaaS consulting, tech coaching, app marketing',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased bg-background text-foreground min-h-screen">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
