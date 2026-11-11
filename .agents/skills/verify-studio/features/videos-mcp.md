# Videos MCP

A signed-in operator mints a hashed bearer token in Settings with `videos:read` and `videos:write`. An MCP client uses it at `/mcp` to list, read, create, and update Studio videos.

## Sub-features

- `token-scopes` shows `videos:read` and `videos:write` next to the posts scopes. Existing tokens keep their stored JSON scopes.
- `mcp-tools` runs `list_videos`, `get_video`, `create_video`, and `update_video` against local Studio.
- `mcp-scope` returns a tool error when a write tool runs with only `videos:read`.
- `mcp-create-link` creates a short and a long-form integration linked to an organic long-form video.

## How to get to it (user POV)

- Sign in, open **Settings**, check `videos:read` and `videos:write`, create a token, copy the plaintext.
- Point an MCP client at `http://localhost:3001/mcp` with `Authorization: Bearer <token>`.

## Driving it with Codex computer control

Preconditions:

- Local D1 has migrations through `0015_mcp_access_tokens.sql`.
- A verified allowlisted session exists.

- **Create token.** Open Settings. Enter a name, check `videos:read` and `videos:write`, choose `Create token`. Copy the shown value.
- **Tools.** Run `.agents/skills/verify-studio/scripts/verify-videos-mcp.mjs` with `STUDIO_MCP_TOKEN` and `STUDIO_MCP_READ_TOKEN`.
- **Scope.** A read-only videos token gets a missing-scope tool error on `create_video`, not HTTP 401.
- **UI.** Open the created short and integration in `/videos/<id>` and confirm the Script field after `update_video`.

## Gotchas

- Create defaults status to `not-started`. An optional `status` uses the same enum and the existing update path after insert.
- PR #39 occupancy is picker-only. Shared organic links still save on main.
- Never log or paste the bearer token into evidence files. Record only the last four characters.
