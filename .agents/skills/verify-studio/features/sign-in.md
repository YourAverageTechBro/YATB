# Sign in

A verified approved user signs in and reaches the empty video workspace.

## Sub-features

- `signin-verified` creates a session for a verified approved user.
- `signin-unverified` rejects a user before email verification.

## How to get to it (user POV)

- Open `/`, enter email and password, then choose `Sign in`.

## Driving it with Codex computer control

Preconditions:

- A verified approved user exists.
- An unverified approved user exists for the rejection check.
- Studio passes the doctor.

- **Reject unverified.** Submit the unverified user's credentials. The browser stays on `/`, shows the auth error, and D1 has no session for that user.
- **Sign in.** Submit the verified credentials. The browser navigates to `/videos` and shows `No videos yet`.
- **Inspect cookie.** Confirm the session cookie has `HttpOnly`, `SameSite=Lax`, no `Domain`, and `Secure` when the app origin uses HTTPS.
- **Proof.** Capture the login action, the private shell, and response headers.

## Gotchas

- Local HTTP sessions omit `Secure`; the production configuration enables it.
- A shell screenshot without a fresh sign-in does not prove authentication.
- A disabled account can pass credential validation, but the `/videos` guard still denies it.
