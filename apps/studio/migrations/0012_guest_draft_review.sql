DROP TRIGGER IF EXISTS "comment_attachment_requires_footage";

CREATE TABLE "review_comment_next" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "draft_id" TEXT NOT NULL,
  "author_user_id" TEXT REFERENCES "user" ("id"),
  "guest_email" TEXT,
  "guest_name" TEXT,
  "parent_id" TEXT,
  "resolved_at" INTEGER,
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
  FOREIGN KEY ("parent_id", "video_id")
    REFERENCES "review_comment_next" ("id", "video_id") ON DELETE CASCADE,
  CHECK (
    ("anchor_kind" = 'point' AND "end_ms" IS NULL)
    OR ("anchor_kind" = 'range' AND "end_ms" > "start_ms")
  ),
  CHECK (
    (
      "author_user_id" IS NOT NULL
      AND "guest_email" IS NULL
      AND "guest_name" IS NULL
    )
    OR (
      "author_user_id" IS NULL
      AND "guest_email" IS NOT NULL
      AND length("guest_email") BETWEEN 3 AND 320
      AND ("guest_name" IS NULL OR (length("guest_name") BETWEEN 1 AND 80))
    )
  ),
  CHECK ("parent_id" IS NULL OR "resolved_at" IS NULL)
);

INSERT INTO "review_comment_next" (
  "id", "video_id", "draft_id", "author_user_id", "guest_email", "guest_name",
  "parent_id", "resolved_at", "anchor_kind", "start_ms", "end_ms", "body_json",
  "revision", "created_at", "updated_at"
)
SELECT
  "id", "video_id", "draft_id", "author_user_id", NULL, NULL,
  NULL, NULL, "anchor_kind", "start_ms", "end_ms", "body_json",
  "revision", "created_at", "updated_at"
FROM "review_comment";

CREATE TABLE "comment_attachment_next" (
  "comment_id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "media_file_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  PRIMARY KEY ("comment_id", "media_file_id"),
  UNIQUE ("comment_id", "position"),
  FOREIGN KEY ("comment_id", "video_id")
    REFERENCES "review_comment_next" ("id", "video_id") ON DELETE CASCADE,
  FOREIGN KEY ("media_file_id", "video_id")
    REFERENCES "media_file" ("id", "video_id") ON DELETE CASCADE
);

INSERT INTO "comment_attachment_next" (
  "comment_id", "video_id", "media_file_id", "position"
)
SELECT "comment_id", "video_id", "media_file_id", "position" FROM "comment_attachment";

DROP TABLE "comment_attachment";
DROP TABLE "review_comment";
ALTER TABLE "review_comment_next" RENAME TO "review_comment";
ALTER TABLE "comment_attachment_next" RENAME TO "comment_attachment";

CREATE INDEX "review_comment_draft_anchor_idx"
  ON "review_comment" ("draft_id", "start_ms", "created_at", "id");

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

CREATE TRIGGER "review_comment_reply_parent"
BEFORE INSERT ON "review_comment"
WHEN NEW."parent_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "review_comment"
  WHERE "id" = NEW."parent_id"
    AND "video_id" = NEW."video_id"
    AND "draft_id" = NEW."draft_id"
    AND "parent_id" IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'reply parent is invalid');
END;

CREATE TABLE "draft_review_share" (
  "draft_id" TEXT PRIMARY KEY NOT NULL,
  "video_id" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE CHECK (length("token") = 64),
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "created_at" INTEGER NOT NULL,
  UNIQUE ("draft_id", "video_id"),
  FOREIGN KEY ("draft_id", "video_id")
    REFERENCES "draft" ("id", "video_id") ON DELETE CASCADE
);

CREATE TABLE "guest_review_rate" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "window_started_at" INTEGER NOT NULL,
  "hit_count" INTEGER NOT NULL
);
