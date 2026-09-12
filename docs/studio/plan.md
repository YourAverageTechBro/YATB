# YATB Studio program plan

This program adds a private video production workspace at
`studio.youraveragetechbro.com`. It uses TanStack Start, Better Auth,
Cloudflare Workers, D1, R2, and Email Service. Seven PRs land in order. Each PR
must preserve `apps/web`, enforce the private boundary, and carry direct live
evidence before merge.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A
nested box is a sub-step of the box above it. Check a box only when its evidence exists as a file, log line, screenshot, test run, or SHA. The body is a how-to.
The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-full.md` from the
installed plugin. PR owners stop at merge-ready. The operator delegated
automated evidence review and merge authority to the root. The root merges
after it posts a clean exact-head verdict.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State this protocol and plan to the operator, then stop. Start execution only on explicit go.
- [ ] On go, write this exact text into the standing orders and restate it in the task list. "Run `/Users/tkim/Developer/YATB/docs/studio/plan.md`. Land STUDIO-01 through STUDIO-07 in order. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The root reviews automated evidence and merges. Done means the production Studio origin passes every mapped feature with only Cloudflare runtime products."
- [ ] Read these files from the installed plugin at program start and again at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `.agents/skills/verify-studio/SKILL.md` after STUDIO-01 creates it
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/principle-prove-it-works/SKILL.md`
  - [ ] `skills/create-verification-skill/SKILL.md` for STUDIO-01
  - [ ] `skills/maintain-verification-skill/SKILL.md`
  - [ ] `.agents/skills/ponytail/SKILL.md`
- [ ] Arm the 30-minute audit tick with the available scheduler. Do not use a blocking sleep.
- [ ] Use this status message at every tick. "Audit the execution playbook and standing objective. Judge progress by commits, pushes, PR changes, checks, and evidence. Replace any stuck lane. Report each PR owner, state, head SHA, verdict, merge, evidence gate, and blocker."
- [ ] On operator hold, send every active owner an immediate zero-writes order.

### Spawn owners

- [ ] Assign one owner to the active PR. Use a fresh worktree and preserve one writer per branch.
- [ ] Follow the merge-then-branch dependency graph. STUDIO-01 starts from `main`. Each later PR starts only after its predecessor merges.
- [ ] Keep product edits inside the assigned app, `packages/ui` for shared primitives, root workspace files, Studio documentation, and `.agents/skills/verify-studio`.
- [ ] Hold all seven interaction review gates. The operator delegated each evidence review and merge to the root.

### PR mechanics for every PR

- [ ] Resolve the forge once. Use `gh` unless Origin is installed and resolves this repository. Record the choice in the decision trail.
- [ ] Open each PR ready with the predecessor merge on `main` as its base. Never open a draft.
- [ ] Run `npm run check` and `npm run build` before the PR-facing push. Push with hooks enabled.
- [ ] Run Poteto mode while building. Run direct Prove It Works before verification-skill work.
- [ ] Create `verify-studio` in STUDIO-01. Run Maintain Verification Skill after the direct proof in every PR.
- [ ] Run Ponytail over every edited product module before opening the PR. Record each kept or rejected simplification.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Write the title, body, and commit text with Technical Writing and Unslop.
- [ ] Triage every review and security comment with evidence.
- [ ] Record base SHA, head SHA, stable patch id, commands, screenshots, and live resource observations.

### Verdict and merge for every PR

- [ ] At merge-ready head, run the gate lane, all ten live lanes, the performance lane, and an independent diff and receipt audit.
- [ ] Mark clean only when every lane reports PASS. Return findings to the owner and repeat the complete verdict on a new head.
- [ ] Recheck CI, mergeability, and stable patch id immediately before the root merge. Reverify a changed patch.
- [ ] After merge, fetch `main`, confirm the merge commit, and only then branch the next PR.

### Boot recipe for every live lane

- [ ] Fetch the active branch and check out the exact head SHA in an isolated worktree.
- [ ] Install from the committed lockfile, create isolated Wrangler state, apply local D1 migrations, and start Studio on port 3001.
- [ ] Use `.agents/skills/verify-studio` for browser actions after STUDIO-01. Use read-only Wrangler queries for D1 and R2 evidence.
- [ ] Save screenshots under `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png`. Return the path and predicate result.
- [ ] Keep production email disabled in local lanes. Capture local email messages without sending to real users.

