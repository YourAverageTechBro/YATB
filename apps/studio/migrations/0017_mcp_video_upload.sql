CREATE TABLE "mcp_video_upload" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL REFERENCES "video" ("id") ON DELETE CASCADE,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "file_id" TEXT NOT NULL UNIQUE,
  "object_key" TEXT NOT NULL UNIQUE,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 240),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "content_type" TEXT NOT NULL CHECK (length("content_type") BETWEEN 1 AND 120),
  "expires_at" INTEGER NOT NULL,
  "draft_id" TEXT UNIQUE,
  "created_at" INTEGER NOT NULL
);

CREATE INDEX "mcp_video_upload_expires_idx"
  ON "mcp_video_upload" ("expires_at") WHERE "draft_id" IS NULL;
