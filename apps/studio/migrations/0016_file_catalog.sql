-- File catalog: tags plus footage duration.
-- Do not apply this to production from CI. Apply manually after a backup:
--   npx wrangler d1 migrations apply yatb-studio --remote --cwd apps/studio
-- Code shipped before this runs treats the catalog as unavailable (MCP files
-- tools return 503 text; existing posts/videos MCP and media routes stay up).
-- After migrate, backfill footage duration:
--   node apps/studio/scripts/backfill-footage-duration.mjs --local
--   node apps/studio/scripts/backfill-footage-duration.mjs --remote

ALTER TABLE "media_file" ADD COLUMN "duration_ms" INTEGER
  CHECK ("duration_ms" IS NULL OR "duration_ms" > 0);

CREATE TABLE "file_tag" (
  "kind" TEXT NOT NULL CHECK ("kind" IN ('footage', 'review_cut', 'post_media')),
  "file_id" TEXT NOT NULL,
  "tag" TEXT NOT NULL CHECK (length("tag") BETWEEN 1 AND 40 AND "tag" = lower("tag")),
  PRIMARY KEY ("kind", "file_id", "tag")
);

CREATE INDEX "file_tag_tag_idx" ON "file_tag" ("tag", "kind", "file_id");
CREATE INDEX "media_file_footage_duration_idx"
  ON "media_file" ("purpose", "duration_ms")
  WHERE "purpose" = 'footage';
