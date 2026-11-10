CREATE TABLE "mcp_access_token" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  "token_hash" TEXT NOT NULL UNIQUE CHECK (length("token_hash") = 64),
  "scopes_json" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user" ("id"),
  "created_at" INTEGER NOT NULL,
  "last_used_at" INTEGER,
  "revoked_at" INTEGER
);

CREATE INDEX "mcp_access_token_created_idx" ON "mcp_access_token" ("created_at" DESC, "id" ASC);