## Establish the private Studio boundary (STUDIO-01)

**Depends on.** None.

**Files.**

- [ ] Create `apps/studio/package.json`, runtime config, TanStack routes, auth modules, tests, and initial migrations.
- [ ] Edit root `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `.gitignore`, and `README.md`.
- [ ] Create `.agents/skills/verify-studio` after the direct auth proof.

**Build.**

- [ ] Add the isolated `@yatb/studio` Worker package with D1, R2, and restricted Email Service binding declarations.
- [ ] Add Better Auth email and password flows, normalized allowlist hooks, required email verification, password reset, and host-only cookies.
- [ ] Seed only the two supplied addresses and recheck their enabled state in every protected request.
- [ ] Make `/` the login surface and protect all product routes, server functions, and raw media routes.
- [ ] Generate the first verification map for signup, verification, sign in, sign out, reset, and direct access rejection.

**You see.**

- [ ] Opening `/` shows the login surface. Opening `/videos` without a session returns to `/`. A verified allowlisted user reaches an empty Studio shell.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `npm test --workspace @yatb/studio` for email normalization, allowlist denial, disabled access, origin validation, and session guards.
- [ ] Run `npm run check && npm run build` from the repository root.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [ ] Lane 1. Regression lane against trunk. Record that trunk has no Studio route, then gate the new login page and private redirect. Save `auth-regression.png`. Pass when head serves `/` and rejects `/videos` without a session.
- [ ] Lane 2. Submit a non-allowlisted address. Save `signup-denied.png`. Pass when the response is generic and no user row exists.
- [ ] Lane 3. Create the first allowlisted account and follow the captured verification link. Save `signup-verified.png`. Pass when the account becomes verified through the real auth endpoint.
- [ ] Lane 4. Sign in with the verified account. Save `signin.png`. Pass when `/videos` renders and a secure host-only session is present.
- [ ] Lane 5. Sign out and revisit a copied private URL. Save `signout.png`. Pass when the session is invalid and navigation returns to `/`.
- [ ] Lane 6. Request password reset and follow the captured token. Save `password-reset.png`. Pass when the new password works and the old one fails.
- [ ] Lane 7. Call a protected server function without cookies. Save `server-unauthorized.png`. Pass when it returns an authentication failure with no data.
- [ ] Lane 8. Call a raw media placeholder route without cookies. Save `media-unauthorized.png`. Pass when it returns `401` and private cache policy.
- [ ] Lane 9. Disable the signed-in email in D1 and reload. Save `allowlist-revoked.png`. Pass when access is revoked on the next protected request.
- [ ] Lane 10. Inspect emitted client assets. Save `secret-scan.png`. Pass when no Better Auth secret, D1 identifier, email token, or private binding value appears.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure local login-page response p95 and successful sign-in-to-shell elapsed time over 20 interleaved runs. Trunk lacks Studio, so measure only the new work and visible end state.
- [ ] Probe. Run the verification driver's auth timing scenario at trunk to record absence, then at head with isolated D1 state.
- [ ] Baseline. Record the trunk absence before head values.
- [ ] Rule. Fail when login response p95 exceeds 500 ms locally or verified sign-in-to-shell exceeds 1500 ms locally.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy login, denial, verification, and shell screenshots into `artifacts/studio/STUDIO-01-review-*.png`.
- [ ] Record a 30 to 60 second video of signup, verification, sign in, private redirect, and sign out at `artifacts/studio/STUDIO-01-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Create Verification Skill, Maintain Verification Skill, review triage, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-01 before STUDIO-02 branches.

## Build video planning and saved views (STUDIO-02)

**Depends on.** STUDIO-01.

**Files.**

- [ ] Create video and saved-view migrations, domain modules, routes, rich editor components, and focused tests under `apps/studio`.
- [ ] Edit the Studio verification map and only the root files needed for new test commands.

**Build.**

