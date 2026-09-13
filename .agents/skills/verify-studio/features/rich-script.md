# Rich script

The task editor stores bounded structural rich text without accepting stored HTML.

## Sub-features

- `script-structure` persists headings, paragraphs, and lists.
- `script-marks` persists bold, italic, and previously stored HTTPS links.
- `script-safety` rejects unsafe links, excessive depth, node count, text, and serialized size.

## How to get to it (user POV)

- Open a video and use `Script` beneath the production fields.

## Driving it with Codex computer control

Preconditions:

- A video exists and its editor is open.

- **Use the toolbar-free editor.** Confirm `Video script` exposes one editable surface without a formatting toolbar. Enter text, select an exact word, and use Cmd+B or Ctrl+B and Cmd+I or Ctrl+I. Confirm the native browser formatting is visible and typing continues without resetting the caret.
- **Persist.** Choose `Save changes`, reload the direct video URL, and confirm the text, bold mark, and italic mark remain. If the fixture already contains headings, lists, or HTTPS links, confirm those render without being discarded.
- **Proof.** Capture the toolbar-free editor after reload. Confirm `script_json` contains structural JSON rather than HTML.

## Gotchas

- The editor accepts only its documented structural nodes and marks.
- The editor intentionally exposes native keyboard editing without formatting controls. It renders supported structured content already stored in a document.
- Rejection at the browser does not replace the server parser proof.
