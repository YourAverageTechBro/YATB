CREATE TABLE "media_derivative" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "source_media_file_id" TEXT NOT NULL,
  "profile" TEXT NOT NULL,
  "state" TEXT NOT NULL
    CHECK ("state" IN ('queued', 'processing', 'ready', 'not_beneficial', 'unsupported', 'failed')),
  "object_key" TEXT NOT NULL UNIQUE,
  "byte_size" INTEGER CHECK ("byte_size" IS NULL OR "byte_size" > 0),
  "content_type" TEXT,
  "object_etag" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "lease_until" INTEGER,
  "last_error" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE ("source_media_file_id", "profile"),
  FOREIGN KEY ("source_media_file_id", "video_id")
    REFERENCES "media_file" ("id", "video_id") ON DELETE CASCADE,
  CHECK (
    ("state" = 'ready' AND "byte_size" IS NOT NULL AND "content_type" = 'video/mp4' AND "object_etag" IS NOT NULL)
    OR ("state" != 'ready' AND "byte_size" IS NULL AND "content_type" IS NULL AND "object_etag" IS NULL)
  )
);

CREATE INDEX "media_derivative_reconcile_idx"
  ON "media_derivative" ("state", "lease_until", "updated_at");