- [ ] Add video CRUD with closed short and long promotion unions, five statuses, publish date, bounded rich text, and optimistic revision checks.
- [ ] Add list and board layouts with status and format filters, grouping, sorting, and per-user saved views.
- [ ] Add immediate deletion tombstones and omit deleted tasks from every read.
- [ ] Maintain the verification skill after direct browser and D1 proof.

**You see.**

- [ ] A user creates a short or long video, edits its production fields and script, moves it between statuses, saves a view, refreshes, and sees the same state.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run focused tests for production unions, rich document parsing, query filters, saved views, revision conflicts, and deletion filtering.
- [ ] Run `npm run check && npm run build` from the repository root.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [ ] Lane 1. Regression lane against trunk. Run private sign in on trunk and head, then gate new task creation on head. Save `planning-regression.png`. Pass when auth is unchanged and the created task persists.
- [ ] Lane 2. Create an organic short. Save `short-organic.png`. Pass when the task shows short and organic after refresh.
- [ ] Lane 3. Create an advertisement short. Save `short-ad.png`. Pass when invalid integration controls are absent and advertisement persists.
- [ ] Lane 4. Create an organic long video. Save `long-organic.png`. Pass when the task shows long and no integration.
- [ ] Lane 5. Create a long video with ad integration. Save `long-integration.png`. Pass when the legal integration state persists and invalid full-ad state is rejected.
- [ ] Lane 6. Move tasks through all five statuses in board view. Save `status-board.png`. Pass when each card lands in the selected column and survives reload.
- [ ] Lane 7. Enter headings, lists, emphasis, and an HTTPS link in the script. Save `rich-script.png`. Pass when formatting persists and unsafe link schemes are rejected.
- [ ] Lane 8. Save a filtered grouped view. Save `saved-view.png`. Pass when the same user restores it and another user does not inherit it.
- [ ] Lane 9. Submit two edits from the same revision. Save `revision-conflict.png`. Pass when one succeeds and the stale edit receives the latest state without overwrite.
- [ ] Lane 10. Delete a task and probe its direct URL. Save `task-deleted.png`. Pass when lists omit it and the direct route returns not found.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure authenticated list render p95 for 200 seeded tasks at trunk and head, plus board filter response time.
- [ ] Probe. Interleave 20 list navigations on trunk and head against equivalent D1 data, then apply every status filter on head.
- [ ] Baseline. Record trunk authenticated shell response first.
- [ ] Rule. Fail when head list p95 exceeds trunk shell p95 by more than 25 ms, exceeds 750 ms locally, or any board filter response exceeds 300 ms. Use additive overhead because a multiplicative ratio is unstable against the near-zero empty trunk shell.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy list, board, task editor, saved view, and conflict screenshots into `artifacts/studio/STUDIO-02-review-*.png`.
- [ ] Record a 30 to 60 second video of create, edit, filter, status movement, saved view, and deletion at `artifacts/studio/STUDIO-02-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Maintain Verification Skill, review triage, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-02 before STUDIO-03 branches.

## Add parallel footage delivery (STUDIO-03)

**Depends on.** STUDIO-02.

**Files.**

- [ ] Create upload session and file migrations, authenticated media routes, upload client, footage UI, cleanup handler, and focused tests.
- [ ] Edit Studio Wrangler bindings, generated types, verification map, and operational documentation.

**Build.**

- [ ] Add server-issued immutable R2 keys and idempotent upload sessions.
- [ ] Add same-origin multipart part streaming with bounded part and file concurrency, progress, cancel, retry, and crash-safe completion.
- [ ] Add footage listing, metadata rename, authenticated download, byte range delivery, and task tombstone cleanup.
- [ ] Maintain the verification skill after direct browser, R2, and D1 proof.

**You see.**

- [ ] A user uploads several footage files in parallel, tracks each progress bar, renames them, downloads exact originals, and seeks a compatible video without exposing R2.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run focused tests for part validation, idempotent begin and complete, R2-complete D1-retry recovery, rename safety, range parsing, and cleanup retries.
- [ ] Run `npm run check && npm run build` from the repository root.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [ ] Lane 1. Regression lane against trunk. Run task create on trunk and head, then upload footage on head. Save `footage-regression.png`. Pass when planning stays intact and the new file becomes ready.
- [ ] Lane 2. Upload three files concurrently. Save `parallel-upload.png`. Pass when progress overlaps and all three ready rows match R2 objects.
- [ ] Lane 3. Retry begin with the same client id. Save `upload-idempotent.png`. Pass when one upload session and one object identity exist.
- [ ] Lane 4. Interrupt one part and retry it. Save `part-retry.png`. Pass when the completed object checksum matches the source.
- [ ] Lane 5. Simulate R2 completion followed by D1 failure, then retry complete. Save `completion-recovery.png`. Pass when one ready file exists with no duplicate object.
- [ ] Lane 6. Cancel an in-flight upload. Save `upload-cancel.png`. Pass when the UI stops, the multipart upload aborts, and no ready file is listed.
- [ ] Lane 7. Rename a file. Save `footage-rename.png`. Pass when the display name changes and the object key and checksum do not.
- [ ] Lane 8. Download an uploaded file. Save `footage-download.png`. Pass when downloaded bytes and checksum equal the source.
- [ ] Lane 9. Seek a compatible MP4 through the authenticated route. Save `range-seek.png`. Pass when the network shows `206` and the player reaches the selected time.
- [ ] Lane 10. Request another task's file and then delete its owner task. Save `media-isolation.png`. Pass when unauthorized access fails and cleanup removes hidden objects after the scheduled retry.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure effective upload throughput and Worker memory for one 256 MiB fixture plus three parallel 64 MiB fixtures. Measure first range byte latency.
- [ ] Probe. Record trunk feature absence, then run the same fixture set three times on head with interleaved single and parallel cases.
- [ ] Baseline. Record trunk absence and the head single-file throughput first.
- [ ] Rule. Fail when parallel aggregate throughput is below 80 percent of single-file throughput, upload-attributable Worker heap growth exceeds 64 MiB above the measured idle authenticated baseline, or local first range byte exceeds 750 ms. Record the absolute baseline and peak alongside the delta because the TanStack Worker framework baseline already exceeds 64 MiB before a media request.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy parallel progress, rename, download, retry, and playback screenshots into `artifacts/studio/STUDIO-03-review-*.png`.
- [ ] Record a 30 to 60 second video of parallel upload, rename, download, cancel, and seek at `artifacts/studio/STUDIO-03-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Maintain Verification Skill, review triage, byte receipts, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-03 before STUDIO-04 branches.

