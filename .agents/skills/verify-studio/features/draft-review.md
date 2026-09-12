# Draft review

An authenticated user uploads immutable edit versions, reviews them with the native player, and leaves rich notes at exact points or ranges.

## Sub-features

- `draft-version` assigns unique increasing task-local versions only after R2 and D1 publication complete.
- `draft-retry` returns the same draft identity and version after completion retries.
- `draft-failure` exposes a failed upload for retry or dismissal without publishing a draft.
- `draft-playback` supports authenticated range playback, native scrubbing, and actual playback-rate changes.
- `comment-point` stores a rich comment at one bounded integer millisecond timestamp with author identity.
- `comment-range` stores a rich comment whose start is before its end and whose end does not exceed the draft duration.
- `comment-seek` moves the active player to a clicked point or range start.
- `comment-mutation` updates with an optimistic revision and deletes through a confirmation dialog.
- `comment-attachment` stores image or video bytes once as parent footage and renders that same media in the comment.

## How to get to it (user POV)

- Sign in, open `Videos`, choose a video, and find `Video drafts` between the task editor and `Footage upload`.
- Choose `Upload draft`, then select the desired `Draft version`.

## Driving it with Codex computer control

Preconditions:

- A verified approved user is signed in.
- Studio passes the doctor and the local D1 and R2 bindings are available.
- The fixture is a representative editor export that the browser can load through native `<video>`.

- **Version.** Upload three drafts, including two completing concurrently. Confirm versions one through three appear newest first. Replay completion and confirm no fourth version appears.
- **Failure.** Force one draft upload through retry exhaustion, dismiss it, and confirm it never appears as an immutable version or ready media row.
- **Play.** Scrub the selected draft and choose a different `Playback speed`. Read the actual media element `currentTime` and `playbackRate`, not only the displayed controls.
- **Point.** Pause the player, choose point timing, format a rich `Review comment`, attach an image, and choose `Add comment`. Reload and confirm author, timestamp, rich body, and attachment persist.
- **Range.** Choose range timing, capture start and end with `Use playhead`, and save. Reject an end before start and a timestamp beyond known duration; confirm D1 contains neither invalid row.
- **Seek.** Click each comment timestamp. Confirm actual player time equals the point or range start.
- **Reuse.** Attach an image and video. Confirm both render in the comment and the same media IDs appear under `Footage upload` without duplicate R2 objects.
- **Mutate.** Edit a comment, reload, and confirm the new body. Exercise the delete dialog cancel path, then confirm deletion through the supported verification boundary. A stale edit must report a conflict instead of overwriting.
- **Isolate.** Request a draft under a different task ID and confirm `404`; try to link cross-task or draft-purpose media and confirm rejection.

## Gotchas

- `ready` means the R2 object, media row, draft row, and upload state committed; there is no visible pending-promotion state.
- Version order follows successful publication, not file selection order.
- Duration is captured from browser-native metadata before upload and stored as integer milliseconds.
- R2 does not transcode. A required production export that fails native playback stops the program for a Cloudflare Stream decision.
- Comment attachments are intentionally retained as task footage after the comment is deleted.
