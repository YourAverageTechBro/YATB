import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PostDraft } from '#/domain/posts'
import { savePostDraft } from '#/server/posts.functions'
import { createPostsAutosave } from './posts-autosave'

export function usePostsAutosave(loaded: PostDraft) {
  const [autosave] = useState(() => createPostsAutosave(loaded, {
    save: (data) => savePostDraft({ data }),
  }))
  const state = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot)
  useEffect(autosave.connect, [autosave])
  return {
    ...state,
    replace: autosave.replace,
    retry: autosave.retry,
    loadLatest: autosave.loadLatest,
    report: autosave.report(),
    canReady: autosave.canReady(),
  }
}
