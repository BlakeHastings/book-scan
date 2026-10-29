CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "idx_author_alias_display_name_trgm" ON "author_alias" USING gist ("display_name" gist_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_books_title_trgm" ON "books" USING gist ("title" gist_trgm_ops);