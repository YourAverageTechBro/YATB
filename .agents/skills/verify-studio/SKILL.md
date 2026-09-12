---
name: verify-studio
description: Drive the local YATB Studio web UI and authentication boundary. Use after changes to Studio routes, sessions, email callbacks, or Cloudflare bindings.
---

# Verify YATB Studio

## Launch

Use one local instance. The Vite Cloudflare runtime uses the app-local
`.wrangler` directory, so two verification runs must not share this checkout.

```sh
npx wrangler d1 migrations apply yatb-studio --local --cwd apps/studio
BETTER_AUTH_SECRET=verify-studio-secret-at-least-32-characters \
APP_ORIGIN=http://localhost:3001 EMAIL_MODE=capture \
EMAIL_FROM=studio@youraveragetechbro.com npm run dev:studio
```

Wait for `Local: http://localhost:3001/`. Keep the terminal session ID. Stop
that session with `Ctrl-C` after the last drive.

## Doctor

Run `.agents/skills/verify-studio/scripts/doctor.sh`. It passes only when the
login page returns `200`, the private route redirects to `/`, and the raw media
route returns `401` with `Cache-Control: private, no-store, max-age=0`.

## Drive

Use Codex computer control against `http://localhost:3001`. Read the current
accessibility tree before each action. Use these stable accessible names:

- `Email`, `Password`, and `Name` identify auth inputs.
- `Sign in`, `Create account`, `Send reset link`, and `Update password` submit forms.
- `Need an account? Request access` opens signup.
- `Forgot password?` opens reset request.
- `Sign out` ends a session.
- `Videos` and `No videos yet` identify the protected shell.
- `Color theme` selects `System`, `Light`, or `Dark` on public and private pages.

Use `npx wrangler d1 execute yatb-studio --local --cwd apps/studio --command
"<read-only SQL>"` to confirm D1 side effects. Read captured links from
`email_outbox`. Do not use production addresses or the Cloudflare email binding
during local verification.

## Evidence

Store screenshots and accessibility snapshots under
`artifacts/studio/<pr-id>/`. Store HTTP transcripts and timing output in the
same directory. Capture the submitted state and its result. Confirm signup,
verification, reset, and revocation with a second D1 or HTTP observation.

Mocks are allowed only at the email delivery boundary. `EMAIL_MODE=capture`
must still run the real Better Auth callback and store its link in D1.

## Cleanup

Stop only the terminal session started by this run. Remove test users, sessions,
verification rows, and captured emails with explicit D1 statements. Do not
delete the `.wrangler` directory or evidence files.

## Helpers

Run the executable doctor from the repository root:

```sh
.agents/skills/verify-studio/scripts/doctor.sh
```

Run the production-bundle secret check through the normal Studio build:

```sh
npm run build --workspace @yatb/studio
```

Measure the login and sign-in gates with a disposable verified local account:

```sh
STUDIO_TEST_EMAIL=<email> STUDIO_TEST_PASSWORD=<password> \
node .agents/skills/verify-studio/scripts/measure-auth.mjs
```
