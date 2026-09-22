# Studio selected architecture

## Caller experience

Studio is a separate TanStack Start application in `apps/studio`. The existing
marketing application stays independently deployable in `apps/web`.

The only public product page is `/`. It contains sign in, account creation,
email verification, and password reset states. Authenticated users work in
`/videos`, `/videos/$videoId`, and `/videos/$videoId/compare`.

Route components call domain server functions. They never import D1, R2,
Better Auth, object keys, upload identifiers, or Cloudflare request types.

```ts
const video = await saveVideo({
  data: {
    id,
    expectedRevision,
    title,
    production: { format: 'long', promotion: 'integration' },
    status: 'ready-to-review',
    script,
  },
})

const files = await uploadFiles(video.id, selectedFiles, {
  purpose: 'footage',
  onProgress,
})

await addComment({
  data: {
    draftId,
    anchor: { kind: 'range', startMs: 12_100, endMs: 18_300 },
    body,
    attachmentIds: files.map((file) => file.id),
  },
})
```

## Application boundary

The app uses one Cloudflare Worker named `yatb-studio`. It owns SSR, static
assets, TanStack server functions, Better Auth endpoints, upload part routes,
and authenticated media delivery. The production custom domain is
`studio.youraveragetechbro.com`.

The root workspace adds explicit Studio commands. Root check and build commands
continue to discover every workspace. A source-distributed `@yatb/ui` package
owns shared shadcn primitives, fonts, and semantic monochrome tokens. It has no
server code, framework adapter, or deployment boundary.

```text
apps/studio/
  migrations/
  src/
    client/upload.ts
    components/
    routes/
      __root.tsx
      index.tsx
      _app.tsx
      _app.videos.*
      api.auth.$.ts
      api.uploads.*
      api.media.*
    server/
      auth.server.ts
      email.server.ts
      media.server.ts
      reviews.server.ts
      rich-document.ts
      videos.server.ts
    domain.ts
    router.tsx
    styles.css
  tests/
  package.json
  vite.config.ts
  wrangler.jsonc
packages/ui/
  components.json
  src/
    components/
    lib/utils.ts
    styles.css
  package.json
.agents/skills/verify-studio/
```

Both TanStack applications compile the UI package's TSX source directly into
their Workers. Explicit component subpath exports keep the public surface
small. Product components, route shells, theme preference state, server code,
and Cloudflare bindings stay in their owning applications.

## Domain model

Closed unions keep invalid video promotion states out of application code.

```ts
type Production =
  | { format: 'short'; promotion: 'organic' | 'advertisement' }
  | { format: 'long'; promotion: 'organic' | 'integration' }

type Status =
  | 'not-started'
  | 'filming'
  | 'ready-to-edit'
  | 'ready-to-review'
  | 'published'

type ReviewAnchor =
  | { kind: 'point'; atMs: number }
  | { kind: 'range'; startMs: number; endMs: number }
```

One status registry owns labels, sort order, board columns, and canonical
multiselect ordering. Planning URLs encode the exact selection as `all`, `none`,
or a comma-separated list. Saved views persist that selection as a JSON array. Rich text is
bounded editor JSON. The parser accepts only supported nodes, safe HTTP links,
and a fixed serialized size. The renderer never accepts stored HTML.

Task updates carry `expectedRevision`. A stale update returns the latest task
instead of silently overwriting another user's work. Status can move in either
direction because reshoots and re-edits are normal.

## D1 ownership

Better Auth uses the native D1 binding and owns its generated `user`, `session`,
`account`, `verification`, and rate limit tables. Application code does not
write authentication tables directly.

Application tables are small and query-oriented.

| Table | Invariant | Dominant read |
| --- | --- | --- |
| `allowed_email` | Normalized primary key and enabled flag | Signup and every protected request |
| `video` | Legal production union, status, script JSON, revision, deletion tombstone | Status and format views, task detail |
| `saved_view` | Owner, filters, grouping, layout, sort | User view selector |
| `upload_session` | Idempotency key, R2 upload id, immutable object key, state | Upload retry and completion |
| `file` | One task, one object key, mutable display name, ready state | Footage and task media lists |
| `draft` | One ready file and unique task-local version | Version list and review selection |
| `media_derivative` | One versioned profile per immutable draft source | Compression state and authenticated download |
| `review_comment` | One draft, one author, valid point or range, bounded rich text | Draft comments ordered by time |
| `comment_attachment` | Same-task comment and file references | Comment rendering |

Composite constraints prevent a comment from attaching media from another
task. Unique upload and draft constraints make retry safe. Indexes follow the
listed reads. There is no ORM or generic repository layer.

## Authentication boundary

Better Auth provides email and password sessions. Signup normalizes the email
and rejects any address that is not enabled in `allowed_email`. The first
migration seeds only these addresses.

- `dohyun@youraveragetechbro.com`
- `jivedwinedompales@gmail.com`

Email verification is required before sign in. Password reset revokes existing
sessions. Better Auth hooks send verification and reset messages through a
Cloudflare `send_email` binding.

The authenticated route layout redirects browser navigation. It is not the
security boundary. Every server function and raw media route calls the same
session guard and rechecks that the session email is still enabled. Mutations
also validate the exact Studio origin. Authenticated responses use
`Cache-Control: private, no-store`.

Cookies are secure, host-only, and scoped to the Studio host. The R2 bucket is
private. Raw object keys and multipart identifiers never cross the browser
contract.

