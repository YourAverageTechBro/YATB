# Posts composer

An authenticated user drafts shared X and Threads posts without posting them from Studio.

## Sub-features

- `posts-list` lists shared drafts next to Videos and Files.
- `posts-compose` edits a single post or an ordered thread with live X and Threads counts.
- `posts-autosave` persists drafts in D1 after idle and restores them on reload.
- `posts-ready` blocks Ready when any selected-target rule fails, then marks a valid draft ready.
- `posts-preview` shows a live preview for each selected platform.
- `posts-media` stores reorderable media in R2 under `posts/{draftId}/{mediaId}`.
- `posts-posted-readonly` keeps posted drafts read-only and offers Duplicate as a new draft.
- `posts-private-media` returns `401` and private cache policy for anonymous media GETs.

## How to get to it (user POV)

- Sign in, open `Posts` in the sidebar, then choose `New draft` or an existing card.

## Driving it with Codex computer control

Preconditions:

- A verified approved user is signed in.
- Studio passes the doctor, including anonymous `/api/posts/.../media/...` `401`.
- Local D1 migration `0014_posts.sql` is applied.

- **Open the list.** Confirm the heading `Posts`, empty copy `No posts yet` when none exist, and `New draft`.
- **Compose a thread.** Enter text in `Post 1 text`, choose `Add post`, enter `Post 2 text`. Confirm `X <used>/280` and `Threads <used>/500` update live. Confirm `X preview` and `Threads preview` exist when `Target` is `Both`.
- **Autosave.** Wait for the live `Saved` status. Reload. Confirm both post bodies remain.
- **Block Ready.** Paste 281 ASCII characters into post 1 with Target `Both` and Premium long post off. Confirm `Mark ready` is disabled and the page names the X length error.
- **Mark ready.** Restore valid text, wait for `Saved`, choose `Mark ready`. Reload and confirm the badge/status is ready. Confirm there is no control that posts to X or Threads.
- **Proof.** Capture the list, composer, reload, and blocked-Ready states. Pair with `.agents/skills/verify-studio/scripts/verify-posts.mjs` for D1 persistence, over-limit Ready rejection, and anonymous media `401`.

## Gotchas

- Studio never posts to X or Threads. `markPosted` exists only in the shared domain for a later MCP stack.
- Posted drafts are read-only. Duplicate creates a new draft; it does not mutate the posted row.
- X counting uses twitter-text v3 `parseTweet`. Threads counting is Unicode code points (`[...text].length`).
- Ready must fail when the draft breaks a rule for any selected target, including X media mix/size/duration when Target includes X.
- Media lives on the existing `MEDIA` binding. Do not look for a new R2 bucket or secret.
