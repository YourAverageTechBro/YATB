# Set up draft descriptions and chapters

Studio writes a YouTube description and chapters for a draft from the draft's transcript. A member selects **Generate** in the **YouTube description and chapters** panel under a draft. The Worker transcribes the draft with `@cf/deepgram/nova-3` and writes the text with `anthropic/claude-haiku-5.5`. Both calls go through the `AI` binding and one AI Gateway, so one Cloudflare credit balance pays for both.

This guide covers the one-time production setup. The routine migrate and deploy steps are in `docs/studio/production-runbook.md`. Run every command from the repository root, with Wrangler logged in to the account that `apps/studio/wrangler.jsonc` deploys to.

Until `AI_GATEWAY_ID` is set, the panel says "AI generation is not configured for this Studio." Members can still write, save, and copy text by hand.

## Create the gateway

1. In the Cloudflare dashboard, go to **AI** > **AI Gateway** and select **Create Gateway**.
2. Enter a gateway name, such as `yatb-studio`. Do not use `default`. AI Gateway creates a gateway named `default` on first use, so Studio refuses that name.
3. In **Workers AI Billing**, select **Unified billing**. Transcription is a Workers AI request, and this setting makes it spend the same credits as the writer.
4. Select **Create**.
5. In the gateway settings, turn on **Authenticated Gateway**. Requests from a Worker binding are pre-authenticated, so Studio needs no gateway token.
6. Load Unified Billing credits on the account. Cloudflare adds a 5% fee to each credit purchase.

## Store the gateway name as a secret

```sh
npx wrangler secret put AI_GATEWAY_ID --cwd apps/studio
```

Enter the gateway name at the prompt. `AI_GATEWAY_ID` is a secret and not a `vars` entry, so a deploy never overwrites it. It is also absent from `secrets.required`, so a deploy without it succeeds and the panel reports that AI is not configured.

`wrangler.jsonc` sets `DRAFT_AI_MODE` to `live`. Leave it there in production.

## Create the queue

Create the `yatb-draft-ai` queue once, before the first deploy that consumes it. Routine deploys must not recreate it.

```sh
npx wrangler queues create yatb-draft-ai --cwd apps/studio
npx wrangler queues info yatb-draft-ai --cwd apps/studio
```

## Migrate, then deploy

```sh
npm run migrate:studio:production
npm run deploy:studio
```

The migrate command runs `wrangler d1 migrations apply yatb-studio --remote` and applies `0013_draft_ai.sql`. Apply it before the deploy, because the panel reads the new tables on every draft page.

The deploy rebuilds the container image with the `POST /extract-audio` route and raises `max_instances` to 2. Compression runs on the `compact-mp4` instance and audio extraction runs on the `speech-audio` instance, so neither waits for the other.

## Replace the description footer

Every generated description ends with `DESCRIPTION_FOOTER` from `apps/studio/src/domain/youtube-metadata.ts`. The current text is placeholder copy. Replace it with Thomas's footer before members publish generated descriptions. YouTube rejects `<` and `>`, so keep both out of the footer.

## Check the first run

1. Open a long-format video with a draft shorter than 30 minutes.
2. Under **Description**, select **Generate**. The panel shows "Transcribing the draft…", then "Writing the description…", then the text. The **Stub AI** badge does not appear.
3. In the gateway logs, find one `@cf/deepgram/nova-3` request and one `anthropic/claude-haiku-5.5` request.
4. Read the job rows. Each row is `ready` with no failure code.

```sh
npx wrangler d1 execute yatb-studio --remote --cwd apps/studio --command "SELECT kind, state, failure_code FROM draft_ai_job ORDER BY updated_at DESC LIMIT 5"
```

If a row fails with `ai-unavailable`, the Worker found no usable gateway name. Put the secret again with the gateway's name, and do not use `default`. If a row fails with `provider`, confirm that the gateway exists and that the account has credits. If only the transcript row fails with `provider` on every draft, nova-3 may be refusing the Ogg Opus audio from `/extract-audio`. Switch the route in `apps/studio/container/server.mjs` to 16 kHz mono MP3 and send `audio/mpeg`.

## Compare the spend estimates with real costs

Studio refuses new generation when its estimated spend for the current UTC month reaches $5. `MONTHLY_AI_BUDGET` in `apps/studio/src/domain/ai-spend.ts` sets the cap. `AI_PRICE_ESTIMATES` in the same file holds per-call estimates, not vendor prices. After the first live runs, compare the month's total with the gateway's cost logs. If the estimates are low, raise them.

```sh
npx wrangler d1 execute yatb-studio --remote --cwd apps/studio --command "SELECT month, SUM(microusd) / 1000000.0 AS usd FROM ai_spend GROUP BY month"
```

## Turn generation off

To stop paid calls without a code change, delete the secret.

```sh
npx wrangler secret delete AI_GATEWAY_ID --cwd apps/studio
```

The panel then says AI generation is not configured. Jobs that were still waiting fail without calling a provider. To turn generation back on, put the secret again, and members can retry the failed fields.

## Develop without Cloudflare credentials

The **Run Studio** command in the root `README.md` sets `DRAFT_AI_MODE=stub`, and so does `apps/studio/.dev.vars.example`. Stub mode replaces audio extraction, transcription, and the writer with local stand-ins. The queue, the job ledger, the chapter rules, and the spend rows run as they do in production, and stub runs record zero spend. The panel shows the **Stub AI** badge.

Workers AI has no local simulator, and Cloudflare bills AI binding calls even in local development. `apps/studio/vite.config.ts` turns off remote bindings, so the dev server starts without Cloudflare credentials. Keep `DRAFT_AI_MODE=stub` locally.
