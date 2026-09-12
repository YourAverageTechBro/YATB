# Draft comparison

An authenticated user reviews two distinct immutable drafts of one video side by side. Each side keeps its own player, speed, playhead, comments, and unfinished composer state.

## Sub-features

- `comparison-pair` resolves two distinct draft IDs only from the active task's draft catalog.
- `comparison-url` stores both selected IDs in the URL and restores the same pair after reload.
- `comparison-layout` uses equal-width desktop panes and stacks them at 1100 pixels and below.
- `comparison-playback` keeps each native player's playhead and playback rate independent.
- `comparison-comments` reads, creates, edits, and deletes rich point or range comments for the exact pane draft.
- `comparison-attachments` uploads comment attachments as footage under the same parent task.

## How to get to it (user POV)

- Sign in, open a video with at least two drafts, and choose `Compare versions` beside the draft selector.
- Use `Left draft` and `Right draft` to choose two different versions.

## Driving it with Codex computer control

- **Open.** Choose `Compare versions`. Confirm the URL gains distinct `left` and `right` IDs and a reload restores the same versions.
- **Layout.** At desktop width, measure the two `.comparison-side` boxes. Their widths match and neither overlaps. At 1100 pixels or narrower, confirm the panes stack and every control remains visible.
- **Playback.** Seek only the left player and change only the right `Playback speed`. Read both media elements' actual `currentTime` and `playbackRate` values.
- **Comments.** Add a rich point comment on the left and a rich range comment on the right. Confirm each appears only under its selected version. Edit and cancel deletion through the same controls as single review.
- **Identity.** Type unfinished comment text on the right, switch the left draft, and confirm the right text and player state remain. Switch back and confirm persisted comments remain on their original draft.
- **Boundaries.** Request an identical pair and a pair containing a draft from another task. Confirm both return the generic unavailable result without foreign metadata.

## Gotchas

- The URL is the pair source of truth. Do not add a second synchronized selection store.
- Changing one selector remounts only that side. Unsaved state on the changed side is intentionally discarded.
- Two panes reuse the single-review component. A comparison-only copy of player or comment behavior is drift.
