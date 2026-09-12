# Selected architecture

## Caller experience

The repository operator works from the root:

```sh
npm ci
npm run dev --workspace @yatb/web
npm run check
npm run build
npm run deploy:web
```

Visitors continue to use `/`, the existing section anchors, external waitlist and billing links, and `/success?session_id=...`. The home route is prerendered. The success route remains request-driven and non-cacheable because it authorizes its response against Stripe.

## Module map

```text
/
├── package.json
├── package-lock.json
├── README.md
├── .github/workflows/ci.yml
└── apps/web/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── wrangler.jsonc
    ├── worker-configuration.d.ts
    ├── public/
    └── src/
        ├── router.tsx
        ├── routeTree.gen.ts
        ├── routes/__root.tsx
        ├── routes/index.tsx
        ├── routes/success.tsx
        ├── server/stripe.functions.ts
        ├── server/stripe.server.ts
        ├── components/
        ├── lib/utils.ts
        └── styles.css
```

The root owns workspace discovery and cross-app commands. The web app owns its routes, components, assets, runtime, and deployment. Shared packages wait for a second real consumer.

## Server shape

`src/server/stripe.functions.ts` exposes two TanStack Start server functions. The Stripe SDK and private onboarding values remain in `src/server/stripe.server.ts`:

```ts
type PaidOnboarding = Readonly<{
  discordHandle: string
  whatsappLabel: string
  whatsappUrl: string
  supportEmail: string
  bookingUrl: string
}>

loadPaidOnboarding(input: string): Promise<PaidOnboarding>
beginMonthlyCoachingCheckout(): Promise<{ checkoutUrl: string }>
```

The module keeps Worker bindings, Stripe SDK values, API-version policy, payment-status interpretation, and protected onboarding constants private. Search input and environment values are validated where they enter the system. Stripe lookup needs only `STRIPE_SECRET_KEY`; checkout creation additionally requires `STRIPE_SUBSCRIPTION_PRICE_ID` and `APP_ORIGIN`. This prevents a missing dormant-checkout setting from breaking existing success links.

Invalid, missing, unpaid, and failed Stripe lookups preserve the current user-facing redirect to `/`. Diagnostics remain server-side. The success response is marked private and non-cacheable. The configured `APP_ORIGIN` replaces trust in the incoming Origin header and must be HTTPS in production.

## Cloudflare shape

The app uses the official Cloudflare Vite plugin before the TanStack Start and React plugins. `wrangler.jsonc` is the source of truth for the Worker name, account, compatibility date, runtime flags, observability, and non-secret variables. Worker secrets are set through Wrangler and never committed.

The Worker is deployed and verified on its `workers.dev` hostname before either production hostname is attached. `www.youraveragetechbro.com` remains canonical, and the apex continues to redirect to it. DNS cutover is a separate, verified operation.

## Synthesis decision

Candidate A is the base because it hides the most policy behind the smallest public surface and keeps the route-to-server call chain flat. Candidate B contributed canonical-origin validation and explicit Stripe failure mapping. Candidate C contributed account-bound Wrangler configuration, generated binding types, repeatable CI commands, an emitted-client secret scan, and a deployment-before-DNS gate.

The design rejects a shared UI or platform package, separate static and payment deployments, a generic Stripe adapter, root-level deployment configuration for all future apps, and onboarding values stored as operational secrets. Each adds coordination or runtime surface without another caller or stronger protection.

## Verification contract

- A clean root install succeeds from the committed lockfile.
- Root type-check and build commands succeed.
- The Cloudflare production bundle starts locally.
- `/` returns the expected metadata, content, anchors, image, and hydrated mobile navigation and FAQ.
- `/success` without a valid session redirects to `/` and sends private, non-cacheable headers.
- Browser assets contain neither Stripe secret names nor protected onboarding values.
- The deployed Worker passes the same route checks before DNS changes.
- The production `www` hostname serves Cloudflare, and the apex redirects to `www`.
