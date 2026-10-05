# PR #29 Stream proof

`.cursor/skills/principle-prove-it-works/SKILL.md` is not in this environment. This file is the prove-it-works receipt.

## What ran

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck --workspace @yatb/studio` | **pass** |
| Studio suite + integration harness | `npm test --workspace @yatb/studio` | **107 passed** |
| Segmented Stream HLS + seek | `node apps/studio/scripts/prove-hls-player.mjs` | **ok: true** (`networkOk`, `ffmpegOk`, `browserOk`). Receipt: `artifacts/studio/pr-29/hls-proof.json` |
| YK Labs D1 named `yatb-studio` | Cloudflare MCP `d1_database_query` on `e2d62270-da2c-4def-b3ce-878f1e02af9d` | Readable. Stream schema **not** applied |
| Worker account in `wrangler.jsonc` | `2a59d9e0842dc0b3d920f591fe82702c` / D1 `be13fc98-50a9-41d2-9e30-2edfbb0f2607` | **Not in MCP credentials.** `d1_database_get` → 404 |
| Wrangler | `npx wrangler whoami` / env `CLOUDFLARE*` / `STREAM*` | **No credentials** |
| Live `yatb-studio` Worker + Stream binding | MCP `workers_list` on `32967fffa44c1d38bc86ab6e4e419edb` and `4b0de17a66c8e2cf1ff11fba44d1d829` | Worker **absent** on those accounts. Wrangler account upload after cache purge showed `env.STREAM` |

## 1. Copy path (R2 → Stream → signed `loadDrafts`)

Harness: `tests/stream-integration.test.ts` calls the real `stream.server` functions against node:sqlite + a fake `STREAM` binding.

Observed:

- `ensureDraftStream` calls `STREAM.upload` with `requireSignedURLs: true` and `allowedOrigins: ['studio.youraveragetechbro.com']`.
- The copy URL is `/api/stream-source/:fileId?exp=&mac=`, not a public R2 URL.
- `readStreamSource` with that HMAC returns the exact R2 bytes (`1,2,3,4,5,9`). A forged mac returns `404`.
- Webhook without `STREAM_WEBHOOK_SECRET` returns `503`. A valid `Webhook-Signature` sets `stream_state = ready`.
- Cron `reconcileDraftStreams` polls `details()` and also marks ready.
- `signDraftPlayback` then attaches `https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8` — token replaces the UID. `reviewPlaybackSrc` uses that HLS URL, not `/api/videos/.../media/...`.

Live R2→Stream copy of a Studio draft was **not** run. No STREAM binding and no deploy access to the wrangler account.

## 2. Player path

- `reviewPlaybackSrc` / Review pane: ready drafts set `data-playback-src` to the signed `.m3u8`; progressive R2 is the fallback src. Tests in `tests/review-pane.test.ts` and `tests/reviews.test.ts`.
- Chromium: `attachAdaptivePlayback` calls `hls.js` `loadSource(signed m3u8)` + `attachMedia` when native HLS is absent. Safari-shaped `canPlayType('application/vnd.apple.mpegurl')` skips hls.js. Tests in `tests/review-player-hls.test.ts`.
- Comments: `commentSeekMs` maps point/range anchors onto the draft duration; the pane seeks that value. `4.2s` stays `4200`, a range starts at its start, overflow clamps to duration.
- Public Cloudflare Stream fixture (same HLS shape as signed `video.m3u8`):
  - Master `application/vnd.apple.mpegurl`, media playlist with **8** `#EXTINF` segments (`/seg_`).
  - Full 480p playlist **4,210,526** bytes; last two segments (seek-to-end) **589,619** bytes — subset, not the original progressive file.
  - Headless Chrome + hls.js: `currentTime = 2`, `duration ≈ 29.998`, `hlsJs: true`. `canPlayType` also reports native HLS (`native: true`).
  - ffmpeg `-i` then `-ss 8 -t 1` decoded **24 frames / 0.95s** and opened mid-file `1080/seg_3` + `1080/seg_4` (plus lower-rung probe segs). That is ABR segments, not one MP4 download.

## 3. Failure modes

| Claim | Observed in harness |
| --- | --- |
| `> 30 GB` | `stream_state = oversized`, `STREAM.upload` never called, player src stays R2 |
| Local Vite / no binding | `STREAM` omitted → `unavailable`; `signDraftPlayback` leaves `playbackUrl` null; src is `/api/videos/:id/media/:fileId` |
| Copy throw | `stream_state = failed`, src stays R2 |
| Bad ingest mac | `404` |

## 4. Gaps (blocked on provisioning)

- Repo Worker/D1 (`wrangler.jsonc` account `2a59d9e0842dc0b3d920f591fe82702c`, D1 `be13fc98-50a9-41d2-9e30-2edfbb0f2607`) is **not visible** to this agent’s Cloudflare MCP or wrangler login. Cannot deploy, bind STREAM, or attach the webhook there.
- YK Labs (`32967fffa44c1d38bc86ab6e4e419edb`) has a *different* D1 also named `yatb-studio` (`e2d62270-...`). Migrations stop at `0005`. `draft` has **no** `stream_*` columns. There is **1** draft (`980c8311-…`, 14s). No `yatb-studio` Worker on that account (only `yorby-admin-web`, `socialmediawarmer`).
- Therefore this agent could not: apply `0010` to the wrangler prod DB, deploy the `STREAM` binding, attach the webhook, or sign a real Studio draft.
- Do not treat prod review as Stream until migrate + deploy + webhook secret land on the wrangler account, then re-check `SELECT id, version, stream_state, stream_uid FROM draft`.

## How to re-run

```sh
npm run typecheck --workspace @yatb/studio
npm test --workspace @yatb/studio
node apps/studio/scripts/prove-hls-player.mjs
```
