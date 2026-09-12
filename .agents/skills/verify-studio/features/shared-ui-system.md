# Shared UI system

Web and Studio consume the same monochrome shadcn primitives without sharing
route behavior or application state.

## Sub-features

- `shared-controls` keeps buttons, fields, selects, cards, alerts, and progress
  controls consistent across both applications.
- `shared-overlays` provides keyboard-safe dialogs, alert dialogs, the
  responsive Web navigation sheet, and Studio's responsive sidebar.
- `shared-review-controls` provides the review ScrollArea and media Sliders
  while Studio retains playback and comment state.
- `shared-tokens` provides the zero-chroma light and dark palette while Studio
  retains its light, dark, and system preference.
- `shared-editor-link` preserves an editor selection while the HTTPS link
  dialog owns focus.

## How to get to it (user POV)

- Open Web at `http://localhost:3000/` and Studio at
  `http://localhost:3001/`.
- On Web, narrow the viewport to 390 pixels and use `Toggle menu`.
- In Studio, sign in, create or open a video, and use the controls on the list
  and detail pages.

## Driving it with Codex computer control

Preconditions:

- Studio passes the doctor and both local applications are running.
- A verified Studio user and one disposable video exist.
- Small text and MP4 fixtures are available for the footage chooser.

- **Drive Web on mobile.** At 390 pixels, open `Toggle menu`, verify every
  navigation link is reachable, press Escape, and confirm focus returns to the
  trigger. Collapse and re-expand the first FAQ item.
- **Drive Studio themes.** Select System, Light, and Dark on the login page.
  Reload an explicit choice and confirm it persists. Tab to a field and confirm
  the focus ring is visible.
- **Drive Studio navigation.** At 390 pixels, open `Open Studio navigation`,
  verify Videos, Theme, the signed-in account, and Sign out are reachable,
  press Escape, and confirm focus returns to the trigger. At desktop width,
  collapse and expand the sidebar and confirm the Videos tooltip remains named.
  Repeat both transitions with Ctrl+B or Cmd+B and confirm the reopen trigger
  and Videos link remain accessible.
- **Drive Studio fields.** Use the list filters, sort, grouping, card status,
  create form, detail form, draft picker, comparison pickers, comment timing,
  theme, and playback speed. Confirm each selected value and dependent reset.
  Reapply the same saved view after changing a filter.
- **Drive overlays.** Sign in. Open and cancel `New video`, save a named view,
  and open and cancel `Delete video`. Confirm the delete dialog names the task
  and returns focus without deleting it.
- **Drive the editor link.** Select exact script text with the keyboard, open
  `Link` from the keyboard, and submit a non-HTTPS URL through the `Add link` dialog. Confirm the dialog
  remains open with an error. Submit an HTTPS URL, save, reload, and confirm the
  selected text is still an anchor. Opening the dialog without a selection must
  report `Select text in the script first.` rather than succeeding.
- **Drive footage.** Upload the text and MP4 fixtures together, confirm separate
  progress rows complete and are replaced by their footage cards, rename the
  text file inline, and trigger its download.
- **Proof.** Capture accessibility snapshots for each open overlay, mobile
  sheet, and mobile sidebar. Capture Web mobile, Studio light and dark, the
  persisted link, review controls, and the footage result. Run the root check
  and both production Worker builds.

## Gotchas

- Radix portals move focus outside the editor. The editor must cache a
  non-collapsed selection while it still owns the selection and verify the same
  range before inserting an anchor.
- The theme control is intentionally hidden until hydration; the head script,
  not a first-frame control assertion, prevents a palette flash.
- Native file inputs remain visually hidden behind shared buttons, so use the
  actual file chooser rather than assigning a path to the button.
- Browser evidence proves interaction. The ownership and emitted-color scripts
  separately prove that both applications consume shared source and remain
  grayscale.
