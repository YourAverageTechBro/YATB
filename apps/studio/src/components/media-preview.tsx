import { File, FileAudio } from 'lucide-react'
import { mediaPreviewKind } from '#/domain/media'

type MediaPreviewProps = Readonly<{
  contentType: string
  name: string
  src: string
}>

export function MediaPreview({ contentType, name, src }: MediaPreviewProps) {
  const kind = mediaPreviewKind(contentType)

  if (kind === 'image') {
    return <a
      className="media-preview media-preview-image-link"
      href={src}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open image preview: ${name}`}
    >
      <img className="media-preview-image" src={src} alt={`Preview of ${name}`} loading="lazy" />
    </a>
  }

  if (kind === 'video') {
    return <video
      className="media-preview media-preview-video"
      controls
      playsInline
      preload="metadata"
      src={`${src}#t=0.001`}
      aria-label={`Video preview: ${name}`}
    />
  }

  if (kind === 'audio') {
    return <div className="media-preview media-preview-audio">
      <FileAudio aria-hidden="true" />
      <audio controls preload="metadata" src={src} aria-label={`Audio preview: ${name}`} />
    </div>
  }

  return <a className="media-preview media-preview-fallback" href={src} aria-label={`Preview unavailable: ${name}`}>
    <File aria-hidden="true" />
    <span>Preview unavailable</span>
  </a>
}