## Cloudflare email boundary

Cloudflare Email Sending is active for the isolated sender domain
`studio-mail.youraveragetechbro.com`. The `AUTH_EMAIL` binding sends structured
messages from `studio@studio-mail.youraveragetechbro.com` and restricts delivery
to the two product users. Native Email Sending does not require destination
verification.

Local development captures email content in a local sink. A local log proves
the callback and token flow. It does not prove production delivery.

## R2 upload boundary

R2 stores every original file. The browser sees one `uploadFiles` operation.
The module hides an authenticated multipart protocol.

1. Begin validates the task, purpose, name, size, and content type. It creates
   an immutable server key and an idempotent D1 upload session.
2. The client sends 32 MiB parts through same-origin Worker routes with bounded
   total concurrency. Every non-final part has the same size and stays above
   the 5 MiB R2 minimum. Each request streams its body and rechecks the session.
3. Complete verifies part receipts and finishes R2 first.
4. A D1 batch publishes the file, creates a draft when needed, and marks the
   upload complete. Draft version allocation retries a unique constraint
   conflict instead of assuming concurrent `MAX(version) + 1` writes succeed.
5. A completion retry detects the finished immutable R2 object and resumes D1
   publication instead of creating a second file or version.

Multiple files run concurrently. Parts never buffer in Worker memory. Rename
changes D1 display metadata and never copies an R2 object. Comment attachments
use the footage upload path, so they also appear in the parent task footage
section.

Deletion first hides a task with a durable D1 tombstone. A scheduled Worker
handler retries R2 cleanup and then removes the relational records. D1 and R2
are never presented as one transaction.

## Playback and review boundary

An authenticated same-origin media route streams R2 content. It implements GET,
HEAD, valid byte ranges, `206`, `Content-Range`, `Content-Length`,
`Accept-Ranges`, and invalid-range `416` responses. Unsafe inline types download
as attachments with `nosniff`.

Native browser playback supplies scrubbing and speed control for compatible
MP4 and WebM drafts. Draft originals are immutable and receive increasing
task-local version numbers. Comments always reference one draft identity.

Clicking a point or range comment seeks its player to the anchor start. The
comparison route renders the same review component twice in a desktop
`1fr 1fr` grid. Each pane owns its player, rate, comments, and composer. The
parent owns only the selected draft ids.

Cloudflare Stream is not part of the initial architecture. R2 does not
transcode. A Queue consumer streams eligible draft originals from private R2
through one Worker-owned FFmpeg Container, then stores a versioned compact MP4
as a separate R2 object. D1 owns the retryable derivative state; the original
upload, draft, and `?download=1` route remain unchanged. The compact object is
published only when it is smaller than the source. Jobs are bounded to 3 GiB
and 12 minutes, retried at most four times, reconciled by the existing cron,
and deleted with their task. The authenticated media route gives ready
derivatives the same GET, HEAD, and single-range behavior as originals.

Cloudflare Stream remains outside this architecture. Browser-incompatible
playback formats may still justify Stream later, while these disposable
download derivatives continue to preserve R2 originals.

## Verification contract

The first PR creates `.agents/skills/verify-studio` after its direct proof. Each
later PR runs a maintenance wave against every mapped feature. The coordinator
owns one live app and serial browser driving. Independent source readers inspect
one feature each and may not modify product code.

Each PR must pass focused unit tests, root checks, root build, ten live browser
lanes, a measured performance gate against trunk, Ponytail before opening, and
the exact-head skeptical verification verdict required by Poteto mode.

## Synthesis decision

Candidate 1 supplies the base. It has the strongest upload recovery contract,
task-scoped attachment constraints, optimistic task revisions, and eventual
storage cleanup. Candidate 2 contributes explicit upload sessions and its case
for Stream when real formats require transcoding. Candidate 3 contributes the
separate Worker boundary and restraint around unused Cloudflare products.

The selected shape uses Worker-mediated R2 multipart upload instead of a whole
file request or browser-visible S3 signer. It defers Stream until fixtures prove
the need. It keeps saved views because the product explicitly asks users to
modify views, but it makes them per-user and single-workspace.

## Alternatives rejected

- A combined marketing and Studio Worker couples unrelated deployments and
  leaks host selection into routing.
- A generic repository and service stack lengthens every trace without a second
  implementation.
- Durable Objects add another state model without a real-time or serialization
  requirement.
- Public R2 objects or long-lived bearer links weaken session revocation for
  private footage.
- Whole-file Worker uploads fail for large production media because inbound
  request limits apply to each request.
- Stream for all footage adds lifecycle and cost before playback compatibility
  is measured.
- A custom collaborative editor adds conflict and synchronization machinery
  beyond the requested two-person workflow.
- App-local shadcn copies duplicate tokens and primitive upgrades now that Web
  and Studio are both real consumers.
- A compiled or published UI library adds a release boundary without hiding
  useful complexity inside this private npm workspace.

## Sources

- [TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)
- [R2 multipart uploads](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
- [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Better Auth TanStack integration](https://better-auth.com/docs/integrations/tanstack)
- [Better Auth hooks](https://better-auth.com/docs/concepts/hooks)
- [shadcn monorepo guidance](https://ui.shadcn.com/docs/monorepo)
- [shadcn Tailwind v4 guidance](https://ui.shadcn.com/docs/tailwind-v4)
