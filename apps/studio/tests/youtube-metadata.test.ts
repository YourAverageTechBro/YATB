import { describe, expect, it } from 'vitest'
import { chapterBoundMs } from '../src/domain/draft-ai'
import {
  DESCRIPTION_FOOTER,
  chapterProblemMessage,
  chapterTextProblems,
  chaptersFromProposals,
  checkChapters,
  composeDescription,
  formatChapters,
  parseChapterText,
  parseChapterTimestamp,
  type ChapterProposal,
} from '../src/domain/youtube-metadata'

const proposals = (...pairs: Array<[string, string]>): ChapterProposal[] =>
  pairs.map(([start, title]) => ({ start, title }))

describe('chapter generation', () => {
  it('snaps later starts onto speech, floors to whole seconds, and pins the first at 0:00', () => {
    const result = chaptersFromProposals(
      proposals(['0:07', 'Intro'], ['1:58', 'Setup'], ['4:10', 'Demo']),
      [0, 4_200, 119_400, 250_100, 301_000],
      320_000,
    )
    expect(result).toEqual({
      ok: true,
      value: [
        { startMs: 0, title: 'Intro' },
        { startMs: 119_000, title: 'Setup' },
        { startMs: 250_000, title: 'Demo' },
      ],
    })
  })

  it('keeps the last chapter ten seconds clear of the lesser of duration and transcript end', () => {
    const segments = [0, 60_000, 120_000, 240_000, 301_000]
    const asked = proposals(['0:00', 'Intro'], ['1:00', 'Middle'], ['5:01', 'Outro'])
    const lastStart = (boundMs: number) => {
      const result = chaptersFromProposals(asked, segments, boundMs)
      if (!result.ok) throw new Error(JSON.stringify(result.problems))
      return result.value.at(-1)?.startMs
    }
    expect(lastStart(chapterBoundMs(320_000, null))).toBe(301_000)
    expect(chapterBoundMs(320_000, 305_000)).toBe(305_000)
    expect(chapterBoundMs(300_000, 305_000)).toBe(300_000)
    expect(lastStart(chapterBoundMs(320_000, 305_000))).toBe(240_000)
  })

  it('breaks a distance tie toward the earlier segment', () => {
    const result = chaptersFromProposals(
      proposals(['0:00', 'A'], ['1:50', 'B'], ['4:00', 'C']),
      [0, 100_000, 120_000, 240_000],
      300_000,
    )
    expect(result.ok && result.value.map((chapter) => chapter.startMs)).toEqual([0, 100_000, 240_000])
  })

  it('reports a start the model wrote in an unreadable form', () => {
    const result = chaptersFromProposals(proposals(['0:00', 'A'], ['soon', 'B'], ['4:00', 'C']), [0, 240_000], 300_000)
    expect(result).toEqual({ ok: false, problems: [{ kind: 'unreadable-start', index: 1, text: 'soon' }] })
  })

  it('rejects two proposals that snap onto the same segment', () => {
    const result = chaptersFromProposals(
      proposals(['0:00', 'A'], ['2:00', 'B'], ['2:05', 'C']),
      [0, 121_000, 290_000],
      300_000,
    )
    expect(result).toEqual({ ok: false, problems: [{ kind: 'duplicate-start', index: 2, startMs: 121_000 }] })
  })

  it('flattens titles onto one line and strips angle brackets', () => {
    const result = chaptersFromProposals(
      proposals(['0:00', '  Intro <b>\n  part'], ['1:00', 'B'], ['2:00', 'C']),
      [0, 60_000, 120_000],
      300_000,
    )
    expect(result.ok && result.value[0]?.title).toBe('Intro b part')
  })
})

