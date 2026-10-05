ALTER TABLE "draft" ADD COLUMN "stream_uid" TEXT;
ALTER TABLE "draft" ADD COLUMN "stream_state" TEXT NOT NULL DEFAULT 'queued'
  CHECK ("stream_state" IN ('queued', 'copying', 'ready', 'failed', 'oversized', 'unavailable'));
ALTER TABLE "draft" ADD COLUMN "stream_error" TEXT;
ALTER TABLE "draft" ADD COLUMN "stream_updated_at" INTEGER;

CREATE UNIQUE INDEX "draft_stream_uid_unique"
  ON "draft" ("stream_uid") WHERE "stream_uid" IS NOT NULL;
CREATE INDEX "draft_stream_reconcile_idx"
  ON "draft" ("stream_state", "stream_updated_at");