## Establish the shared shadcn system (STUDIO-04)

**Depends on.** STUDIO-03.

**Files.**

- [ ] Create `packages/ui` with source-owned shadcn primitives, semantic tokens, component configuration, explicit exports, and package checks.
- [ ] Edit both app manifests, styles, and component callers. Delete app-local primitive copies and stale dependencies.
- [ ] Edit the Studio architecture, program plan, monochrome checks, and verification map.

**Build.**

- [ ] Make `@yatb/ui` the sole owner of reusable primitives, Geist fonts, and black-and-white light and dark tokens.
- [ ] Migrate every current raw button, input, select, progress, card, alert, dialog, badge, accordion, separator, and sheet use when the shared primitive fits.
- [ ] Preserve product components, route ownership, Cloudflare boundaries, and Studio's pre-paint light, dark, and system preference.
- [ ] Add a deterministic ownership and emitted-palette guard so app-local primitive drift fails CI.

**You see.**

- [ ] Web and Studio retain their product identity while controls, focus states, dialogs, cards, and responsive overlays use one monochrome interaction language.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run the shared package typecheck, Studio's focused suite, the UI ownership guard, and `npm run check && npm run build` from the repository root.
- [ ] Confirm one compatible React graph, unified `radix-ui`, shared source compilation, no duplicate app-local UI directory, and no Vercel runtime or configuration.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive both local Cloudflare Workers.

