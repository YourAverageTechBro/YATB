export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type AuthSearch = {
  token?: string
  showEmailVerifiedConfirmation: boolean
}

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  const token = typeof search.token === 'string' ? search.token : undefined

  return {
    token,
    showEmailVerifiedConfirmation:
      token === undefined &&
      typeof search.error !== 'string' &&
      search.verified === '1',
  }
}

export function sessionEmailAuthorized(
  sessionEmail: string | undefined,
  enabled: boolean,
): boolean {
  return typeof sessionEmail === 'string' && enabled
}
