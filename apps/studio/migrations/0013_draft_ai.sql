CREATE TABLE "draft_ai_job" (
  "draft_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('transcript', 'description', 'chapters')),
  "request_seq" INTEGER NOT NULL CHECK ("request_seq" >= 1),
  "state" TEXT NOT NULL CHECK ("state" IN ('queued', 'processing', 'ready', 'failed')),
  "attempts" INTEGER NOT NULL CHECK ("attempts" >= 0),
  "lease_id" TEXT,
  "lease_until" INTEGER,
  "failure_code" TEXT CHECK ("failure_code" IS NULL OR "failure_code" IN (
    'no-speech', 'budget', 'invalid-output', 'transcript-failed', 'provider', 'timed-out', 'ai-unavailable'
  )),
  "failure_detail" TEXT CHECK ("failure_detail" IS NULL OR length("failure_detail") <= 500),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("draft_id", "kind"),
  FOREIGN KEY ("draft_id", "video_id") REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE,
  CHECK (("state" = 'processing') = ("lease_id" IS NOT NULL)),
  CHECK (("lease_id" IS NULL) = ("lease_until" IS NULL)),
  CHECK ("state" != 'failed' OR "failure_code" IS NOT NULL),
  CHECK ("state" != 'ready' OR "failure_code" IS NULL)
);

CREATE INDEX "draft_ai_job_sweep_idx" ON "draft_ai_job" ("state", "lease_until", "updated_at");

-- The row appears when speech audio lands in R2. The transcript columns fill together when the transcript lands.
CREATE TABLE "draft_transcript" (
  "draft_id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "audio_etag" TEXT NOT NULL,
  "transcript_etag" TEXT,
  "segment_count" INTEGER CHECK ("segment_count" IS NULL OR "segment_count" > 0),
  "span_end_ms" INTEGER CHECK ("span_end_ms" IS NULL OR "span_end_ms" > 0),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('live', 'stub')),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  FOREIGN KEY ("draft_id", "video_id") REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE,
  CHECK (("transcript_etag" IS NULL) = ("segment_count" IS NULL)),
  CHECK (("transcript_etag" IS NULL) = ("span_end_ms" IS NULL))
);

-- Generator-owned. Replaced by each successful run. seq is that run's request_seq.
CREATE TABLE "draft_generation" (
  "draft_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "field" TEXT NOT NULL CHECK ("field" IN ('description', 'chapters')),
  "seq" INTEGER NOT NULL CHECK ("seq" >= 1),
  "text" TEXT NOT NULL CHECK (length("text") BETWEEN 1 AND 5000),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('live', 'stub')),
  "model" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  PRIMARY KEY ("draft_id", "field"),
  FOREIGN KEY ("draft_id", "video_id") REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE
);

-- Member-owned. base_seq is the generation the member typed over, 0 when none existed.
CREATE TABLE "draft_text_edit" (
  "draft_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "field" TEXT NOT NULL CHECK ("field" IN ('description', 'chapters')),
  "text" TEXT NOT NULL CHECK (length("text") <= 5000),
  "base_seq" INTEGER NOT NULL CHECK ("base_seq" >= 0),
  "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
  "updated_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("draft_id", "field"),
  FOREIGN KEY ("draft_id", "video_id") REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE
);

-- No foreign keys, so purging a video never refunds spend.
CREATE TABLE "ai_spend" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "month" TEXT NOT NULL CHECK ("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('transcript', 'description', 'chapters')),
  "video_id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "microusd" INTEGER NOT NULL CHECK ("microusd" >= 0),
  "settled" INTEGER NOT NULL CHECK ("settled" IN (0, 1)),
  "audio_ms" INTEGER,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE INDEX "ai_spend_month_idx" ON "ai_spend" ("month", "microusd");

CREATE TRIGGER "draft_ai_job_ready_requires_artifact"
BEFORE UPDATE OF "state" ON "draft_ai_job"
WHEN NEW."state" = 'ready' AND NOT (
  (NEW."kind" = 'transcript' AND EXISTS (
    SELECT 1 FROM "draft_transcript" t
    WHERE t."draft_id" = NEW."draft_id" AND t."transcript_etag" IS NOT NULL))
  OR (NEW."kind" != 'transcript' AND EXISTS (
    SELECT 1 FROM "draft_generation" g
    WHERE g."draft_id" = NEW."draft_id" AND g."field" = NEW."kind" AND g."seq" = NEW."request_seq"))
)
BEGIN
  SELECT RAISE(ABORT, 'draft_ai_job_ready_requires_artifact');
END;
