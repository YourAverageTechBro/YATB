# Planning views

List and board layouts retain filters, grouping, sorting, and private saved views.

## Sub-features

- `view-list` renders list grouping by none, status, or format.
- `view-board` renders the five status columns.
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
- Saved views retain layout, filters, grouping, and sort. They do not retain a page number.