- [ ] Lane 1. Regression lane against trunk. Drive Web desktop and Studio login at trunk and head. Save `ui-regression.png`. Pass when content, routes, and auth entry behavior remain unchanged while shared controls render at head.
- [ ] Lane 2. Drive Web at 390 px. Save `web-mobile-sheet.png`. Pass when Toggle menu exposes every navigation link, Escape closes the Sheet, and focus returns to the trigger.
- [ ] Lane 3. Drive the first Web FAQ item. Save `web-accordion.png`. Pass when it collapses and re-expands with keyboard and pointer input.
- [ ] Lane 4. Drive Web waitlist, billing, and protected success paths. Save `web-actions.png`. Pass when every destination and redirect matches trunk.
- [ ] Lane 5. Drive Studio's System, Light, and Dark selections through reload. Save `studio-themes.png`. Pass when persistence, focus, contrast, and grayscale appearance hold on public and private surfaces.
- [ ] Lane 6. Drive New Video and Save View dialogs. Save `studio-dialogs.png`. Pass when each validates, persists its intended result, closes, and restores focus.
- [ ] Lane 7. Select script text with the keyboard, reject HTTP, and apply HTTPS. Save `studio-rich-link.png`. Pass when selection survives portal focus, the anchor persists after Save and reload, and link submit alone does not trigger the outer video form.
- [ ] Lane 8. Drive the conflict Alert and delete AlertDialog. Save `studio-alerts.png`. Pass when stale state is visible, Load latest preserves the winner, and Cancel returns without deletion.
- [ ] Lane 9. Upload two files together, then rename and download one. Save `studio-footage.png`. Pass when independent Progress rows become cards and all media actions retain authenticated behavior.
- [ ] Lane 10. Inspect accessibility trees and emitted CSS. Save `shared-ui-accessibility.png`. Pass when labels, disabled states, destructive copy, portal contrast, package utilities, and an entirely grayscale palette are present.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Compare production client CSS gzip and route-chunk gzip totals with the STUDIO-03 head, plus local landing and authenticated shell response p95.
- [ ] Probe. Build an exact detached STUDIO-03 worktree and the PR head, then interleave 20 successful production-preview requests per app after five warmups while recording client gzip output from each build.
- [ ] Baseline. Record STUDIO-03 Web and Studio client asset totals and successful response p95 before measuring the head.
- [ ] Rule. Fail if either app adds more than 20 KiB gzip to its initial route assets or if local response p95 regresses by more than 25 ms. Record any lazy dialog chunks separately.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Save Web desktop and mobile plus Studio login, planning, dialog, upload, and theme screenshots under `artifacts/studio/STUDIO-04-*`.
- [ ] The operator delegated review to the root. Post the exact-head browser, screenshot, video, and build evidence for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Maintain Verification Skill, review triage, palette receipts, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-04 before STUDIO-05 branches.

## Add versioned draft review (STUDIO-05)

**Depends on.** STUDIO-04.

**Files.**

- [x] Create draft, review comment, and attachment migrations, review modules, player and editor components, routes, and focused tests.
- [x] Edit the upload purpose model, verification map, and playback fixture documentation.

**Build.**

- [x] Add immutable draft uploads with unique task-local version allocation and retry-safe finalization.
- [x] Add native player scrubbing, playback speed, and version selection over authenticated R2 ranges.
- [x] Add rich point and range comments, author attribution, timestamp seeking, edit and delete behavior, and attachments stored as parent footage.
- [x] Run the representative export fixture gate. Stop and request a Cloudflare Stream decision only if required exports fail native browser playback.
- [x] Maintain the verification skill after direct browser, R2, and D1 proof.

**You see.**

