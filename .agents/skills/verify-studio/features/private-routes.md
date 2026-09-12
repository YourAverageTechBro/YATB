# Private routes

Studio denies unauthenticated, revoked, and cross-origin access at server boundaries.

## Sub-features

- `private-navigation` redirects `/videos` to `/` without a session.
- `unknown-navigation` returns a private-data-free not-found page.
- `private-media` returns `401` and private cache policy.
- `allowlist-revocation` denies an existing session after D1 disables its email.
- `origin-rejection` rejects Better Auth and application-owned writes from another origin.

## How to get to it (user POV)

- Open `/videos` without signing in.
- Use the app after an administrator revokes the account.

## Driving it with Codex computer control

Preconditions:

- Studio passes the doctor.
- Use a disposable local session for the revocation check.

- **Navigate.** Open `/videos` without cookies. The browser returns to `/`.
- **Open unknown page.** Open `/not-a-route`. The response is `404` and shows no workspace data.
- **Request media.** Request `/api/videos/1b0e913b-645c-4306-a71d-78115390b46d/media/28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27` without cookies. The response is `401` with private no-store caching.
- **Revoke.** Set the signed-in email's `allowed_email.enabled` value to `0`, then reload `/videos`. The browser returns to `/`.
- **Reject origin.** Submit an auth write and a footage mutation with `Origin: https://attacker.example`. Both return `403`; Better Auth identifies its rejection as `INVALID_ORIGIN`.
- **Proof.** Capture the redirects, raw responses, and read-only allowlist row.

## Gotchas

- Restore `allowed_email.enabled` to `1` after the drive.
- The route layout improves navigation, but the server session guard is the data boundary.
