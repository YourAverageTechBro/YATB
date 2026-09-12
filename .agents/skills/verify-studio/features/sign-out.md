# Sign out

Sign out invalidates the session and makes copied private URLs inaccessible.

## Sub-features

- `signout-session` removes the current session.
- `signout-private-route` redirects a later private request to `/`.

## How to get to it (user POV)

- In `/videos`, choose `Sign out`. At mobile width, first open `Open Studio
  navigation`.

## Driving it with Codex computer control

Preconditions:

- The browser has a valid session and shows `/videos`.

- **Sign out.** Choose `Sign out`. The browser returns to the login page.
- **Revisit.** Open `/videos` directly. The server redirects to `/`.
- **Proof.** Capture the sign-out action and the rejected revisit.

## Gotchas

- A client-side page change alone does not prove session invalidation.
- Revisit the private URL with the same browser profile.
