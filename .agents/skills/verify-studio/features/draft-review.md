# Draft review

An authenticated user uploads immutable edit versions, reviews them with custom controls over the native video element, and leaves rich notes at exact points or ranges.

## Sub-features

- `draft-version` assigns unique increasing task-local versions only after R2 and D1 publication complete.
- `draft-retry` returns the same draft identity and version after completion retries.
- `draft-failure` retries transient failures automatically, then exposes an exhausted upload for dismissal without publishing a draft.
- `draft-playback` supports authenticated media delivery, play and pause, timeline scrubbing, elapsed time, volume, mute, playback speed, and fullscreen.
- `comment-markers` paints yellow point ticks and range spans on the saved draft timeline. Coincident points share one thicker tick.
- `draft-download` downloads the selected version through the authenticated media route with its exact filename and bytes.
- `review-layout` places the player beside a fixed composer and independently
  scrollable comments on desktop. Mobile stacks the same bounded comment region.
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
- **Play.** Choose `Play video`, pause, then click the video to resume. Read the media element's actual `paused` value after each action. Scrub `Seek video`, use Home and End, and choose another `Playback speed`. Confirm actual `currentTime`, `playbackRate`, elapsed time, and the composer timestamp agree. At the end, confirm `Replay video` restarts playback.
- **Sound.** Change `Volume`, mute, and unmute. Read actual `volume` and `muted`. Set volume to zero, then choose `Unmute video` and confirm it restores the last nonzero volume. Raising the slider must also clear mute.
- **Fullscreen.** Enter full screen and confirm the custom controls remain visible. Exit with Escape and confirm the button returns to `Enter full screen`. Browsers without the API show a disabled `Fullscreen unavailable` control.
- **Playback failure.** Use an unsupported local video fixture and confirm a playback alert with disabled media controls. If a play or fullscreen request is rejected, confirm a status message appears and the control state still matches the browser.
- **Shortcuts.** Focus the player itself. Space or K toggles playback, Left and Right seek five seconds, M toggles mute, and F toggles fullscreen. Modified keys and typing in the composer must not trigger player shortcuts. Focused sliders and buttons keep their native keyboard behavior.
- **Markers.** Save duplicate point comments at one timestamp and two overlapping ranges. Confirm one thicker tick and both spans appear at percentages of the persisted draft duration. Confirm markers refresh after add and delete without resetting playback. The legend explains tick and bar shapes. Markers add no tab stops, and comment timestamp buttons remain the precise seek path.
- **Download.** Select each version and activate its `Download version <number>: <filename>` link. Confirm HTTP `200`, `Content-Disposition: attachment`, the exact filename, and bytes identical to that version's upload. Request the same URL without a session and confirm `401`.
- **Desktop rail.** At desktop width, confirm the player is left of the composer and comments. Add enough comments to overflow `Comments for version <number>`. Scroll that region and confirm the player and composer positions stay fixed. Focus the region with Tab and scroll it with the keyboard.
- **Containment.** Use range timing, paste a long unbroken URL into the editor, and select 12 attachments with long names. Confirm the editor and attachment list stay bounded, every form control remains reachable, and no horizontal page overflow appears. Exercise edit and delete controls on a long comment.
- **Mobile flow.** At 390 and 320 pixels wide, confirm player controls wrap
  without horizontal overflow or covering the timeline. Confirm the player,
  composer, and comments stack in that order and the bounded comments region
  scrolls independently.
- **Point.** Pause the player, choose point timing, and confirm `Review comment` has no formatting toolbar. Enter a rich comment using native Cmd/Ctrl+B and Cmd/Ctrl+I, attach an image, and choose `Add comment`. Reload and confirm author, timestamp, rich body, and attachment persist.
- **Range.** Choose range timing, capture start and end with `Use playhead`, and save. Reject an end before start and a timestamp beyond known duration; confirm D1 contains neither invalid row.
- **Seek.** Click each comment timestamp. Confirm actual player time equals the point or range start.
- **Reuse.** Attach an image and video. Confirm both render in the comment and the same media IDs appear under `Footage upload` without duplicate R2 objects.
- **Mutate.** Edit a comment, reload, and confirm the new body. Exercise the delete dialog cancel path, then confirm deletion through the supported verification boundary. A stale edit must report a conflict instead of overwriting.
- **Isolate.** Request a draft under a different task ID and confirm `404`; try to link cross-task or draft-purpose media and confirm rejection.

## Gotchas

- `ready` means the R2 object, media row, draft row, and upload state committed; there is no visible pending-promotion state.
- Version order follows successful publication, not file selection order.
- Duration is captured from browser-native metadata before upload and stored as integer milliseconds.
- Marker positions use that persisted duration. A browser metadata event must not move saved markers.
- `--review-comment-marker: #facc15` is the only permitted chromatic declaration in Studio CSS. Both color audits still reject other chromatic literals.
- R2 does not transcode. A required production export that fails native playback stops the program for a Cloudflare Stream decision.
- Comment attachments are intentionally retained as task footage after the comment is deleted.
