# Posts MCP

A signed-in operator mints a hashed bearer token in Settings. An MCP client uses it at `/mcp` to list posts, read a thread with short-lived media URLs, and record posted ids.

## Sub-features

- `token-create` shows plaintext once, stores only SHA-256, and lists name, scopes, created, last used. Settings also lists `videos:read` and `videos:write` for the Videos MCP tools.
- `token-revoke` stops that token with HTTP 401.
- `mcp-unauthenticated` returns 401 without a bearer token.
- `mcp-scope` returns a tool error when `mark_posted` runs with only `posts:read`.
- `mcp-tools` runs `list_posts`, `get_post`, and `mark_posted` against a seeded draft.

## How to get to it (user POV)

- Sign in, open **Settings**, create a token, copy the plaintext.
- Point an MCP client at `http://localhost:3001/mcp` with `Authorization: Bearer <token>`.

## Driving it with Codex computer control

Preconditions:

- Local D1 has migrations through `0015_mcp_access_tokens.sql` and `0014_posts.sql`.
- A verified allowlisted session exists.
- A `post_draft` row exists for the tool calls.

- **Create token.** Open Settings. Enter a name, leave both scopes checked, choose `Create token`. Copy the shown value. D1 `mcp_access_token.token_hash` is 64 hex characters and is not the plaintext.
- **401.** `POST /mcp` without Authorization returns `401`.
- **Tools.** Run `.agents/skills/verify-studio/scripts/verify-mcp.mjs` with `STUDIO_MCP_TOKEN` and a seeded post id.
- **Scope.** Create a read-only token. `mark_posted` returns a missing-scope tool error, not 401.
- **Revoke.** Revoke the first token. The same bearer then returns `401`.

## Gotchas

- Auto-deploy does not apply D1 migrations. Production needs `0015` applied before `/mcp` tokens work.
- Never log or paste the bearer token into evidence files. Record only the last four characters.
- `mark_posted` does not publish to X or Threads. It only stores ids the operator already posted.
