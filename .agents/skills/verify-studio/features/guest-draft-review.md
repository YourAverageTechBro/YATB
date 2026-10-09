# Guest draft review

A signed-in Studio user creates a revokeable link for one immutable draft version. Guests open that public page without a Studio account, identify themselves with an email, watch that version, and leave timestamped text comments and replies.

## Sub-features

- `draft-share-pin` stores one 64-hex token per draft version. A later upload does not change an existing link.
- `guest-identity` requires a format-valid email and an optional name before commenting, then remembers them on the device.
- `guest-visibility` shows unresolved Studio and guest comments on that version only. Resolved threads are hidden from guests.
- `guest-limits` allow text comments and replies. No drawings or attachments. `Download original` is available without an email and serves the pinned draft original through `?download=1`. Compressed MP4 stays off this route.
- `guest-in-studio` shows guest comments in the version thread with a Guest badge and email.

## How to get to it (user POV)

- Sign in, open a video, choose a draft version, and use `Create guest review link`.
- Open `/shared-reviews/<token>` signed out.

## Driving it

- Create a v1 link, upload v2, and confirm the link still names version 1.
- In a logged-out browser, confirm `Download original` is present before entering an email. Click it and confirm the pinned draft original downloads. Then enter an email, comment, reply, reload, and confirm the identity is remembered.
- In Studio, reply to and resolve the guest thread. Confirm the guest page hides it.
- Revoke the link. Confirm the page says the link is no longer available and comment POST returns 404.
- Confirm the token cannot fetch another draft or footage. Confirm `?download=1` returns the pinned original as an attachment, and a revoked token returns 404.
