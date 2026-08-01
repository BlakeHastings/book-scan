"""SQLite catalogue plus CSV export.

Nothing in here removes a row. Deleting marks `deleted_at` and leaves the
record and its cover images in place, so a mis-click during a long scanning
session is always recoverable.
"""

from __future__ import annotations

import csv
import sqlite3
from datetime import datetime
from pathlib import Path

from .migrations import MigrationError, backup_database, migrate

# Columns written by add_book. Kept explicit so a schema change without a
# corresponding code change fails loudly rather than silently dropping data.
INSERT_COLUMNS = (
    "isbn13", "isbn10", "title", "authors", "publisher", "published",
    "pages", "notes", "isbn_source", "lookup_source", "front_image",
    "back_image", "ocr_title", "ocr_back_text", "ocr_front_text",
    "raw_barcodes",
)

CSV_COLUMNS = [
    "id", "isbn13", "isbn10", "title", "authors", "publisher", "published",
    "pages", "notes", "isbn_source", "lookup_source", "raw_barcodes",
    "front_image", "back_image", "scanned_at", "deleted_at",
]


class Store:
    def __init__(self, db_path: Path, backup_dir: Path | None = None) -> None:
        self.db_path = db_path
        self.backup_dir = backup_dir or db_path.parent / "backups"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        # The UI thread and the recognition worker both touch this connection,
        # but never at the same time, so a shared connection is safe here.
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        # Manual transaction control, which the migration runner needs.
        self._conn.isolation_level = None

        # A file that is not a database at all fails on the very first
        # statement, so the whole setup is guarded, not just the check.
        try:
            self._conn.execute("PRAGMA foreign_keys = ON")
            # WAL survives a crash mid-write far better than the rollback
            # journal, and FULL means an accepted book is on disk before the
            # next one is scanned. At a few writes per minute the cost of
            # that is irrelevant.
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.execute("PRAGMA synchronous = FULL")
            result = self._conn.execute("PRAGMA quick_check").fetchone()[0]
        except sqlite3.DatabaseError as exc:
            self._conn.close()
            raise MigrationError(
                f"{db_path} could not be read as a database ({exc}). It has "
                f"not been modified. Restore the newest file from "
                f"{self.backup_dir}."
            ) from exc

        if result != "ok":
            raise MigrationError(
                f"The catalogue at {db_path} failed its integrity check "
                f"({result}). It has not been modified. Restore the newest "
                f"file from {self.backup_dir} before continuing."
            )

        self.applied, self.backup = migrate(
            self._conn, db_path, self.backup_dir
        )

    # ------------------------------------------------------------------

    @property
    def schema_version(self) -> int:
        return int(self._conn.execute("PRAGMA user_version").fetchone()[0])

    def backup_now(self, tag: str = "manual") -> Path:
        """Take a consistent copy of the catalogue on demand."""
        return backup_database(
            self._conn, self.db_path, self.backup_dir, tag
        )

    # ------------------------------------------------------------------

    def add_book(self, record: dict) -> int:
        payload = {key: record.get(key, "") for key in INSERT_COLUMNS}
        payload["scanned_at"] = datetime.now().isoformat(timespec="seconds")

        columns = ", ".join(payload)
        placeholders = ", ".join(f":{key}" for key in payload)
        cursor = self._conn.execute(
            f"INSERT INTO books ({columns}) VALUES ({placeholders})", payload
        )
        return int(cursor.lastrowid)

    def find_by_isbn(self, isbn13: str) -> sqlite3.Row | None:
        if not isbn13:
            return None
        return self._conn.execute(
            "SELECT * FROM books WHERE isbn13 = ? AND deleted_at IS NULL "
            "ORDER BY id LIMIT 1",
            (isbn13,),
        ).fetchone()

    def get(self, book_id: int) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM books WHERE id = ?", (book_id,)
        ).fetchone()

    def count(self, include_deleted: bool = False) -> int:
        sql = "SELECT COUNT(*) FROM books"
        if not include_deleted:
            sql += " WHERE deleted_at IS NULL"
        return int(self._conn.execute(sql).fetchone()[0])

    def delete(self, book_id: int) -> None:
        """Soft delete. The row and its cover images stay on disk."""
        self._conn.execute(
            "UPDATE books SET deleted_at = ? "
            "WHERE id = ? AND deleted_at IS NULL",
            (datetime.now().isoformat(timespec="seconds"), book_id),
        )

    def restore(self, book_id: int) -> None:
        self._conn.execute(
            "UPDATE books SET deleted_at = NULL WHERE id = ?", (book_id,)
        )

    def export_csv(self, csv_path: Path, include_deleted: bool = True) -> int:
        sql = "SELECT * FROM books"
        if not include_deleted:
            sql += " WHERE deleted_at IS NULL"
        rows = self._conn.execute(sql + " ORDER BY id").fetchall()

        with open(csv_path, "w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(
                handle, fieldnames=CSV_COLUMNS, extrasaction="ignore"
            )
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row[key] for key in CSV_COLUMNS})
        return len(rows)

    def close(self) -> None:
        # Fold the WAL back into the main file so a copied books.db is whole.
        try:
            self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
        self._conn.close()
