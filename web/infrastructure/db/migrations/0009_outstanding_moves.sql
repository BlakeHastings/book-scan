CREATE TABLE "outstanding_move" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"shelf_range" text NOT NULL,
	"from_label" text NOT NULL,
	"to_label" text NOT NULL,
	"restore" text NOT NULL,
	"made_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outstanding_move" ADD CONSTRAINT "outstanding_move_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;