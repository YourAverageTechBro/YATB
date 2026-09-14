# Revision and deletion

Conditional writes preserve the latest edit and tombstones remove a task from every active read.

## Sub-features

- `revision-conflict` lets one edit from a shared revision win.
- `revision-latest` returns the current task after a stale edit.
- `delete-tombstone` records deletion without returning the task.
- `delete-direct` returns not found for a deleted direct URL.
- `delete-link-cleanup` clears outgoing and inbound organic-video links without
  leaving dangling references.

## How to get to it (user POV)

- Open the same video in two sessions for a conflict.
- Choose `Delete video` in the task editor for deletion.

## Driving it with Codex computer control

Preconditions:

- Two tabs hold the same video revision.

- **Create a conflict.** Save different titles from both tabs. One save succeeds and the stale tab offers `Load latest version`.
- **Load current state.** Choose `Load latest version` and confirm the winning title is not overwritten.
- **Delete.** Confirm `Delete video`. The list no longer includes the task.
- **Probe directly.** Reopen the copied video URL and confirm a 404 response.
- **Proof.** Capture the conflict, loaded latest state, post-delete list, and
  not-found page. Query revision and `deleted_at` in D1 before scheduled cleanup,
  then run cleanup and confirm the row is absent.

## Gotchas

- A stale delete is a conflict and must not tombstone the latest revision.
- Tombstoning an organic long-form target increments every linked integration's
  revision as it clears the relationship.
- The active-row predicate belongs in every list, detail, conditional update, and delete query.
