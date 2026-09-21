ALTER TABLE "saved_view" RENAME TO "saved_view_before_calendar";

CREATE TABLE "saved_view" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "owner_user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "name" TEXT COLLATE NOCASE NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  "layout" TEXT NOT NULL CHECK ("layout" IN ('list', 'board', 'calendar')),
  "group_by" TEXT NOT NULL CHECK ("group_by" IN ('none', 'status', 'format')),
  "status_filter" TEXT NOT NULL CHECK ("status_filter" IN (
    'all', 'not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published'
  )),
  "format_filter" TEXT NOT NULL CHECK ("format_filter" IN ('all', 'short', 'long')),
  "sort" TEXT NOT NULL CHECK ("sort" IN (
    'updated-desc', 'publish-date-asc', 'title-asc'
  )),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  CHECK (
    ("layout" = 'list' AND "group_by" IN ('none', 'status', 'format'))
    OR ("layout" = 'board' AND "group_by" = 'status')
    OR ("layout" = 'calendar' AND "group_by" = 'none' AND "sort" = 'publish-date-asc')
  ),
  UNIQUE ("owner_user_id", "name")
);

INSERT INTO "saved_view" (
  "id", "owner_user_id", "name", "layout", "group_by", "status_filter",
  "format_filter", "sort", "created_at", "updated_at"
)
SELECT "id", "owner_user_id", "name", "layout", "group_by", "status_filter",
  "format_filter", "sort", "created_at", "updated_at"
FROM "saved_view_before_calendar";

DROP TABLE "saved_view_before_calendar";

CREATE INDEX "saved_view_owner_updated_idx"
  ON "saved_view" ("owner_user_id", "updated_at" DESC);

CREATE INDEX "video_active_publish_date_idx"
  ON "video" ("publish_date", "id")
  WHERE "deleted_at" IS NULL AND "publish_date" IS NOT NULL;
