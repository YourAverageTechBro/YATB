ALTER TABLE "video" ADD COLUMN "cleanup_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "video" ADD COLUMN "cleanup_after" INTEGER;
ALTER TABLE "video" ADD COLUMN "cleanup_error" TEXT;

CREATE TABLE "upload_session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL REFERENCES "video" ("id") ON DELETE CASCADE,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "client_request_id" TEXT NOT NULL,
  "file_id" TEXT NOT NULL UNIQUE,
  "object_key" TEXT NOT NULL UNIQUE,
  "r2_upload_id" TEXT UNIQUE,
  "initializer_token" TEXT,
  "initializer_lease_until" INTEGER,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 240),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "content_type" TEXT NOT NULL CHECK (length("content_type") BETWEEN 1 AND 120),
  "part_size" INTEGER NOT NULL CHECK ("part_size" = 33554432),
  "part_count" INTEGER NOT NULL CHECK ("part_count" BETWEEN 1 AND 10000),
  "state" TEXT NOT NULL CHECK ("state" IN (
    'initializing', 'uploading', 'completing', 'ready', 'cancelling', 'cancelled'
  )),
  "object_etag" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "completed_at" INTEGER,
  "cancelled_at" INTEGER,
  UNIQUE ("video_id", "created_by_user_id", "client_request_id")
);

CREATE INDEX "upload_session_video_state_idx"
  ON "upload_session" ("video_id", "state", "updated_at");

CREATE TABLE "upload_part" (
  "upload_session_id" TEXT NOT NULL REFERENCES "upload_session" ("id") ON DELETE CASCADE,
  "part_number" INTEGER NOT NULL CHECK ("part_number" BETWEEN 1 AND 10000),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "etag" TEXT NOT NULL,
  "uploaded_at" INTEGER NOT NULL,
  PRIMARY KEY ("upload_session_id", "part_number")
);

CREATE TABLE "media_file" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL REFERENCES "video" ("id") ON DELETE CASCADE,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "upload_session_id" TEXT NOT NULL UNIQUE REFERENCES "upload_session" ("id") ON DELETE CASCADE,
  "object_key" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 240),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "content_type" TEXT NOT NULL CHECK (length("content_type") BETWEEN 1 AND 120),
  "object_etag" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE INDEX "media_file_video_created_idx"
  ON "media_file" ("video_id", "created_at" DESC);

CREATE INDEX "video_cleanup_due_idx"
  ON "video" ("deleted_at", "cleanup_after");
