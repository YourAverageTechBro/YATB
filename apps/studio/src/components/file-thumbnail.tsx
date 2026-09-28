import { File, FileAudio, Play } from 'lucide-react'
import type { Ref } from 'react'
import { mediaPreviewKind, type MediaFile } from '#/domain/media'

export function FileThumbnail({ file, onOpen, buttonRef }: { file: MediaFile; onOpen: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  const kind = mediaPreviewKind(file.contentType)
  const src = `/api/videos/${file.videoId}/media/${file.id}`

  return <button ref={buttonRef} type="button" className="library-file-preview" onClick={onOpen} aria-label={`View file: ${file.displayName}`}>
    {kind === 'image' ? <img src={src} alt="" loading="lazy" />
      : kind === 'video' ? <><video src={`${src}#t=0.001`} muted playsInline preload="metadata" aria-hidden="true" /><span className="library-file-play" aria-hidden="true"><Play /></span></>
      : <span className="library-file-placeholder" aria-hidden="true">{kind === 'audio' ? <FileAudio /> : <File />}<span>{kind === 'audio' ? 'Audio file' : 'Preview unavailable'}</span></span>}
  </button>
}