- [x] A user uploads successive drafts, selects a version, changes playback speed, pauses at a point or range, writes a formatted comment, clicks its timestamp, and returns to that exact place.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Run focused tests for draft version races, comment anchor validation, same-task attachment constraints, rich text safety, seek values, and comment mutations.
- [x] Run `npm run check && npm run build` from the repository root.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [x] Lane 1. Regression lane against trunk. Run footage upload on trunk and head, then create a draft on head. Save `draft-regression.png`. Pass when footage remains exact and draft version one plays.
- [x] Lane 2. Upload three drafts in order. Save `draft-versions.png`. Pass when immutable versions one through three list newest first.
- [x] Lane 3. Complete two draft uploads concurrently. Save `draft-race.png`. Pass when each receives a unique version and retries create no duplicates.
- [x] Lane 4. Scrub and change speed. Save `player-controls.png`. Pass when actual `currentTime` and `playbackRate` match the selected values.
- [x] Lane 5. Add a point comment at the paused playhead. Save `point-comment.png`. Pass when author, rich body, and integer timestamp persist after refresh.
- [x] Lane 6. Add a range comment. Save `range-comment.png`. Pass when start is before end and both values persist.
- [x] Lane 7. Click point and range timestamps. Save `comment-seek.png`. Pass when the actual player seeks to each start value.
- [x] Lane 8. Attach an image in the browser and an image plus video through the retained verifier. Save `comment-attachments.png`. Pass when the image renders and both files appear in task footage without duplicate bytes.
- [x] Lane 9. Reject a cross-task attachment and an anchor beyond known duration. Save `review-boundaries.png`. Pass when neither invalid relation enters D1.
- [x] Lane 10. Play the representative editor export fixture. Save `codec-fixtures.png`. Pass when the required fixture scrubs natively or the PR stops for an explicit Stream decision.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure player first frame, seek completion, and review workspace response p95 at trunk and head with the same compatible draft fixture.
- [x] Probe. Interleave 20 workspace loads and ten seeks on trunk footage playback and head draft playback, and isolate comment list query time.
- [x] Baseline. Record trunk authenticated range playback and workspace values first.
- [x] Rule. Fail when head first frame or seek is more than 1.25 times trunk or exceeds 1500 ms, or 500 comments load slower than 500 ms locally.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy version, player, point, range, seek, and attachment screenshots into `artifacts/studio/STUDIO-05-review-*.png`.
- [ ] Record a 30 to 60 second video of draft upload, speed change, point and range comments, timestamp seek, and attachment reuse at `artifacts/studio/STUDIO-05-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Maintain Verification Skill, codec fixture, review triage, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-05 before STUDIO-06 branches.

## Add two-version comparison (STUDIO-06)

**Depends on.** STUDIO-05.

**Files.**

- [x] Create the comparison route and composition components under `apps/studio`.
- [x] Edit review queries, responsive styles, focused tests, and the Studio verification map.

**Build.**

- [x] Render two instances of the same review pane in a desktop 50/50 grid.
- [x] Keep draft selection, player state, speed, comments, and composer independent on each side.
- [x] Reject identical or cross-task draft pairs and preserve comment identity when selections change.
- [x] Maintain the verification skill after direct browser and D1 proof.

**You see.**

- [x] A user chooses two versions of one task, watches them side by side, reads each version's comments, and adds a new point or range comment to either side.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Run focused tests for same-task comparison, pair rejection, read model partitioning, pane independence, and responsive layout contract.
- [x] Run `npm run check && npm run build` from the repository root.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [x] Lane 1. Regression lane against trunk. Run single-draft review on trunk and head, then open comparison on head. Save `compare-regression.png`. Pass when single review is unchanged and two panes render.
- [x] Lane 2. Select versions one and two. Save `compare-layout.png`. Pass when desktop panes occupy equal width without overlap.
- [x] Lane 3. Scrub the left player. Save `compare-left-player.png`. Pass when only left `currentTime` changes.
- [x] Lane 4. Change the right speed. Save `compare-right-speed.png`. Pass when only right `playbackRate` changes.
- [x] Lane 5. Add a point comment on the left. Save `compare-left-comment.png`. Pass when it appears only under the left draft.
- [x] Lane 6. Add a range comment on the right. Save `compare-right-comment.png`. Pass when it appears only under the right draft.
- [x] Lane 7. Click timestamps on each side. Save `compare-seek.png`. Pass when each timestamp controls only its own player.
- [x] Lane 8. Switch the left draft and switch back. Save `compare-comment-identity.png`. Pass when comments remain attached to their original version.
- [x] Lane 9. Request identical and cross-task pairs. Save `compare-invalid-pair.png`. Pass when both are rejected without leaking metadata.
- [x] Lane 10. Use the narrow responsive layout. Save `compare-responsive.png`. Pass when panes stack at the documented breakpoint and every control remains usable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure comparison interactive time and dual seek completion against the single-review trunk baseline.
- [x] Probe. Interleave ten single-review loads on trunk with ten two-pane loads on head using the same two files and comment counts.
- [x] Baseline. Record trunk single-review interactive time first.
- [x] Rule. Fail when head comparison interactive time exceeds twice trunk single-review time plus 500 ms or 2500 ms absolute, or either seek exceeds 1500 ms.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy layout, independent playback, comments, seek, and responsive screenshots into `artifacts/studio/STUDIO-06-review-*.png`.
- [ ] Record a 30 to 60 second video of draft selection, independent playback, comments on both sides, and timestamp seek at `artifacts/studio/STUDIO-06-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, Maintain Verification Skill, review triage, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-06 before STUDIO-07 branches.

