# Studio production runbook

Studio runs as the `yatb-studio` Worker in Cloudflare account
`32967fffa44c1d38bc86ab6e4e419edb`. Wrangler configuration is the source of
truth for the Worker, its custom domain, bindings, schedule, and observability.

## Prerequisites

- The `yatb-studio` D1 database has id
  `e2d62270-da2c-4def-b3ce-878f1e02af9d`.
- The private R2 bucket is named `yatb-studio-media`. Do not add a public
  development URL or custom domain to the bucket.
- `studio-mail.youraveragetechbro.com` is an active Cloudflare Email Sending
  domain. Its approved sender is `studio@studio-mail.youraveragetechbro.com`.
- `dohyun@youraveragetechbro.com` and `jivedwinedompales@gmail.com` are verified
  destination addresses in the same account.
- Wrangler is authenticated to the account above.

Confirm the non-secret resources without changing them.

```sh
npx wrangler whoami
npx wrangler d1 info yatb-studio --cwd apps/studio
npx wrangler r2 bucket info yatb-studio-media --cwd apps/studio
```

## Prepare

Install a unique production Better Auth secret once. Never reuse a local value
or put the secret on a command line.

```sh
npx wrangler secret put BETTER_AUTH_SECRET --cwd apps/studio
```

Validate the exact source that will be deployed. This builds and performs a
Wrangler dry run. It does not migrate D1, deploy a Worker, or attach a domain.

```sh
npm run validate:studio:production
```

Stop here for explicit deployment approval. The remaining commands write to
production. Record the approved commit SHA before continuing.

## Migrate and deploy

Apply every pending migration before deploying code that expects it. Wrangler
records applied migrations and creates a D1 backup before each application.

```sh
npm run migrate:studio:production
npm run deploy:studio
```

The deploy command only deploys. It does not hide validation or migration. The
custom-domain entry in `wrangler.jsonc` attaches
`studio.youraveragetechbro.com` and lets Cloudflare own its DNS record and
certificate.

## Verify

Run the read-only resource and signed-out boundary audit.

```sh
apps/studio/scripts/audit-production.sh
```

Then run every lane in the production launch feature map. Confirm real email
delivery before authentication drives. Inspect Workers Logs and verify that
invocation logs are retained at full sampling while query strings are redacted.

If verification fails, stop writes. Use `wrangler versions list` and Cloudflare
deployment history to identify the last known-good version. Roll back the
Worker before attempting a forward fix. Do not reverse an applied D1 migration
without a reviewed compensating migration.
