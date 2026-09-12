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
- The `AUTH_EMAIL` binding restricts delivery to
  `dohyun@youraveragetechbro.com` and `jivedwinedompales@gmail.com`. Native
  Email Sending does not require destination verification.
- Wrangler is authenticated to the account above.

Confirm the non-secret resources without changing them.

```sh
npx wrangler whoami
npx wrangler d1 info yatb-studio --cwd apps/studio
npx wrangler r2 bucket info yatb-studio-media --cwd apps/studio
```

## Prepare

Confirm that the encrypted production Better Auth secret exists.

```sh
npx wrangler secret list --name yatb-studio --cwd apps/studio
```

To rotate the secret during an incident, generate a unique value and pipe it to
`wrangler secret put`. Never reuse a local value or put the value on a command
line. A rotation invalidates existing auth state and requires a session smoke
test.

Validate the exact source that will be deployed. This builds and performs a
Wrangler dry run. It does not migrate D1, deploy a Worker, or attach a domain.

```sh
npm run validate:studio:production
```

This is the only supported dry-run command. Do not append Wrangler flags to a
deploy script; npm does not reliably forward them through compound scripts.

Stop here unless the operator has explicitly authorized deployment. Record the
authorized commit SHA before continuing. The operator delegated deployment and
cutover authority to the root for STUDIO-07.

## Migrate and deploy

Apply every pending migration before deploying code that expects it. Wrangler
records applied migrations and creates a D1 backup before each application.

```sh
npm run migrate:studio:production
npm run deploy:studio
```

The deploy command always rebuilds before invoking Wrangler, so it cannot reuse
stale `dist` output. It does not hide validation or migration. Cloudflare
Workers Builds may build once during its build phase and again here; the second
build is intentionally redundant and keeps the same command safe for people
and automation. The custom-domain entry in `wrangler.jsonc` attaches
`studio.youraveragetechbro.com` and lets Cloudflare own its DNS record and
certificate.

## Verify

Run the read-only resource and signed-out boundary audit.

```sh
apps/studio/scripts/audit-production.sh
```

Then run every lane in the production launch feature map. Confirm real email
delivery before authentication drives. Inspect Workers Logs and verify that
errors and explicit application logs are retained while invocation logs are
disabled. This prevents auth query tokens from entering stored request URLs;
the query-redaction setting remains defense in depth for other telemetry.

If verification fails, stop writes. Use `wrangler versions list` and Cloudflare
deployment history to identify the last known-good version. Roll back the
Worker before attempting a forward fix. Do not reverse an applied D1 migration
without a reviewed compensating migration.