## Launch Studio on Cloudflare (STUDIO-07)

**Depends on.** STUDIO-06.

**Files.**

- [x] Edit Studio Wrangler production identifiers, generated binding types, deployment commands, runbook, and verification map.
- [ ] Create only the migration or security corrections found by the production rehearsal. Do not add unrelated features.

**Build.**

- [x] Provision the production D1 database and private R2 bucket in the specified Cloudflare account.
- [x] Onboard `studio-mail.youraveragetechbro.com` to native Cloudflare Email Sending and restrict the Worker binding to the sender and both product recipients.
- [x] Install the Better Auth secret, apply migrations, deploy `yatb-studio`, and attach the exact custom domain.
- [ ] Run the complete verification skill against production and reconcile every feature map entry.
- [x] Confirm the operator delegated production deployment and cutover authority to the root before the first production deploy and domain attachment.

**You see.**

- [ ] `https://studio.youraveragetechbro.com` shows the login page, sends real verification and reset email through Cloudflare, and exposes no private page or media without a current allowlisted session.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run the full Studio unit suite, root check, root build, migration dry run, secret scan, and Wrangler configuration validation.
- [ ] Run the complete maintained verification skill locally before production approval.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head drive the running Worker.

- [ ] Lane 1. Regression lane against trunk. Run the complete local load-bearing task-to-review scenario on trunk and head. Save `launch-regression.png`. Pass when head preserves every trunk behavior and contains only intended deployment changes.
- [ ] Lane 2. Load the production origin signed out. Save `production-login.png`. Pass when only the login page and auth endpoints are public.
- [ ] Lane 3. Complete production verification email for one allowlisted account. Save `production-email.png`. Pass when Cloudflare logs accepted delivery and the token verifies once.
- [ ] Lane 4. Complete production sign in and sign out. Save `production-session.png`. Pass when cookies are secure and host-only and private access ends on sign out.
- [ ] Lane 5. Create, edit, filter, move, and delete a production test task. Save `production-planning.png`. Pass when each D1 state change matches the UI.
- [ ] Lane 6. Upload, rename, download, and seek production footage. Save `production-footage.png`. Pass when R2 bytes match and range delivery returns `206`.
- [ ] Lane 7. Upload two drafts and add point and range comments with attachments. Save `production-review.png`. Pass when versions, anchors, authors, and footage reuse persist.
- [ ] Lane 8. Compare the two production drafts. Save `production-compare.png`. Pass when equal panes and independent comments work.
- [ ] Lane 9. Probe protected routes, server calls, upload parts, and media ids without a session and with a revoked allowlist row. Save `production-security.png`. Pass when every attempt fails without data.
- [ ] Lane 10. Inspect Worker logs, D1 rows, R2 objects, email logs, and the custom-domain certificate. Save `production-resources.png`. Pass when every runtime dependency is Cloudflare and every resource belongs to account `32967fffa44c1d38bc86ab6e4e419edb`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure production login response, authenticated task list, first media byte, range seek, and comparison interactive p95 against the local head and pre-domain workers.dev deployment.
- [ ] Probe. Run 20 interleaved reads for each route on workers.dev and the custom domain from the same client region.
- [ ] Baseline. Record workers.dev and local head values before custom-domain values.
- [ ] Rule. Fail when the custom domain exceeds workers.dev by more than 25 percent, login or list p95 exceeds 1500 ms, first byte exceeds 1000 ms, or comparison interactive p95 exceeds 3000 ms.

