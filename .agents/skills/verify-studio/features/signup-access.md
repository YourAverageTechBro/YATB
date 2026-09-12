# Signup access

Signup creates an unverified account only for an enabled allowlisted address.

## Sub-features

- `signup-denied` rejects any other address with a generic message.
- `signup-normalized` stores an approved address in lowercase with surrounding whitespace removed.

## How to get to it (user POV)

- Open `/` and choose `Need an account? Request access`.

## Driving it with Codex computer control

Preconditions:

- Studio passes the doctor.
- The selected approved address has no existing user row.

- **Deny.** Enter an unapproved address and submit `Create account`. The form shows a generic failure and D1 has no matching user.
- **Allow.** Enter an approved address with mixed case and surrounding spaces. The form asks the user to check email. D1 stores the normalized address with `emailVerified = 0`.
- **Proof.** Capture each form result and the corresponding read-only D1 query.

## Gotchas

- Remove an existing local user before replaying approved signup.
- A successful signup does not grant access before verification.
