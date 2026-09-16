import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Video } from '#/domain/videos'
import { removeVideo, saveVideo } from '#/server/videos.functions'
import { createVideoAutosave } from './video-autosave'

export function useVideoAutosave(loaded: Video) {
  const [autosave] = useState(() => createVideoAutosave(loaded, {
    save: (data) => saveVideo({ data }),
    remove: (data) => removeVideo({ data }),
  }))
  const state = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot)
  useEffect(autosave.connect, [autosave])
  return { ...state, edit: autosave.edit, retry: autosave.retry, loadLatest: autosave.loadLatest, flush: autosave.flush, erase: autosave.erase }
}