describe('chapter rules', () => {
  const chapters = (...starts: number[]) => starts.map((startMs, index) => ({ startMs, title: `Part ${index + 1}` }))

  it('needs three chapters starting at 0:00', () => {
    expect(checkChapters(chapters(5_000, 60_000), 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'too-few', count: 2 }, { kind: 'first-not-zero', startMs: 5_000 }],
    })
  })

  it('needs each chapter to run ten seconds, including the last against the bound', () => {
    expect(checkChapters(chapters(0, 9_000, 60_000), 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'too-short', index: 0, lengthMs: 9_000 }],
    })
    expect(checkChapters(chapters(0, 60_000, 295_000), 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'too-short', index: 2, lengthMs: 5_000 }],
    })
    expect(checkChapters(chapters(0, 60_000, 290_000), 300_000).ok).toBe(true)
  })

  it('flags order, duplicates, a start past the end, and titles', () => {
    expect(checkChapters(chapters(0, 120_000, 60_000), 300_000).ok).toBe(false)
    expect(checkChapters(chapters(0, 60_000, 60_000, 120_000), 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'duplicate-start', index: 2, startMs: 60_000 }],
    })
    expect(checkChapters(chapters(0, 60_000, 300_000), 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'past-end', index: 2, startMs: 300_000, boundMs: 300_000 }],
    })
    expect(checkChapters([
      { startMs: 0, title: ' ' },
      { startMs: 60_000, title: 'x'.repeat(101) },
      { startMs: 120_000, title: 'Fine' },
    ], 300_000)).toEqual({
      ok: false,
      problems: [{ kind: 'blank-title', index: 0 }, { kind: 'title-too-long', index: 1 }],
    })
  })
})

describe('hand-edited chapter text', () => {
  it('round-trips generated chapters', () => {
    const generated = chaptersFromProposals(
      proposals(['0:00', 'Intro'], ['1:58', 'Setup'], ['4:10', 'Demo']),
      [0, 119_400, 250_100],
      320_000,
    )
    if (!generated.ok) throw new Error('expected valid chapters')
    const text = formatChapters(generated.value)
    expect(text).toBe('0:00 Intro\n1:59 Setup\n4:10 Demo')
    expect(parseChapterText(text)).toEqual({ ok: true, value: generated.value })
    expect(chapterTextProblems(text, 320_000)).toEqual([])
  })

  it('reports rule problems without needing the transcript', () => {
    expect(chapterTextProblems('', 300_000)).toEqual([])
    expect(chapterTextProblems('0:00 Intro\n1:00 Middle\n5:10 End', 305_000)).toEqual([
      { kind: 'past-end', index: 2, startMs: 310_000, boundMs: 305_000 },
    ])
    expect(chapterTextProblems('0:00 Intro\nlater Middle\n2:00 End', 305_000)).toEqual([
      { kind: 'unreadable-start', index: 1, text: 'later Middle' },
    ])
    expect(chapterProblemMessage({ kind: 'past-end', index: 2, startMs: 310_000, boundMs: 305_000 }))
      .toMatch(/5:10.*5:05/)
  })

  it('reads m:ss and h:mm:ss and refuses out-of-range parts', () => {
    expect(parseChapterTimestamp('0:00')).toBe(0)
    expect(parseChapterTimestamp('12:34')).toBe(754_000)
    expect(parseChapterTimestamp('1:02:03')).toBe(3_723_000)
    expect(parseChapterTimestamp('1:60')).toBeNull()
    expect(parseChapterTimestamp('1:60:00')).toBeNull()
    expect(parseChapterTimestamp('90')).toBeNull()
  })
})

describe('description', () => {
  it('joins the hook and summary and appends the footer', () => {
    expect(composeDescription('A hook.\n\n  A summary.  ')).toEqual({
      ok: true,
      value: `A hook.\n\nA summary.\n\n${DESCRIPTION_FOOTER}`,
    })
  })

  it('needs a summary paragraph after the hook', () => {
    expect(composeDescription('Only a hook.')).toEqual({ ok: false, problems: [{ kind: 'missing-summary' }] })
  })

  it('rejects hashtags but not a # inside a word', () => {
    expect(composeDescription('Learn C# today.\n\nSummary.').ok).toBe(true)
    expect(composeDescription('Hook #tech.\n\n#ai summary.')).toEqual({
      ok: false,
      problems: [{ kind: 'hashtag', tag: '#tech' }, { kind: 'hashtag', tag: '#ai' }],
    })
  })

  it('strips angle brackets and caps the length with the footer included', () => {
    expect(composeDescription('Use <video> tags.\n\nSummary.')).toEqual({
      ok: true,
      value: `Use video tags.\n\nSummary.\n\n${DESCRIPTION_FOOTER}`,
    })
    const result = composeDescription(`${'a'.repeat(4_990)}\n\nb`)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems[0]?.kind).toBe('too-long')
  })
})
