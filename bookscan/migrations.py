"""Schema migrations.

The rules this module enforces, because a book collection is entered once and
retyping it is not an option:

  1. Migrations are append-only. Once a version has been applied anywhere it
     is frozen. Editing it is detected by checksum and refused.
  2. Migrations are additive. Adding tables, columns and indexes is allowed.
     Dropping or deleting is refused unless a migration explicitly opts in,
     which should essentially never happen.
  3. The database is backed up before any migration runs, using SQLite's
     online backup API so the copy is consistent.
  4. Each migration applies inside its own transaction. A failure rolls that
     migration back and stops, leaving the database on the last good version.
  5. A database newer than the code is refused rather than opened, because
     older code cannot know what newer columns mean.

To add functionality later, append a new Migration to MIGRATIONS with the
next version number. Never renumber, never edit an existing one.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


class MigrationError(RuntimeError):
    """Raised when migrating would be unsafe. Nothing has been changed."""


# Anything that can destroy rows or columns. ALTER TABLE ... RENAME is caught
# too, since SQLite's rename is a common step in accidental data loss.
_DESTRUCTIVE = re.compile(
    r"\b("
    r"DROP\s+TABLE|DROP\s+VIEW|DROP\s+TRIGGER|"
    r"DELETE\s+FROM|"
    r"ALTER\s+TABLE\s+\S+\s+DROP(\s+COLUMN)?|"
    r"ALTER\s+TABLE\s+\S+\s+RENAME|"
    r"TRUNCATE"
    r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    statements: tuple[str, ...]
    # Opt-in escape hatch. Setting this is a deliberate decision to allow a
    # destructive statement, and should be accompanied by a very good reason.
    allow_destructive: bool = False

    @property
    def checksum(self) -> str:
        payload = "\n".join(" ".join(s.split()) for s in self.statements)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def guard(self) -> None:
        if self.allow_destructive:
            return
        for statement in self.statements:
            match = _DESTRUCTIVE.search(statement)
            if match:
                raise MigrationError(
                    f"Migration {self.version} ({self.name}) contains the "
                    f"destructive statement '{match.group(0)}'. Migrations "
                    "must be additive. If this is genuinely required, set "
                    "allow_destructive=True on the migration and back up "
                    "first."
                )


# ---------------------------------------------------------------------------
# The migrations themselves. Append only.
# ---------------------------------------------------------------------------

MIGRATIONS: tuple[Migration, ...] = (
    Migration(
        version=1,
        name="initial_schema",
        statements=(
            """
            CREATE TABLE IF NOT EXISTS books (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                isbn13         TEXT,
                isbn10         TEXT,
                title          TEXT NOT NULL,
                authors        TEXT,
                publisher      TEXT,
                published      TEXT,
                pages          TEXT,
                notes          TEXT,
                isbn_source    TEXT,
                lookup_source  TEXT,
                front_image    TEXT,
                back_image     TEXT,
                ocr_title      TEXT,
                ocr_back_text  TEXT,
                scanned_at     TEXT NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books (isbn13)",
            "CREATE INDEX IF NOT EXISTS idx_books_title ON books (title)",
        ),
    ),
    Migration(
        version=2,
        name="retain_raw_capture_data_and_soft_delete",
        statements=(
            # The raw barcode payloads, kept so a mis-parsed ISBN can always
            # be recovered from what the scanner actually read.
            "ALTER TABLE books ADD COLUMN raw_barcodes TEXT",
            # The full front-cover OCR, not just the chosen title line.
            "ALTER TABLE books ADD COLUMN ocr_front_text TEXT",
            # Soft delete. Rows are never removed, only marked.
            "ALTER TABLE books ADD COLUMN deleted_at TEXT",
            "CREATE INDEX IF NOT EXISTS idx_books_deleted "
            "ON books (deleted_at)",
        ),
    ),
    Migration(
        version=3,
        name="shelving_spine_and_series",
        statements=(
            # A photograph of the spine, so a book can be recognised on the
            # shelf without pulling it out.
            "ALTER TABLE books ADD COLUMN spine_image TEXT",
            # Where it physically lives. Shelf is S1 to S4; area is the
            # lettered zone within that shelf, filled in after shelving.
            "ALTER TABLE books ADD COLUMN shelf TEXT",
            "ALTER TABLE books ADD COLUMN area TEXT",
            "ALTER TABLE books ADD COLUMN placed_at TEXT",
            # Series ordering, which overrides title order within an author.
            "ALTER TABLE books ADD COLUMN series TEXT",
            "ALTER TABLE books ADD COLUMN series_number TEXT",
            # 1 fiction, 0 non-fiction. Decides shelf group; S4 is
            # non-fiction.
            "ALTER TABLE books ADD COLUMN is_fiction INTEGER",
            # The surname the book files under, editable when the automatic
            # guess gets a name like "Ursula K. Le Guin" wrong.
            "ALTER TABLE books ADD COLUMN sort_author TEXT",
            # Raw subject terms from the catalogue, kept so a fiction guess
            # can be audited later.
            "ALTER TABLE books ADD COLUMN subjects TEXT",
            "CREATE INDEX IF NOT EXISTS idx_books_shelf "
            "ON books (shelf, area)",
            "CREATE INDEX IF NOT EXISTS idx_books_sort "
            "ON books (sort_author, series, series_number)",
        ),
    ),
)


