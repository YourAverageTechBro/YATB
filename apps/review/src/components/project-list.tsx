import { Badge } from '@yatb/ui/badge'
import { api } from '../api.ts'
import { usePolled } from '../use-polled.ts'

export function ProjectList() {
  const { data: projects, error } = usePolled(api.projects, 'projects')
  return <main className="review-home">
    <h1>Reviews</h1>
    {error && <p role="alert" className="review-error">{error}</p>}
    {projects?.length === 0 && <p className="review-muted">No drafts yet. Ask Claude to post one.</p>}
    <ul className="review-projects">
      {projects?.map((project) => <li key={project.slug}>
        <a className="review-project-card" href={`#/p/${project.slug}`}>
          <strong>{project.title}</strong>
          <span className="review-muted">{project.slug}</span>
          <span>{project.latestVersion === null ? 'No drafts' : `v${project.latestVersion}`}</span>
          <Badge variant={project.openCount > 0 ? 'default' : 'secondary'}>{project.openCount} open</Badge>
        </a>
      </li>)}
    </ul>
  </main>
}
