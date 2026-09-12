# Your Average Tech Bro

This npm-workspaces monorepo contains the applications for Your Average Tech Bro. The consulting website lives in `apps/web` and runs on TanStack Start and Cloudflare Workers.

## Repository layout

```text
apps/
  web/    Consulting website and Cloudflare Worker
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

Set the production Stripe secrets once for the `yatb-web` Worker:

```sh
npx wrangler secret put STRIPE_SECRET_KEY --cwd apps/web
npx wrangler secret put STRIPE_SUBSCRIPTION_PRICE_ID --cwd apps/web
```

Deploy the checked and built application:

```sh
npm run deploy:web
```

`apps/web/wrangler.jsonc` defines the Worker name, runtime date, bindings, and canonical application origin. Run `npm run cf-typegen --workspace @yatb/web` after you change that file.

The custom domain migration keeps `www.youraveragetechbro.com` as the canonical hostname and redirects the apex domain to `www`. Verify the `workers.dev` deployment before changing production DNS.
