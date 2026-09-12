# TanStack Start and Cloudflare migration plan

## Definition of done

The repository is an npm-workspaces monorepo whose `apps/web` package builds and runs as a TanStack Start application on Cloudflare Workers. The `/` and `/success` routes preserve the current public behavior, Stripe secrets remain server-only, the production Worker belongs to the intended Cloudflare account, and the shipped `main` branch contains reproducible build, type-check, and deployment commands.

## Scope and rigor

This migration touches one application, two routes, six UI primitives, one server integration, the build system, hosting configuration, DNS, and repository documentation. The code is small, but the hosting and payment boundaries have a high blast radius, so each phase ends in an explicit check and the deployment is verified before DNS changes.

## Phases

1. Capture the existing architecture, public routes, delivery state, and baseline build result.
2. Compare structurally distinct monorepo and Cloudflare runtime designs, then select one.
3. Create the workspace scaffold and move the current app into `apps/web`.
4. Replace Next.js framework boundaries with TanStack Start routes and server functions.
5. Add Cloudflare Worker configuration, runtime types, secrets documentation, and deterministic checks.
6. Build and run the production artifact locally. Exercise `/`, `/success`, navigation, assets, and server-only behavior.
7. Deploy the Worker to the intended Cloudflare account and verify the generated hostname.
8. Attach the production hostnames, verify the live site, remove the Vercel delivery path where safely possible, then commit and push `main`.

## Current blockers and assumptions

- The first dependency install was blocked by sandboxed DNS. A fresh install succeeded once package-registry access was approved.
- Public DNS currently uses Namecheap nameservers and points at Vercel. A live hostname cutover may require registrar access that is not available through repository credentials.
- Cloudflare and Stripe credentials are external runtime state. The code migration can proceed before they are confirmed.
- `www.youraveragetechbro.com` remains canonical because that is the current public behavior.
- The dormant checkout code and guarded `/success` route remain supported to avoid breaking existing Stripe return links.
