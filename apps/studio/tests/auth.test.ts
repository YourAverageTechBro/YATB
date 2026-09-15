import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  parseAuthSearch,
  sessionEmailAuthorized,
} from '../src/domain/auth'

describe('Studio authentication boundary', () => {
  it('normalizes an allowlisted email before matching', () => {
    expect(normalizeEmail('  Dohyun@YourAverageTechBro.com ')).toBe(
      'dohyun@youraveragetechbro.com',
    )
  })

  it('denies a missing session email', () => {
    expect(sessionEmailAuthorized(undefined, true)).toBe(false)
  })

  it('allows an enabled session email', () => {
    expect(sessionEmailAuthorized('dohyun@example.com', true)).toBe(true)
  })

  it('revokes a session as soon as D1 reports the address disabled', () => {
    expect(sessionEmailAuthorized('dohyun@example.com', false)).toBe(false)
  })

  it('shows the email verification confirmation only after a successful callback', () => {
    expect(parseAuthSearch({ verified: '1' })).toEqual({
      token: undefined,
      showEmailVerifiedConfirmation: true,
    })
    expect(parseAuthSearch({ verified: '1', error: 'TOKEN_EXPIRED' })).toEqual({
      token: undefined,
      showEmailVerifiedConfirmation: false,
    })
  })

  it('gives password reset state precedence over the verification confirmation', () => {
    expect(parseAuthSearch({ token: 'reset-token', verified: '1' })).toEqual({
      token: 'reset-token',
      showEmailVerifiedConfirmation: false,
    })
  })
})
