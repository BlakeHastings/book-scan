CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "cover_embedding" (
	"capture_id" integer NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector NOT NULL,
	"computed_at" text NOT NULL,
	CONSTRAINT "cover_embedding_pkey" PRIMARY KEY("capture_id","model"),
	CONSTRAINT "cover_embedding_dimensions_check" CHECK ("dimensions" > 0 AND vector_dims("embedding") = "dimensions")
);
--> statement-breakpoint
ALTER TABLE "cover_embedding" ADD CONSTRAINT "cover_embedding_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "public"."capture"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cover_embedding_hnsw_512" ON "cover_embedding" USING hnsw (("embedding"::vector(512)) vector_cosine_ops) WHERE "dimensions" = 512;