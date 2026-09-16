# Footage delivery

An authenticated user uploads original media to one video without exposing the private R2 bucket.

## Sub-features

- `footage-parallel` uploads several files with overlapping progress.
- `footage-retry` retries a failed part without creating another file.
- `footage-retry-exhausted` exposes Retry and Dismiss after automatic attempts are exhausted.
- `footage-cancel` aborts an unfinished multipart upload.
- `footage-rename` changes display metadata without changing stored bytes.
- `footage-download` streams the exact original through an authenticated route.
- `footage-preview` renders lazy image thumbnails, native video previews, and native audio controls through that authenticated route while active or unknown types stay download-only.
- `footage-range` serves a single byte range for browser seeking.
- `footage-cleanup` removes media after its video tombstone reaches scheduled cleanup.

## How to get to it (user POV)

- Sign in, open `Videos`, and choose a video.
- Find `Footage upload`, then choose `Add footage`.

## Driving it with Codex computer control

Preconditions:

- A verified approved user is signed in.
- Studio passes the doctor.
- Local D1 migrations and the local R2 binding are available.

- **Upload in parallel.** Choose three fixtures in one file picker action. Confirm at least two progress rows advance before either completes.
- **Retry and cancel.** Interrupt one part and let its automatic retry finish.
  Exhaust the retry limit on another file while a sibling is active, then choose
  its accessible `Retry` button. Confirm it reuses the same D1 upload identity
  and reaches ready. Confirm `Dismiss` removes a failed row. Start another upload
  and choose its accessible `Cancel <filename>` button.
- **Rename.** Choose `Rename`, enter a new display name in `New name for <filename>`, then choose `Save filename`. Refresh and confirm it persists. Submit an invalid name and confirm the inline error without losing the editor.
- **Download.** Choose `Download` within the target footage card and hash the resulting bytes outside the browser. Compare them with the source fixture.
- **Preview.** Upload a PNG or JPEG, MP4 or MOV, MP3, SVG, and HTML fixture. Confirm `Open image preview: <filename>` shows the image thumbnail, `Video preview: <filename>` exposes native controls and a first-frame hint, and `Audio preview: <filename>` exposes native controls. Confirm SVG and HTML use `Preview unavailable: <filename>`, return `Content-Disposition: attachment`, and remain downloadable. Confirm every response retains `X-Content-Type-Options: nosniff`.
- **Seek.** Play a compatible MP4 and seek beyond its buffered position. Confirm the media request returns `206` with a valid `Content-Range`.
- **Prove isolation.** Put one file ID under another video ID and confirm `404`.
- **Prove cleanup.** Delete the parent video, invoke `/cdn-cgi/local/scheduled`, and confirm both the D1 media row and R2 object are absent.

## Gotchas

- Browser responses must not contain an R2 key, multipart upload ID, or part ETag.
- Manual Retry reuses the original client request ID; it must not create a second upload or file.
- Every non-final part is exactly 32 MiB. Do not use a fixture that changes size while uploading.
- Native playback proves only browser-compatible codecs. It is not a transcoding guarantee.
- Native previews do not generate or persist derived thumbnails; codec support remains browser-dependent.
