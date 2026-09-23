import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { parseLibraryFileId, parseShareToken } from '#/domain/file-library'

const NO_STORE = 'private, no-store, max-age=0'

export const loadLibraryFiles = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireStudioSession } = await import('./auth.server')
  await requireStudioSession()
  setResponseHeader('Cache-Control', NO_STORE)
  const { listLibraryFiles } = await import('./media.server')
  return listLibraryFiles()
})

export const createSharedFileLink = createServerFn({ method: 'POST' })
  .validator(parseLibraryFileId)
  .handler(async ({ data }) => {
    const { requireStudioMutationOrigin, requireStudioSession } = await import('./auth.server')
    const session = await requireStudioSession()
    requireStudioMutationOrigin()
    const { createFileShare } = await import('./media.server')
    return createFileShare(data, session.user.id)
  })

export const revokeSharedFileLink = createServerFn({ method: 'POST' })
  .validator(parseLibraryFileId)
  .handler(async ({ data }) => {
    const { requireStudioMutationOrigin, requireStudioSession } = await import('./auth.server')
    await requireStudioSession()
    requireStudioMutationOrigin()
    const { revokeFileShare } = await import('./media.server')
    return revokeFileShare(data)
  })

export const loadSharedFile = createServerFn({ method: 'GET' })
  .validator(parseShareToken)
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', NO_STORE)
    setResponseHeader('Referrer-Policy', 'no-referrer')
    const { getSharedFile, MediaError } = await import('./media.server')
    try {
      const { file, videoTitle } = await getSharedFile(data)
      return { file, videoTitle }
    } catch (error) {
      if (error instanceof MediaError && error.status === 404) return null
      throw error
    }
  })
