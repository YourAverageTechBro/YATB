#!/usr/bin/env bash
set -euo pipefail

studio_url="${STUDIO_URL:-http://localhost:3001}"
scratch_dir="$(mktemp -d)"
trap 'rm -rf "$scratch_dir"' EXIT

root_status="$(curl -sS -o "$scratch_dir/root" -w '%{http_code}' "$studio_url/")"
test "$root_status" = "200"
rg -q 'Welcome back' "$scratch_dir/root"

curl -sS -D "$scratch_dir/videos.headers" -o /dev/null "$studio_url/videos"
rg -qi '^location: /\r?$' "$scratch_dir/videos.headers"

curl -sS -D "$scratch_dir/missing.headers" -o "$scratch_dir/missing" "$studio_url/not-a-route"
rg -q '^HTTP/1.1 404' "$scratch_dir/missing.headers"
if rg -q 'No videos yet' "$scratch_dir/missing"; then
  exit 1
fi

curl -sS -D "$scratch_dir/media.headers" -o /dev/null \
  "$studio_url/api/videos/1b0e913b-645c-4306-a71d-78115390b46d/media/28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27"
rg -q '^HTTP/1.1 401' "$scratch_dir/media.headers"
rg -qi '^cache-control: private, no-store, max-age=0\r?$' "$scratch_dir/media.headers"

echo "Studio doctor passed at $studio_url"
