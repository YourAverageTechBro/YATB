# Video planning

An authenticated user creates and edits every legal video production type.

## Sub-features

- `planning-short-organic` stores an organic short.
- `planning-short-advertisement` stores a fully sponsored short.
- `planning-long-organic` stores a long video without an integration.
- `planning-long-integration` stores a long video with an ad integration.
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
- **Edit fields.** Change title, status, and publish date. Choose `Save changes`, reload, and confirm D1 matches the page.
- **Page the schedule.** With more than 20 matching videos, choose `Next` and `Previous`. Confirm the filter and sort controls remain unchanged.
- **Open from the card.** In list layout, choose blank space inside a video card
  and confirm the browser opens that video. Tab to the card, confirm a visible
  focus indicator, and press Enter. In board layout, confirm the title still
  opens the video and the status select still changes status without navigating.
- **Proof.** Capture each persisted production type and the paged schedule. Pair the screenshots with read-only D1 rows.

## Gotchas

- Production format and promotion form a closed union. Do not test impossible states by writing D1 directly.
- A syntactically shaped date still fails when it is not a real calendar day.
