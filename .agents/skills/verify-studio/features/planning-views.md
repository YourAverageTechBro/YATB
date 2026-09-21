# Planning views

List, board, and calendar layouts retain filters and private saved views. The
calendar intentionally fixes grouping to none and sorting to publish date.

## Sub-features

- `view-list` renders list grouping by none, status, or format.
- `view-board` renders the five status columns.
- `view-calendar` renders every scheduled video in a complete month without pagination.
- `view-calendar-mobile` renders the same month as a chronological agenda.
- `view-filter-sort` combines status and format filters with a fixed sort choice.
- `view-saved-owner` restores a view only for its owner.
- `view-saved-delete` removes a saved configuration only for its owner.
- `view-board-move` advances a card through the five statuses with optimistic conflict handling.

## How to get to it (user POV)

- Open `Videos` and use `Video view controls`.
- Choose `Save view` and name the current configuration.

## Driving it with Codex computer control

Preconditions:

- Two verified approved users exist.
- The schedule contains both formats and multiple statuses.

- **Arrange a list.** Group a mixed schedule by status and sort by publish date. Confirm each format and multiple status groups remain visible.
- **Check status colors.** Confirm all five status chips use distinct colors with readable text in the Light, Dark, and System themes. Switch the operating system appearance while System is selected and confirm the palette follows it.
- **Arrange a board.** Choose `Board`, filter a status, and confirm cards appear in the matching column. Move one card to another status and confirm only its persisted status changes; a stale concurrent move must show an alert instead of overwriting.
- **Arrange a calendar.** Choose `Calendar` and confirm group and sort controls
  disappear while status and format filters remain. Navigate across a year
  boundary with `Previous month` and `Next month`, then use `Today`. Confirm
  more than 20 scheduled videos in one month are all present.
- **Inspect calendar cards.** Confirm each card shows only title, format,
  promotion, and status inside its publish-date cell. It must contain no image,
  video, poster, media request, or nested control. Activate the card and confirm
  its exact destination is `/videos/<id>`.
- **Check mobile.** At a narrow viewport, confirm the seven-column grid becomes
  a chronological agenda with a visible date for each group and long titles
  truncate without horizontal overflow.
- **Check the empty month.** Open a month without publish dates and confirm the
  calendar-specific `No scheduled videos` message appears.
- **Save and restore.** Save the board configuration, change the controls, then select the name from `Saved views`.
- **Use the saved-view menu.** Open `Saved views` with the keyboard, move through
  its items with Arrow keys, close it with Escape and confirm focus returns to
  the trigger, then reopen it and apply one view. With no saved views, confirm
  the empty item is disabled.
- **Delete.** Delete the saved view and confirm its name disappears after reload without changing the active URL controls.
- **Check ownership.** Sign in as the second user. The first user's saved view must not appear.
- **Proof.** Capture list, board, restored controls, and both users' saved-view menus. Query each saved view owner in D1.

## Gotchas

- Board layout always groups by status.
- Calendar layout always groups by none, sorts by publish date, excludes videos
  without a publish date, and never paginates the selected month.
- Saved views retain layout, filters, grouping, and sort. They do not retain a page number.
