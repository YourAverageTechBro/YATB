import {
  HeadContent,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'

const themeScript = `try{const t=localStorage.getItem('yatb-studio-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'system'}catch{document.documentElement.dataset.theme='system'}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'YATB Studio' },
      {
        name: 'description',
        content: 'Private video production workspace for Your Average Tech Bro.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  notFoundComponent: () => <main className="not-found"><h1>Not found</h1><p>This Studio item is unavailable.</p></main>,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
