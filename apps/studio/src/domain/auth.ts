export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type AuthSearch = {
  token?: string
  verified?: 1
  error?: string
}

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    token: typeof search.token === 'string' ? search.token : undefined,
    verified: search.verified === '1' || search.verified === 1 ? 1 : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }
}

export function shouldShowEmailVerifiedConfirmation(
  search: AuthSearch,
): boolean {
  return (
    search.token === undefined &&
    search.error === undefined &&
    search.verified === 1
  )
}

export function sessionEmailAuthorized(
  sessionEmail: string | undefined,
  enabled: boolean,
): boolean {
  return typeof sessionEmail === 'string' && enabled
}
