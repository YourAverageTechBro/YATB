import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const css = readFileSync(resolve('../../packages/ui/src/styles.css'), 'utf8')

function tokenLightness(selector: string, token: string) {
  const selectorStart = css.indexOf(`${selector} {`)
  const blockStart = css.indexOf('{', selectorStart)
  const block = css.slice(blockStart + 1, css.indexOf('}', blockStart))
  const tokens = new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
  let value = tokens.get(token)
  while (value?.startsWith('var(--')) value = tokens.get(value.slice(6, -1))
  const lightness = value?.match(/^oklch\(([\d.]+)/)?.[1]
  if (!lightness) throw new Error(`Cannot resolve ${token} for ${selector}`)
  return Number(lightness)
}

it('changes the sidebar palette with the selected theme', () => {
  const lightBackground = tokenLightness("html[data-theme='light']", 'sidebar')
  const lightForeground = tokenLightness("html[data-theme='light']", 'sidebar-foreground')
  const darkBackground = tokenLightness("html[data-theme='dark']", 'sidebar')
  const darkForeground = tokenLightness("html[data-theme='dark']", 'sidebar-foreground')

  expect(lightBackground).toBeGreaterThan(0.5)
  expect(lightForeground).toBeLessThan(0.5)
  expect(darkBackground).toBeLessThan(0.5)
  expect(darkForeground).toBeGreaterThan(0.5)
})
