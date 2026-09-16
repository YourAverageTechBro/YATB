#!/usr/bin/env bash
set -euo pipefail

account_id='2a59d9e0842dc0b3d920f591fe82702c'
database_id='be13fc98-50a9-41d2-9e30-2edfbb0f2607'
origin='https://studio.youraveragetechbro.com'

whoami_output="$(npx wrangler whoami --cwd apps/studio)"
grep -Fq "$account_id" <<<"$whoami_output"

d1_output="$(npx wrangler d1 info yatb-studio --cwd apps/studio)"
grep -Fq "$database_id" <<<"$d1_output"

r2_output="$(npx wrangler r2 bucket info yatb-studio-media --cwd apps/studio)"
grep -Fq 'yatb-studio-media' <<<"$r2_output"

secret_output="$(npx wrangler secret list --cwd apps/studio)"
grep -Fq 'BETTER_AUTH_SECRET' <<<"$secret_output"

login_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$origin/")"
private_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$origin/videos")"
media_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$origin/api/videos/00000000-0000-4000-8000-000000000000/media/00000000-0000-4000-8000-000000000001")"

test "$login_status" = '200'
case "$private_status" in
  301|302|303|307|308) ;;
  *) exit 1 ;;
esac
test "$media_status" = '401'

printf 'account_id=%s\n' "$account_id"
printf 'database_id=%s\n' "$database_id"
printf 'r2_bucket=yatb-studio-media\n'
printf 'better_auth_secret=present\n'
printf 'login_status=%s\n' "$login_status"
printf 'private_status=%s\n' "$private_status"
printf 'media_status=%s\n' "$media_status"
