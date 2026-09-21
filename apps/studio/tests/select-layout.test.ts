import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const select = readFileSync(resolve('../../packages/ui/src/components/select.tsx'), 'utf8')

describe('shared select layout', () => {
  it('keeps an unbounded selected value inside its bounded trigger', () => {
    expect(select).toContain('flex w-fit min-w-0 max-w-full overflow-hidden')
    expect(select).toContain('*:data-[slot=select-value]:min-w-0')
    expect(select).toContain('*:data-[slot=select-value]:flex-1')
    expect(select).toContain('*:data-[slot=select-value]:truncate')
    expect(select).toContain('[&_svg]:shrink-0')
  })
})
