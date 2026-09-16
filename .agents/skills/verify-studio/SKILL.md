---
name: verify-studio
description: Drive local and production YATB Studio authentication, planning, private footage, versioned draft review, comparison, and shared UI. Use after changes to routes, sessions, email callbacks, planning data, rich scripts, saved views, multipart uploads, media delivery, review comments, shared primitives, responsive navigation, themes, Cloudflare bindings, or production resources.
---

# Verify YATB Studio

## Launch

Use one local instance. The Vite Cloudflare runtime uses the app-local
`.wrangler` directory, so two verification runs must not share this checkout.

```sh
npx wrangler d1 migrations apply yatb-studio --local --cwd apps/studio
CLOUDFLARE_INCLUDE_PROCESS_ENV=true \
BETTER_AUTH_SECRET=verify-studio-secret-at-least-32-characters \
APP_ORIGIN=http://localhost:3001 EMAIL_MODE=capture \
EMAIL_FROM=studio@studio-mail.youraveragetechbro.com npm run dev:studio
```

Wait for `Local: http://localhost:3001/`. Keep the terminal session ID. Stop
that session with `Ctrl-C` after the last drive.

For shared UI changes, also launch Web with `npm run dev:web` and wait for
`Local: http://localhost:3000/`. Keep and stop that separate terminal session.

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
- `New video`, `Title`, `Format`, `Promotion`, `Organic video (optional)`, and
  `Create` identify video creation. The optional select uses `Not linked` for
  an empty relationship.
- `Video view controls`, `Saved views`, and `Save view` identify planning controls.
- `Script` and `Delete video` identify the task editor. Changes save after
  600 ms without another edit. Wait for the live `Saved` status before reloading to confirm
  persistence. A queued valid edit continues saving after in-app navigation.
  `Retry` appears when a background save fails.
- `Open linked video` opens the persisted organic long-form target.
- `Video pages`, `Previous`, and `Next` identify bounded planning pages.
- `Footage upload`, `Add footage`, `Uploads`, `Rename`, `File name`, `Save filename`, `Cancel rename`, `Cancel <filename>`, and `Download` identify private media delivery.
- `Video drafts`, `Upload draft`, `Draft version`, `Playback speed`, `Current playback time`, `Comment timing`, `Review comment`, and `Add comment` identify versioned review.
- `Play video`, `Pause video`, `Replay video`, `Seek video`, `Mute video`, `Unmute video`, and `Volume` identify custom player controls. `Enter full screen` and `Exit full screen` toggle fullscreen when supported.
- `Download version <number>: <filename>` identifies the selected draft download. `Comments for version <number>` identifies its focusable comments viewport.
- `Compare versions`, `Compare drafts`, `Left draft`, and `Right draft` identify the two-version comparison.
- `Start seconds`, `End seconds`, and `Use playhead` create timestamp ranges; comment timestamp buttons seek the active player.
- `Edit comment`, `Save comment`, and `Delete comment` identify review mutations.
- `Color theme` selects `System`, `Light`, or `Dark` on public and private pages.
- `Toggle menu` opens Web's mobile navigation; `Frequently Asked Questions`
  contains the Web accordion.
- `Video script` and `Review comment` identify toolbar-free rich text surfaces. Native Cmd/Ctrl+B and Cmd/Ctrl+I apply bold and italic formatting.

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

Drive the planning server functions through two real local sessions:

```sh
STUDIO_TEST_EMAIL=<primary-email> STUDIO_TEST_PASSWORD=<primary-password> \
STUDIO_SECOND_TEST_EMAIL=<secondary-email> STUDIO_SECOND_TEST_PASSWORD=<secondary-password> \
node .agents/skills/verify-studio/scripts/verify-planning.mjs
```

Exercise multipart R2 upload, retry recovery, rename, exact download, range,
isolation, cancellation, and scheduled cleanup:

```sh
STUDIO_TEST_EMAIL=<email> STUDIO_TEST_PASSWORD=<password> \
node .agents/skills/verify-studio/scripts/verify-footage.mjs
```

Exercise immutable draft versions, exact authenticated version downloads, two-version selection, pair rejection,
completion replay, review anchors, rich comments, attachment reuse, task
isolation, optimistic edits, ranges, and the 500-comment performance bound with
a browser-compatible editor export:

```sh
STUDIO_TEST_EMAIL=<email> STUDIO_TEST_PASSWORD=<password> \
STUDIO_REVIEW_FIXTURE=<absolute-mp4-path> STUDIO_REVIEW_PERF=1 \
node .agents/skills/verify-studio/scripts/verify-review.mjs
```

Set `STUDIO_KEEP_FIXTURES=1` only when the browser pass needs the generated
drafts and comments. The script prints the fixture video IDs. Delete both
videos through the application boundary and run the local scheduled handler
before ending verification.

The review script checks media delivery and stored review data. Drive the
custom player in the browser to verify actual playback, sound, fullscreen,
timeline markers, and independent comparison controls. Follow
[`features/draft-review.md`](features/draft-review.md) and
[`features/draft-comparison.md`](features/draft-comparison.md).

Seed 200 tasks through the application boundary and measure list and board responses:

```sh
STUDIO_TEST_EMAIL=<email> STUDIO_TEST_PASSWORD=<password> \
node .agents/skills/verify-studio/scripts/measure-planning.mjs
```

Set `STUDIO_TRUNK_P95_MS` to the interleaved production-preview trunk shell p95
to enforce the additive 25 ms overhead limit.

After explicit deployment approval and production deployment, audit the
Cloudflare resources and signed-out boundary without changing either:

```sh
apps/studio/scripts/audit-production.sh
```

Continue with [`features/production-launch.md`](features/production-launch.md).
The audit is only the first production gate. It does not prove email delivery
or authenticated product behavior.
