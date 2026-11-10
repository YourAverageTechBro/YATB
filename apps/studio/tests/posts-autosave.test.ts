import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPostsAutosave } from '../src/components/posts-autosave'
import type { PostDraft } from '../src/domain/posts'

const draft: PostDraft = {
  id: '1b0e913b-645c-4306-a71d-78115390b46d',
  target: 'both',
  xPremium: false,
  status: 'draft',
  revision: 1,
  items: [{ id: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27', order: 0, body: '', media: [] }],
  publications: [],
  updatedByUserId: '3879b960-ec74-4c13-b823-c6d32cb15b7d',
  createdAt: 1,
  updatedAt: 1,
}

describe('posts autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('persists over-limit text instead of blocking the save', async () => {
    const save = vi.fn(async (data: {
      items: ReadonlyArray<{ id: string; body: string }>
    }) => ({
      kind: 'saved' as const,
      draft: { ...draft, revision: 2, items: data.items.map((item, order) => ({
        id: item.id, order, body: item.body, media: [],
      })), updatedAt: 2 },
    }))
    const autosave = createPostsAutosave(draft, { save })
    autosave.replace({ ...draft, items: [{ ...draft.items[0]!, body: 'a'.repeat(281) }] })
    await vi.advanceTimersByTimeAsync(600)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0].items[0]?.body).toHaveLength(281)
  })
})