**Review gate.** The operator delegated automated evidence review and merge authority to the root.

- [ ] Copy production login, email, planning, footage, review, comparison, and resource screenshots into `artifacts/studio/STUDIO-07-review-*.png`.
- [ ] Record a 45 to 90 second production video from signed-out login through comparison at `artifacts/studio/STUDIO-07-review.mp4`.
- [ ] The operator delegated review to the root. Post every screenshot and the video in chat for the root to check before merge.

**Merge.**

- [ ] Obtain the root clean verdict at the exact deployed head SHA.
- [ ] Confirm Ponytail, direct Prove It Works, final Maintain Verification Skill, production resource audit, review triage, and CI receipts.
- [ ] Confirm the root squash-merges STUDIO-07 and production still serves that merged patch.

## Close the program

- [ ] Confirm every PR is merged, every plan box has evidence, and `main` is clean and deployed.
- [ ] Confirm the final feature map covers auth, planning, footage, drafts, comments, attachments, comparison, and production resources.
- [ ] Report PR links, merge SHAs, deployed Worker version, D1 and R2 resource names, production URL, verification verdicts, and any deferred Stream decision.

## Appendix A. Prototype evidence

No code prototype was needed before the plan. Current documentation settles the
TanStack, D1, R2 multipart, Email Service, and custom-domain capabilities.

The Cloudflare dashboard inspection on 2026-09-12 proved that native Email
Sending is enabled for the isolated domain
`studio-mail.youraveragetechbro.com` in account
`32967fffa44c1d38bc86ab6e4e419edb`. Cloudflare created its DNS records and the
Worker binding accepts structured email messages without verified-recipient
onboarding. The binding still restricts sender and recipient addresses.

The playback question remains deliberately unproven. STUDIO-05 runs real editor
export fixtures. A failure stops execution for a Cloudflare Stream decision.

## Appendix B. Alternatives rejected

- Combine Studio with `apps/web`. It couples unrelated auth, data, and deploys.
- Add a shared package now. There is no second caller for Studio contracts.
- Use a generic ORM repository stack. Direct domain modules hide more policy
  with fewer interfaces.
- Put R2 credentials or keys in the browser. Same-origin multipart parts retain
  authorization and avoid CORS state.
- Make Stream the original store. Editors need downloadable original files and
  the specification names R2.
- Add Durable Objects, Queues, Turnstile, or live collaboration before a proved
  need. D1 constraints and retry state cover the current two-user workflow.
- Use an external SMTP or media service. Cloudflare covers the current scope.

## Appendix C. Risks

- STUDIO-01 may expose a Better Auth runtime mismatch. Pin the version, generate
  its D1 schema from that configuration, and prove hooks and cookies live.
- STUDIO-03 spans D1 and R2 without a shared transaction. The upload session,
  immutable key, unique constraints, and completion recovery are mandatory.
- STUDIO-05 may find browser-incompatible production codecs. Stop for a
  Cloudflare Stream decision rather than silently changing providers or formats.
- STUDIO-07 requires one real verification and password-reset email drive
  emails. This is the only known external coordination gate.
- Production media can be large. Every part must stay within current Worker and
  R2 limits, and tests must include cancellation and retry.

## Appendix D. Links and reading list

- Read `docs/studio/architecture.md` and append every material choice to
  `docs/studio/decisions.tsv`.
- Run `skills/how/SKILL.md` before changing unfamiliar Better Auth or Cloudflare
  interfaces. Run `skills/interrogate/SKILL.md` before review.
- Follow `skills/show-me-your-work/SKILL.md` for each uncommitted PR trail.
- Follow the official [TanStack Start Workers guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).
- Follow the official [R2 multipart guide](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/).
- Follow the official [Email Service binding guide](https://developers.cloudflare.com/email-service/configuration/send-bindings/).
- Follow the official [Better Auth TanStack guide](https://better-auth.com/docs/integrations/tanstack).
