ALTER TABLE "video" ADD COLUMN "linked_organic_video_id" TEXT
  REFERENCES "video" ("id") ON DELETE SET NULL;

CREATE INDEX "video_linked_organic_idx"
  ON "video" ("linked_organic_video_id")
  WHERE "linked_organic_video_id" IS NOT NULL;

CREATE TRIGGER "video_link_guard_insert"
BEFORE INSERT ON "video"
WHEN NEW."linked_organic_video_id" IS NOT NULL AND (
  NEW."deleted_at" IS NOT NULL
  OR NEW."linked_organic_video_id" = NEW."id"
  OR NEW."format" != 'long'
  OR NEW."promotion" != 'integration'
  OR NOT EXISTS (
    SELECT 1 FROM "video" AS "target"
    WHERE "target"."id" = NEW."linked_organic_video_id"
      AND "target"."deleted_at" IS NULL
      AND "target"."format" = 'long'
      AND "target"."promotion" = 'organic'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'video-link-invalid');
END;

CREATE TRIGGER "video_link_guard_update"
BEFORE UPDATE OF "linked_organic_video_id", "format", "promotion", "deleted_at" ON "video"
WHEN NEW."linked_organic_video_id" IS NOT NULL AND (
  NEW."deleted_at" IS NOT NULL
  OR NEW."linked_organic_video_id" = NEW."id"
  OR NEW."format" != 'long'
  OR NEW."promotion" != 'integration'
  OR NOT EXISTS (
    SELECT 1 FROM "video" AS "target"
    WHERE "target"."id" = NEW."linked_organic_video_id"
      AND "target"."deleted_at" IS NULL
      AND "target"."format" = 'long'
      AND "target"."promotion" = 'organic'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'video-link-invalid');
END;

CREATE TRIGGER "video_link_target_invalidation"
AFTER UPDATE OF "format", "promotion", "deleted_at" ON "video"
WHEN OLD."deleted_at" IS NULL
  AND OLD."format" = 'long'
  AND OLD."promotion" = 'organic'
  AND NOT (
    NEW."deleted_at" IS NULL
    AND NEW."format" = 'long'
    AND NEW."promotion" = 'organic'
  )
BEGIN
  UPDATE "video"
  SET "linked_organic_video_id" = NULL,
      "revision" = "revision" + 1,
      "updated_at" = max("updated_at" + 1, NEW."updated_at")
  WHERE "linked_organic_video_id" = NEW."id";
END;

CREATE TRIGGER "video_link_target_hard_delete"
BEFORE DELETE ON "video"
BEGIN
  UPDATE "video"
  SET "linked_organic_video_id" = NULL,
      "revision" = "revision" + 1,
      "updated_at" = max("updated_at" + 1, OLD."updated_at" + 1)
  WHERE "linked_organic_video_id" = OLD."id";
END;
