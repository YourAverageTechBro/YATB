# Email verification

An approved user follows the captured verification link before sign in works.

## Sub-features

- `verification-capture` stores the real Better Auth link in local D1.
- `verification-complete` marks the account verified through the auth endpoint.

## How to get to it (user POV)

- Submit approved signup, then open the link from the verification message.

## Driving it with Codex computer control

Preconditions:

- An approved unverified user exists.
- `email_outbox` has that user's verification message.

- **Open link.** Read the latest captured message with a read-only D1 query. Open its URL in the browser.
- **Confirm.** Query the user row. `emailVerified` equals `1`.
- **Proof.** Capture the callback result and the updated D1 row.

## Gotchas

- The captured URL contains a credential. Keep it out of committed evidence.
- Verification redirects to `/`; it does not sign the user in.
