CREATE TABLE "post_draft" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "target" TEXT NOT NULL CHECK ("target" IN ('x', 'threads', 'both')),
  "x_premium" INTEGER NOT NULL CHECK ("x_premium" IN (0, 1)),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'ready', 'posted')),
  "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
  "updated_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE INDEX "post_draft_updated_idx" ON "post_draft" ("updated_at" DESC, "id" ASC);
CREATE INDEX "post_draft_status_updated_idx" ON "post_draft" ("status", "updated_at" DESC);

CREATE TABLE "post" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "draft_id" TEXT NOT NULL REFERENCES "post_draft" ("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  "body" TEXT NOT NULL CHECK (length("body") <= 100000),
  UNIQUE ("draft_id", "position")
);

CREATE INDEX "post_draft_position_idx" ON "post" ("draft_id", "position");

CREATE TABLE "post_media" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "post_id" TEXT NOT NULL REFERENCES "post" ("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  "object_key" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 240),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "content_type" TEXT NOT NULL CHECK (length("content_type") BETWEEN 1 AND 120),
  "duration_ms" INTEGER CHECK ("duration_ms" IS NULL OR "duration_ms" > 0),
  "alt" TEXT CHECK ("alt" IS NULL OR length("alt") <= 2000),
  "created_at" INTEGER NOT NULL,
  UNIQUE ("post_id", "position")
);

CREATE INDEX "post_media_post_position_idx" ON "post_media" ("post_id", "position");

CREATE TABLE "post_publication" (
  "draft_id" TEXT NOT NULL REFERENCES "post_draft" ("id") ON DELETE CASCADE,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('x', 'threads')),
  "post_ids_json" TEXT NOT NULL,
  "urls_json" TEXT NOT NULL,
  "posted_at" INTEGER NOT NULL,
  PRIMARY KEY ("draft_id", "platform")
);

CREATE TABLE "post_upload" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "draft_id" TEXT NOT NULL REFERENCES "post_draft" ("id") ON DELETE CASCADE,
  "post_id" TEXT NOT NULL REFERENCES "post" ("id") ON DELETE CASCADE,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "client_request_id" TEXT NOT NULL,
  "media_id" TEXT NOT NULL UNIQUE,
  "object_key" TEXT NOT NULL UNIQUE,
  "r2_upload_id" TEXT UNIQUE,
  "initializer_token" TEXT,
  "initializer_lease_until" INTEGER,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 240),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "content_type" TEXT NOT NULL CHECK (length("content_type") BETWEEN 1 AND 120),
  "duration_ms" INTEGER CHECK ("duration_ms" IS NULL OR "duration_ms" > 0),
  "part_size" INTEGER NOT NULL CHECK ("part_size" = 33554432),
  "part_count" INTEGER NOT NULL CHECK ("part_count" BETWEEN 1 AND 10000),
  "state" TEXT NOT NULL CHECK ("state" IN (
    'initializing', 'uploading', 'completing', 'ready', 'cancelling', 'cancelled'
  )),
  "object_etag" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE ("draft_id", "created_by_user_id", "client_request_id")
);

CREATE TABLE "post_upload_part" (
  "upload_id" TEXT NOT NULL REFERENCES "post_upload" ("id") ON DELETE CASCADE,
  "part_number" INTEGER NOT NULL CHECK ("part_number" BETWEEN 1 AND 10000),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "etag" TEXT NOT NULL,
  "uploaded_at" INTEGER NOT NULL,
  PRIMARY KEY ("upload_id", "part_number")
);
