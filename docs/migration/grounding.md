# Existing application grounding

## Overview

The repository contains one Next.js 15 App Router application. The root route is a mostly static consulting landing page. The current conversion path sends visitors to a Google Forms waitlist, while existing customers can open Stripe's billing portal. The application has no database or authentication system.

The `/success` route is dynamic and sensitive. It accepts a Stripe Checkout Session ID, retrieves that session on the server, redirects unpaid or invalid sessions home, and only then renders onboarding contact details. The checkout creator is currently unreachable from the landing page but remains in the repository.

## Runtime flow

1. `app/layout.tsx` defines metadata, global styles, and Geist font variables.
2. `app/page.tsx` renders the complete `/` page. Radix Accordion and Dialog provide the hydrated FAQ and mobile navigation.
3. Both waitlist buttons open the same Google Form. Billing links open Stripe's hosted portal.
4. The dormant checkout button calls a Next server action that creates a Stripe subscription session.
5. Stripe returns paid customers to `/success?session_id=...`.
6. The success route verifies the session through Stripe before revealing onboarding details.

## Framework boundaries to replace

- Next route modules become TanStack Router file routes.
- `next/image`, `next/link`, `next/font`, metadata exports, request headers, and redirects need framework-neutral or TanStack Start equivalents.
- The Stripe server action becomes a validated TanStack Start server function.
- `STRIPE_SECRET_KEY` and `STRIPE_SUBSCRIPTION_PRICE_ID` become request-time Cloudflare Worker bindings.
- Tailwind 4, the shadcn-style primitives, the content image, anchor IDs, external URLs, and initially-expanded FAQ behavior remain observable contracts.

## Delivery state

The clean `main` branch matched `origin/main` at commit `9835b51`. GitHub deployment records and live response headers show Vercel production deployments. The apex redirects to `www`, and `www.youraveragetechbro.com` serves the current application from Vercel. The repository contains no CI workflow or checked-in Vercel project configuration.

## Chosen data shape

The repository root owns the workspace and cross-app commands. `apps/web` owns the consulting product, its routes, UI source, assets, Cloudflare Worker configuration, and runtime bindings. There is no shared package yet because no second consumer exists. Stripe input is modeled as validated route or server-function data, and Worker environment values are parsed at the server boundary before use.
