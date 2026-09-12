# Production launch

## User outcome

Studio is served from `https://studio.youraveragetechbro.com` by the
`yatb-studio` Worker. Signed-out visitors can reach only the login and auth
endpoints. Authenticated users retain every planning, footage, review, and
comparison workflow on the production D1 database and private R2 bucket.

## Resource contract

- Cloudflare account is `32967fffa44c1d38bc86ab6e4e419edb`.
- D1 database is `yatb-studio` with id
  `e2d62270-da2c-4def-b3ce-878f1e02af9d`.
- R2 bucket is the private bucket `yatb-studio-media`.
- The Worker custom domain is `studio.youraveragetechbro.com`.
- `BETTER_AUTH_SECRET` is an encrypted Worker secret.
- `AUTH_EMAIL` accepts only the two allowlisted destinations and sender
  `studio@studio-mail.youraveragetechbro.com`.
- The cleanup schedule runs every 15 minutes.
- Workers Logs retain errors and explicit application logs. The configuration
  requests query-string redaction and disables invocation logs, which is the
  proven boundary that keeps auth tokens out of stored request URLs.

## Drive

- Run `apps/studio/scripts/audit-production.sh` before authenticated changes.
- Run `npm run validate:studio:production` for a dry run. Never append dry-run
  flags to the production deploy command.
- Complete one real verification email and one password-reset email. Confirm
  acceptance in Cloudflare Email logs without recording either token.
- Sign in and run each mapped planning, footage, draft review, and comparison
  drive against production.
- Repeat private route and media requests signed out, then disable the test
  address in `allowed_email` and repeat with its existing session.
- Inspect the D1 rows and R2 object metadata created by the drive. Remove only
  the exact test task through the product deletion flow and wait for scheduled
  cleanup.

## Proof

- Save the audit output, custom-domain certificate details, Worker version,
  migration list, observability settings, and Email log result with the exact
  SHA. Confirm invocation logging is disabled before exercising auth links.
- Capture the signed-out login, signed-in shell, planning task, private footage,
  draft review, and comparison views.
- Record response timing for login, task list, first media byte, range seek, and
  comparison against the same Worker on `workers.dev` before domain cutoff.

## Traps

- Local captured email proves callbacks, not production delivery.
- A successful Worker deploy does not prove D1 migrations were applied.
- Do not make R2 public to simplify verification. All bytes stay behind the
  authenticated media route.
- Do not expose verification or reset tokens in screenshots, logs, URLs, or
  saved command output.
- Wrangler config is authoritative. Dashboard edits can be overwritten by the
  next deploy.
