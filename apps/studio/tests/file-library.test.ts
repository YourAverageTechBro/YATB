import { describe, expect, it } from 'vitest'
import { filterLibraryFiles, formatUploadedDate, formatUploadedTimestamp, groupLibraryFiles, type LibraryFile } from '../src/domain/file-library'
import { isSharedFileUrl, sharedFileTextParts } from '../src/domain/shared-file-links'

const one: LibraryFile = { file: { id: 'one', videoId: 'a', purpose: 'footage', displayName: 'Hero frame.png', byteSize: 100, contentType: 'image/png', createdAt: new Date(2026, 8, 23, 12).valueOf(), updatedAt: 1 }, videoTitle: 'First video', shareToken: null }
const two: LibraryFile = { file: { id: 'two', videoId: 'a', purpose: 'draft', displayName: 'Final cut.mp4', byteSize: 200, contentType: 'video/mp4', createdAt: new Date(2026, 8, 22, 12).valueOf(), updatedAt: 1 }, videoTitle: 'First video', shareToken: null }
const three: LibraryFile = { file: { id: 'three', videoId: 'b', purpose: 'footage', displayName: 'Hero alternate.jpg', byteSize: 300, contentType: 'image/jpeg', createdAt: new Date(2026, 8, 22, 13).valueOf(), updatedAt: 1 }, videoTitle: 'Second video', shareToken: null }

describe('file library grouping and search', () => {
  it('searches file names without matching content titles', () => {
    expect(filterLibraryFiles([one, two, three], 'HERO').map((entry) => entry.file.id)).toEqual(['one', 'three'])
    expect(filterLibraryFiles([one, two, three], 'First video')).toEqual([])
  })

  it('groups by uploaded day or content while preserving newest-first order', () => {
    expect(groupLibraryFiles([one, two, three], 'date').map((group) => [group.key, group.files.map((entry) => entry.file.id)])).toEqual([
      ['2026-09-23', ['one']], ['2026-09-22', ['two', 'three']],
    ])
    expect(groupLibraryFiles([one, two, three], 'content').map((group) => [group.label, group.files.map((entry) => entry.file.id)])).toEqual([
      ['First video', ['one', 'two']], ['Second video', ['three']],
    ])
  })

  it('formats upload dates consistently across server and browser time zones', () => {
    const timestamp = Date.UTC(2026, 8, 23, 0, 30)
    expect(formatUploadedDate(timestamp)).toBe('September 23, 2026')
    expect(formatUploadedTimestamp(timestamp)).toContain('UTC')
  })
})

describe('review comment shared-file links', () => {
  const url = `https://studio.youraveragetechbro.com/shared-files/${'a'.repeat(64)}`
  it('finds a bare same-origin link and leaves punctuation as text', () => {
    expect(sharedFileTextParts(`See ${url}.`)).toEqual([
      { text: 'See ' }, { text: url, href: url }, { text: '.' },
    ])
  })

  it('rejects lookalike hosts, unrelated paths, and malformed tokens', () => {
    expect(isSharedFileUrl(`https://studio.youraveragetechbro.com.evil.test/shared-files/${'a'.repeat(64)}`)).toBe(false)
    expect(isSharedFileUrl('https://studio.youraveragetechbro.com/videos/123')).toBe(false)
    expect(isSharedFileUrl('javascript:alert(1)')).toBe(false)
  })
})
