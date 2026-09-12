# Your Average Tech Bro

This npm-workspaces monorepo contains the applications for Your Average Tech Bro. Both applications run on TanStack Start and Cloudflare Workers.

## Repository layout

```text
apps/
  web/    Consulting website and Cloudflare Worker
  studio/ Private video production workspace and Cloudflare Worker
docs/
  migration/    Migration plan, architecture, and decision log
```

Add future applications under `apps`. Keep code inside an application until another application needs the same contract.

## Run the website

Install Node.js 22 or newer, then run these commands from the repository root:

```sh
npm ci
cp apps/web/.dev.vars.example apps/web/.dev.vars
npm run dev
```

Replace both placeholder values in `apps/web/.dev.vars` if you need to exercise Stripe. The landing page does not need Stripe credentials.

Open `http://localhost:3000`.

## Run Studio

Create the local D1 database and start Studio:

```sh
npx wrangler d1 migrations apply yatb-studio --local --cwd apps/studio
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters \
APP_ORIGIN=http://localhost:3001 EMAIL_MODE=capture \
EMAIL_FROM=studio@studio-mail.youraveragetechbro.com npm run dev:studio
```

Set a random `BETTER_AUTH_SECRET` with at least 32 characters. Open
`http://localhost:3001`. Local authentication messages are stored in the
`email_outbox` D1 table. Production sends them through the restricted
`AUTH_EMAIL` Cloudflare Email Sending binding.

## Check a change

Run the type and Cloudflare binding checks:

```sh
npm run check
```

Build the production Worker and prerendered landing page:

```sh
npm run build
```

Run the production output locally:

```sh
npm run preview
```

## Deploy the website

Authenticate Wrangler with the Cloudflare account that owns the project:

```sh
npx wrangler login
npx wrangler whoami
```

Set the production Stripe secret once for the `yatb-web` Worker:

```sh
npx wrangler secret put STRIPE_SECRET_KEY --cwd apps/web
```

Deploy the checked and built application:

```sh
npm run deploy:web
```

`apps/web/wrangler.jsonc` defines the Worker name, runtime date, non-secret bindings, and canonical application origin. The Stripe price ID is a public identifier stored there as a Worker variable. Run `npm run cf-typegen --workspace @yatb/web` after you change that file.

Studio deployment remains separate. Follow the checked production procedure in
[`docs/studio/production-runbook.md`](docs/studio/production-runbook.md). The
runbook separates validation, migration, and deployment so no production write
is hidden inside a check command.

The custom domain migration keeps `www.youraveragetechbro.com` as the canonical hostname and redirects the apex domain to `www`. Verify the `workers.dev` deployment before changing production DNS.
