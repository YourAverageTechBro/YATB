import { useEffect, useState } from 'react'
import { ProjectList } from './components/project-list.tsx'
import { ReviewPage } from './components/review-page.tsx'
import { parseHash } from './route.ts'

export function App() {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const changed = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return route ? <ReviewPage key={route.slug} slug={route.slug} version={route.version} /> : <ProjectList />
}
