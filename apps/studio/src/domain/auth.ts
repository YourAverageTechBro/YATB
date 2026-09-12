export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function sessionEmailAuthorized(
  sessionEmail: string | undefined,
  enabled: boolean,
): boolean {
  return typeof sessionEmail === 'string' && enabled
}
