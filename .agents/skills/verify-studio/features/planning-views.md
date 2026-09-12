# Planning views

List and board layouts retain filters, grouping, sorting, and private saved views.

## Sub-features

- `view-list` renders list grouping by none, status, or format.
- `view-board` renders the five status columns.
- `view-filter-sort` combines status and format filters with a fixed sort choice.
- `view-saved-owner` restores a view only for its owner.

## How to get to it (user POV)

- Open `Videos` and use `Video view controls`.
- Choose `Save view` and name the current configuration.

## Driving it with Codex computer control

Preconditions:

- Two verified approved users exist.
- The schedule contains both formats and multiple statuses.

- **Arrange a list.** Filter to long videos, group by format, and sort by publish date. Confirm excluded shorts are absent.
- **Arrange a board.** Choose `Board`, filter a status, and confirm cards appear in the matching column.
- **Save and restore.** Save the board configuration, change the controls, then select the name from `Saved views`.
- **Check ownership.** Sign in as the second user. The first user's saved view must not appear.
- **Proof.** Capture list, board, restored controls, and both users' saved-view menus. Query each saved view owner in D1.

## Gotchas

- Board layout always groups by status.
- Saved views retain layout, filters, grouping, and sort. They do not retain a page number.
