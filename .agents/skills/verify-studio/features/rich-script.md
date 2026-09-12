# Rich script

The task editor stores bounded structural rich text without accepting stored HTML.

## Sub-features

- `script-structure` persists headings, paragraphs, and lists.
- `script-marks` persists bold, italic, and HTTPS links.
- `script-safety` rejects unsafe links, excessive depth, node count, text, and serialized size.

## How to get to it (user POV)

- Open a video and use `Script` beneath the production fields.

## Driving it with Codex computer control

Preconditions:

- A video exists and its editor is open.

- **Format a script.** Enter a heading, list, bold text, and italic text. Select an exact word with the keyboard, keyboard-activate `Add link`, and submit an HTTPS URL. Continue typing after the dialog closes; the editor retains both the link and new text without resetting the caret.
- **Require a selection.** Open `Add link` without selected text. The dialog reports `Select text in the script first.` and does not close as though it succeeded.
- **Persist.** Choose `Save changes`, reload the direct video URL, and confirm every format and the linked selection remain.
- **Reject an unsafe link.** Select text and attempt a non-HTTPS link. The editor reports that links must use HTTPS and D1 remains unchanged.
- **Proof.** Capture the formatted editor after reload and the rejected link message. Confirm `script_json` contains structural JSON rather than HTML.

## Gotchas

- The editor accepts only its documented structural nodes and marks.
- Rejection at the browser does not replace the server parser proof.
