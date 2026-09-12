# Password reset

A user requests a captured reset link, sets a new password, and loses old sessions.

## Sub-features

- `reset-request` gives the same generic result for known and unknown addresses.
- `reset-complete` accepts the new password and rejects the old password.
- `reset-revoke` invalidates existing sessions.

## How to get to it (user POV)

- Open `/`, choose `Forgot password?`, and submit an email.
- Open the captured reset link and submit a new password.

## Driving it with Codex computer control

Preconditions:

- A verified approved user exists.
- Preserve one signed-in browser session before reset.

- **Request.** Submit the approved email. The form shows the generic reset response.
- **Open link.** Read the latest local message from D1 and open its URL.
- **Change password.** Submit a new password. The form confirms the update.
- **Confirm.** The old password returns `401`, the new password returns `200`, and the preserved session cannot open `/videos`.
- **Proof.** Capture the browser states and HTTP status results without the token.

## Gotchas

- Never commit a reset token.
- Password submission requires the real Better Auth endpoint, not a direct D1 edit.
