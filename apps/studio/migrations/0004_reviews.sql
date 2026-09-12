ALTER TABLE "upload_session" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'footage'
  CHECK ("purpose" IN ('footage', 'draft'));
ALTER TABLE "upload_session" ADD COLUMN "draft_id" TEXT;
ALTER TABLE "upload_session" ADD COLUMN "draft_duration_ms" INTEGER
  CHECK ("draft_duration_ms" IS NULL OR "draft_duration_ms" > 0);

CREATE UNIQUE INDEX "upload_session_draft_id_unique"
  ON "upload_session" ("draft_id") WHERE "draft_id" IS NOT NULL;

ALTER TABLE "media_file" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'footage'
  CHECK ("purpose" IN ('footage', 'draft'));

CREATE UNIQUE INDEX "media_file_id_video_unique"
  ON "media_file" ("id", "video_id");
CREATE INDEX "media_file_video_purpose_created_idx"
  ON "media_file" ("video_id", "purpose", "created_at" DESC);

CREATE TABLE "draft" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "media_file_id" TEXT NOT NULL UNIQUE,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "duration_ms" INTEGER NOT NULL CHECK ("duration_ms" > 0),
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "created_at" INTEGER NOT NULL,
  UNIQUE ("video_id", "version"),
  UNIQUE ("id", "video_id"),
  FOREIGN KEY ("media_file_id", "video_id")
    REFERENCES "media_file" ("id", "video_id") ON DELETE CASCADE
);

CREATE TRIGGER "draft_requires_draft_media"
BEFORE INSERT ON "draft"
WHEN NOT EXISTS (
  SELECT 1 FROM "media_file"
  WHERE "id" = NEW."media_file_id"
    AND "video_id" = NEW."video_id"
    AND "purpose" = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'draft media is required');
END;

CREATE TABLE "review_comment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "author_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "anchor_kind" TEXT NOT NULL CHECK ("anchor_kind" IN ('point', 'range')),
  "start_ms" INTEGER NOT NULL CHECK ("start_ms" >= 0),
  "end_ms" INTEGER,
  "body_json" TEXT NOT NULL CHECK (length("body_json") <= 32768),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE ("id", "video_id"),
  FOREIGN KEY ("draft_id", "video_id")
    REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE,
  CHECK (
    ("anchor_kind" = 'point' AND "end_ms" IS NULL)
    OR ("anchor_kind" = 'range' AND "end_ms" > "start_ms")
  )
);

CREATE INDEX "review_comment_draft_anchor_idx"
  ON "review_comment" ("draft_id", "start_ms", "created_at", "id");

CREATE TABLE "comment_attachment" (
  "comment_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "media_file_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  PRIMARY KEY ("comment_id", "media_file_id"),
  UNIQUE ("comment_id", "position"),
  FOREIGN KEY ("comment_id", "video_id")
    REFERENCES "review_comment" ("id", "video_id") ON DELETE CASCADE,
  FOREIGN KEY ("media_file_id", "video_id")
    REFERENCES "media_file" ("id", "video_id") ON DELETE CASCADE
);

CREATE TRIGGER "comment_attachment_requires_footage"
BEFORE INSERT ON "comment_attachment"
WHEN NOT EXISTS (
  SELECT 1 FROM "media_file"
  WHERE "id" = NEW."media_file_id"
    AND "video_id" = NEW."video_id"
    AND "purpose" = 'footage'
)
BEGIN
  SELECT RAISE(ABORT, 'footage attachment is required');
END;
