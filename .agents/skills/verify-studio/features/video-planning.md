# Video planning

An authenticated user creates and edits every legal video production type.

## Sub-features

- `planning-short-organic` stores an organic short.
- `planning-short-advertisement` stores a fully sponsored short.
- `planning-long-organic` stores a long video without an integration.
- `planning-long-integration` stores a long video with an ad integration.
- `planning-integration-organic-link` optionally connects a long-form integration
  to the active organic long-form video that will carry it.
- `planning-status-date` stores one of five statuses and an optional calendar date.
- `planning-pages` keeps large schedules reachable through bounded pages.

## How to get to it (user POV)

- Sign in, open `Videos`, and choose `New video`.
- In list layout, open a video by choosing its title or any blank space inside
  the card. In board layout, open the title so the status control remains
  independently interactive.

## Driving it with Codex computer control

Preconditions:

- A verified approved user is signed in.
- Studio passes the doctor.

- **Create each type.** Use `New video` four times for organic short, advertisement short, organic long, and integrated long. Refresh after each save.
- **Reject impossible choices.** Confirm short never offers integration and long never offers advertisement.
- **Link an integration.** Create an organic long-form video. Create a long-form
  integration, choose the organic video under `Organic video (optional)`, and
  confirm the detail page offers `Open linked video` after creation. Choose
  `Not linked`, wait for `Saved`, and confirm the link disappears.
- **Invalidate a target.** Link two integrations to the same organic video, then
  change the organic video to an ineligible production type. Reload both
  integrations and confirm each is unlinked without losing its other fields.
- **Edit fields.** Change title, status, publish date, and script. Pause typing,
  wait for `Saving…` to become `Saved`, then reload and confirm D1 matches the page.
  Type several title changes within 600 ms and confirm only the final title persists.
- **Navigate during the debounce.** Change the title and immediately follow the
  `Videos` link. Return to the video after one second and confirm the title saved.
- **Keep typing during a save.** Slow the network, edit the title, and wait for
  the save request to start. Continue typing and confirm the earlier response
  does not replace the newer text. Wait for `Saved` and reload.
- **Recover unsaved edits.** Clear the title and confirm validation appears
  without losing the script. Restore the title and wait for `Saved`. Disconnect
  the network, edit the title, and confirm the failure retains your edit.
  Reconnect, choose `Retry`, wait for `Saved`, and reload.
- **Handle conflicts.** Open a video in two sessions. Save a change in one, then
  edit the other. Confirm the conflict pauses autosave and retains the draft.
  Choose `Load latest version` and confirm the saved version appears.
- **Delete during a save.** Slow the network, edit a field, and delete the video
  while the request is pending. Confirm deletion waits for that save and returns
  to the schedule without a revision conflict.
- **Page the schedule.** With more than 20 matching videos, choose `Next` and `Previous`. Confirm the filter and sort controls remain unchanged.
- **Open from the card.** In list layout, choose blank space inside a video card
  and confirm the browser opens that video. Tab to the card, confirm a visible
  focus indicator, and press Enter. In board layout, confirm the title still
  opens the video and the status select still changes status without navigating.
- **Proof.** Capture each persisted production type and the paged schedule. Pair the screenshots with read-only D1 rows.

## Gotchas

- Production format and promotion form a closed union. Do not test impossible states by writing D1 directly.
- Only active long-form organic videos appear in `Organic video (optional)`.
  Candidate ordering is title-first and does not depend on the current planning page.
- A syntactically shaped date still fails when it is not a real calendar day.