def latest_version() -> int:
    return max(m.version for m in MIGRATIONS) if MIGRATIONS else 0


def _validate_migration_list() -> None:
    versions = [m.version for m in MIGRATIONS]
    if versions != sorted(versions):
        raise MigrationError("MIGRATIONS must be ordered by version.")
    if len(set(versions)) != len(versions):
        raise MigrationError("Duplicate migration version numbers.")
    if versions and versions[0] != 1:
        raise MigrationError("Migration versions must start at 1.")
    for previous, current in zip(versions, versions[1:]):
        if current != previous + 1:
            raise MigrationError(
                f"Migration versions must be contiguous: {previous} then "
                f"{current}."
            )


def _user_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def _ensure_meta(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            checksum   TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )


def _verify_history(conn: sqlite3.Connection) -> None:
    """Refuse to continue if a migration that already ran has been edited."""
    known = {m.version: m for m in MIGRATIONS}
    rows = conn.execute(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
    ).fetchall()

    for version, name, checksum in rows:
        migration = known.get(version)
        if migration is None:
            raise MigrationError(
                f"The database has migration {version} ({name}) applied, but "
                "this version of book-scan does not know about it. You are "
                "running older code against a newer database. Update the "
                "code rather than opening this database."
            )
        if migration.checksum != checksum:
            raise MigrationError(
                f"Migration {version} ({name}) has changed since it was "
                "applied to this database. Applied migrations are frozen. "
                "Revert the edit and add a new migration instead."
            )


def _has_user_tables(conn: sqlite3.Connection) -> bool:
    """True if this database holds anything beyond our own bookkeeping."""
    row = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' "
        "AND name NOT IN ('schema_migrations', 'sqlite_sequence')"
    ).fetchone()
    return int(row[0]) > 0


def backup_database(
    conn: sqlite3.Connection, db_path: Path, backup_dir: Path, tag: str
) -> Path:
    """Consistent online copy of the database. Backups are never pruned."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = backup_dir / f"{db_path.stem}-{stamp}-{tag}.db"

    # If the name is somehow taken, do not overwrite it.
    counter = 1
    while destination.exists():
        destination = backup_dir / f"{db_path.stem}-{stamp}-{tag}-{counter}.db"
        counter += 1

    with sqlite3.connect(str(destination)) as target:
        conn.backup(target)
    return destination


def migrate(
    conn: sqlite3.Connection, db_path: Path, backup_dir: Path
) -> tuple[list[str], Path | None]:
    """Bring the database up to the latest version.

    Returns the descriptions of what was applied, and the backup taken before
    doing so (None when nothing needed applying).
    """
    _validate_migration_list()
    _ensure_meta(conn)

    current = _user_version(conn)
    target = latest_version()

    if current > target:
        raise MigrationError(
            f"This database is at schema version {current}, but this copy of "
            f"book-scan only understands version {target}. Opening it with "
            "older code risks writing rows that the newer version cannot "
            "read. Update book-scan instead."
        )

    _verify_history(conn)

    pending = [m for m in MIGRATIONS if m.version > current]
    if not pending:
        return [], None

    for migration in pending:
        migration.guard()

    # Back up before touching anything, whenever there is anything to lose.
    # This deliberately triggers for a database created before this migration
    # system existed, which reports version 0 but is full of real books.
    backup: Path | None = None
    if _has_user_tables(conn):
        backup = backup_database(
            conn, db_path, backup_dir, f"v{current}-to-v{target}"
        )

    applied: list[str] = []
    for migration in pending:
        try:
            conn.execute("BEGIN IMMEDIATE")
            for statement in migration.statements:
                conn.execute(statement)
            conn.execute(
                "INSERT INTO schema_migrations "
                "(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
                (
                    migration.version,
                    migration.name,
                    migration.checksum,
                    datetime.now().isoformat(timespec="seconds"),
                ),
            )
            # user_version is part of the database header and moves with the
            # transaction, so a rollback un-does the version bump too.
            conn.execute(f"PRAGMA user_version = {migration.version}")
            conn.execute("COMMIT")
        except Exception as exc:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            hint = f" A backup was taken at {backup}." if backup else ""
            raise MigrationError(
                f"Migration {migration.version} ({migration.name}) failed and "
                f"was rolled back. The database is still at version "
                f"{_user_version(conn)} and no data was lost.{hint} "
                f"Cause: {exc}"
            ) from exc

        applied.append(f"v{migration.version} {migration.name}")

    return applied, backup
