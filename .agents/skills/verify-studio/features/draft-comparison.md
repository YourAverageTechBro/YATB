# Draft comparison

An authenticated user reviews two distinct immutable drafts of one video side by side. Each side keeps its own player, speed, playhead, comments, and unfinished composer state.

## Sub-features

- `comparison-pair` resolves two distinct draft IDs only from the active task's draft catalog.
- `comparison-url` stores both selected IDs in the URL and restores the same pair after reload.
- `comparison-layout` uses equal-width desktop panes and stacks them at 1100 pixels and below.
- `comparison-playback` keeps each custom player's native playhead, volume, mute, and playback rate independent.
- `comparison-markers` shows only the selected side's saved comment anchors on its timeline.
- `comparison-comments` reads, creates, edits, and deletes rich point or range comments for the exact pane draft.
- `comparison-download` exposes a download for the exact version selected on each side.
- `comparison-attachments` uploads comment attachments as footage under the same parent task.

## How to get to it (user POV)

- Sign in, open a video with at least two drafts, and choose `Compare versions` beside the draft selector.
- Use `Left draft` and `Right draft` to choose two different versions.

## Driving it with Codex computer control

- **Open.** Choose `Compare versions`. Confirm the URL gains distinct `left` and `right` IDs and a reload restores the same versions.
- **Layout.** At desktop width, measure the two `.comparison-side` boxes. Their widths match and neither overlaps. At 1100 pixels or narrower, confirm the panes stack and every control remains visible.
- **Playback.** Play and seek only the left player. Change only the right `Playback speed`, volume, and mute. Read both media elements' actual `paused`, `currentTime`, `playbackRate`, `volume`, and `muted` values. Fullscreen either player and exit with Escape without changing the other side.
- **Markers.** Add distinct point and range comments on each side. Confirm only that side's timeline gains the corresponding ticks and spans. Seek with each comment timestamp button and confirm only its own player moves. Switch one draft and confirm its markers change while the other side's playback stays intact.
- **Comments.** Add a rich point comment on the left and a rich range comment on the right. Confirm each appears only under its selected version. Edit and cancel deletion through the same controls as single review.
- **Scroll.** Overflow both comment lists at desktop width. Scroll each named
  comments region and confirm the other region and both composers stay still.
  At 390 pixels, confirm the panes stack and each bounded comments region still
  scrolls independently.
- **Download.** Download each side and confirm attachment disposition, exact filename, and bytes match that selected draft. Change one selector and confirm only that side's download target changes.
- **Identity.** Type unfinished comment text on the right, switch the left draft, and confirm the right text and player state remain. Switch back and confirm persisted comments remain on their original draft.
- **Boundaries.** Request an identical pair and a pair containing a draft from another task. Confirm both return the generic unavailable result without foreign metadata.

## Gotchas

- The URL is the pair source of truth. Do not add a second synchronized selection store.
- Changing one selector remounts only that side. Unsaved state on the changed side is intentionally discarded.
- Two panes reuse the single-review component. A comparison-only copy of player or comment behavior is drift.
