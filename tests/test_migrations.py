"""Proves the migration system does not lose data.

The scenarios that matter: adopting a database written before migrations
existed, upgrading a populated database, refusing to run when something is
wrong, and rolling back cleanly when a migration fails halfway.

Run with:  uv run tests/test_migrations.py
"""
import sys, sqlite3, tempfile, shutil
from pathlib import Path

from bookscan import migrations as mig
from bookscan.migrations import Migration, MigrationError
from bookscan.store import Store

ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


def fresh_dir() -> Path:
    return Path(tempfile.mkdtemp())


# The exact schema the app shipped with before migrations existed.
LEGACY_SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn13         TEXT, isbn10 TEXT, title TEXT NOT NULL, authors TEXT,
    publisher      TEXT, published TEXT, pages TEXT, notes TEXT,
    isbn_source    TEXT, lookup_source TEXT, front_image TEXT,
    back_image     TEXT, ocr_title TEXT, ocr_back_text TEXT,
    scanned_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books (isbn13);
CREATE INDEX IF NOT EXISTS idx_books_title  ON books (title);
"""

# =========================================================================
print("--- migration list is well formed ---")
mig._validate_migration_list()
check("migration list validates", True)
check("versions are contiguous from 1",
      [m.version for m in mig.MIGRATIONS] == list(range(1, mig.latest_version() + 1)),
      [m.version for m in mig.MIGRATIONS])
check("every migration passes the destructive guard",
      all(m.guard() is None for m in mig.MIGRATIONS))

# =========================================================================
print("\n--- a fresh catalogue ---")
d = fresh_dir()
s = Store(d / "books.db", d / "backups")
check("fresh db is at the latest version", s.schema_version == mig.latest_version(),
      s.schema_version)
check("all migrations recorded", len(s.applied) == len(mig.MIGRATIONS), s.applied)
check("no backup taken for an empty new db", s.backup is None, s.backup)
cols = {r["name"] for r in s._conn.execute("PRAGMA table_info(books)")}
check("v2 columns present",
      {"raw_barcodes", "ocr_front_text", "deleted_at"} <= cols)
check("v3 columns present",
      {"spine_image", "shelf", "area", "placed_at", "series",
       "series_number", "is_fiction", "sort_author", "subjects"} <= cols,
      sorted(cols))
s.close()

# reopening must be a no-op
s = Store(d / "books.db", d / "backups")
check("reopening applies nothing", s.applied == [], s.applied)
check("still at latest version", s.schema_version == mig.latest_version())
s.close()

# =========================================================================
print("\n--- adopting a pre-migration database that already has books ---")
d = fresh_dir()
db = d / "books.db"
legacy = sqlite3.connect(str(db))
legacy.executescript(LEGACY_SCHEMA)
ROWS = [
    ("9780547928227", "054792822X", "The Hobbit", "J.R.R. Tolkien",
     "Houghton Mifflin", "1937", "300", "gift from mum", "barcode",
     "Open Library", "c:/x/front1.jpg", "c:/x/back1.jpg", "THE HOBBIT",
     "isbn 978...", "2026-07-30T10:00:00"),
    ("9780261102217", "0261102214", "The Fellowship of the Ring",
     "J.R.R. Tolkien", "HarperCollins", "1954", "531", "", "ocr",
     "Google Books", "c:/x/front2.jpg", "c:/x/back2.jpg", "FELLOWSHIP",
     "isbn 978...", "2026-07-30T10:05:00"),
]
legacy.executemany(
    "INSERT INTO books (isbn13, isbn10, title, authors, publisher, published,"
    " pages, notes, isbn_source, lookup_source, front_image, back_image,"
    " ocr_title, ocr_back_text, scanned_at) VALUES (" + ",".join("?" * 15) + ")",
    ROWS,
)
legacy.commit()
check("legacy db reports version 0",
      legacy.execute("PRAGMA user_version").fetchone()[0] == 0)
legacy.close()

s = Store(db, d / "backups")
check("legacy db migrated to latest", s.schema_version == mig.latest_version(),
      s.schema_version)
check("a backup WAS taken for the populated legacy db", s.backup is not None,
      s.backup)
check("backup file exists on disk", s.backup and s.backup.exists())
check("both books survived", s.count() == 2, s.count())

got = s._conn.execute("SELECT * FROM books ORDER BY id").fetchall()
check("row 1 title intact", got[0]["title"] == "The Hobbit", got[0]["title"])
check("row 1 notes intact", got[0]["notes"] == "gift from mum", got[0]["notes"])
check("row 1 isbn intact", got[0]["isbn13"] == "9780547928227")
check("row 1 image path intact", got[0]["front_image"] == "c:/x/front1.jpg")
check("row 1 scanned_at intact", got[0]["scanned_at"] == "2026-07-30T10:00:00")
check("row 2 title intact", got[1]["title"] == "The Fellowship of the Ring")
check("new columns default to NULL, not garbage",
      got[0]["raw_barcodes"] is None and got[0]["deleted_at"] is None
      and got[0]["shelf"] is None and got[0]["spine_image"] is None
      and got[0]["is_fiction"] is None)
check("a legacy book survives all the way to the current schema",
      s.schema_version == mig.latest_version() and s.count() == 2,
      f"v{s.schema_version}, {s.count()} books")

# the backup must be a real, readable database holding the pre-migration data
b = sqlite3.connect(str(s.backup))
b.row_factory = sqlite3.Row
backup_rows = b.execute("SELECT * FROM books ORDER BY id").fetchall()
check("backup holds both books", len(backup_rows) == 2, len(backup_rows))
check("backup content intact", backup_rows[0]["title"] == "The Hobbit")
backup_cols = {r[1] for r in b.execute("PRAGMA table_info(books)")}
check("backup is the PRE-migration shape", "raw_barcodes" not in backup_cols)
b.close()

# writing to the new columns works
new_id = s.add_book({
    "isbn13": "9780345339683", "title": "The Return of the King",
    "authors": "J.R.R. Tolkien", "raw_barcodes": "9780345339683, 51299",
    "ocr_front_text": "THE RETURN OF THE KING",
})
check("insert into migrated db works", new_id == 3, new_id)
row = s.get(3)
check("raw_barcodes stored", row["raw_barcodes"] == "9780345339683, 51299")
check("count reflects three books", s.count() == 3, s.count())
s.close()

# =========================================================================
print("\n--- deleting never destroys ---")
s = Store(db, d / "backups")
s.delete(3)
check("soft deleted row still exists", s.get(3) is not None)
check("soft deleted row keeps its title", s.get(3)["title"] == "The Return of the King")
check("deleted_at is set", s.get(3)["deleted_at"] is not None)
check("count excludes deleted", s.count() == 2, s.count())
check("count can include deleted", s.count(include_deleted=True) == 3)
check("deleted book is not a duplicate match",
      s.find_by_isbn("9780345339683") is None)
s.restore(3)
check("restore brings it back", s.count() == 3 and s.get(3)["deleted_at"] is None)

csv_path = d / "out.csv"
s.delete(3)
n = s.export_csv(csv_path)
check("csv export includes deleted rows by default", n == 3, n)
n = s.export_csv(csv_path, include_deleted=False)
check("csv can exclude deleted rows", n == 2, n)
s.restore(3)
s.close()

# =========================================================================
print("\n--- refusing to run when something is wrong ---")

# 1. database newer than the code
d2 = fresh_dir()
s = Store(d2 / "books.db", d2 / "backups")
s._conn.execute("PRAGMA user_version = 999")
s.close()
try:
    Store(d2 / "books.db", d2 / "backups")
    check("newer database is refused", False, "no error raised")
except MigrationError as exc:
    check("newer database is refused", "999" in str(exc))

# 2. an applied migration was edited after the fact
d3 = fresh_dir()
s = Store(d3 / "books.db", d3 / "backups")
s._conn.execute("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1")
s.close()
try:
    Store(d3 / "books.db", d3 / "backups")
    check("edited migration is detected", False, "no error raised")
except MigrationError as exc:
    check("edited migration is detected", "frozen" in str(exc).lower(), str(exc)[:70])

# 3. the database has a migration this code does not know about
d4 = fresh_dir()
s = Store(d4 / "books.db", d4 / "backups")
s._conn.execute(
    "INSERT INTO schema_migrations VALUES (99, 'from_the_future', 'x', 'now')"
)
s._conn.execute("PRAGMA user_version = 2")
s.close()
try:
    Store(d4 / "books.db", d4 / "backups")
    check("unknown applied migration is detected", False, "no error raised")
except MigrationError as exc:
    check("unknown applied migration is detected", "does not know" in str(exc))

# 4. a file that is not a database at all
d5 = fresh_dir()
(d5 / "books.db").write_bytes(b"this is definitely not a sqlite database" * 40)
try:
    Store(d5 / "books.db", d5 / "backups")
    check("garbage file is refused", False, "no error raised")
except MigrationError as exc:
    check("garbage file is refused", "could not be read" in str(exc), str(exc)[:60])

# =========================================================================
print("\n--- the destructive guard ---")
for sql, label in [
    ("DROP TABLE books", "DROP TABLE"),
    ("DELETE FROM books WHERE id > 0", "DELETE FROM"),
    ("ALTER TABLE books DROP COLUMN notes", "DROP COLUMN"),
    ("ALTER TABLE books RENAME TO old_books", "RENAME"),
]:
    try:
        Migration(version=9, name="bad", statements=(sql,)).guard()
        check(f"guard blocks {label}", False, "allowed it")
    except MigrationError:
        check(f"guard blocks {label}", True)

try:
    Migration(version=9, name="ok", statements=("DROP TABLE books",),
              allow_destructive=True).guard()
    check("guard can be opted out of deliberately", True)
except MigrationError:
    check("guard can be opted out of deliberately", False)

check("additive statements pass the guard",
      Migration(version=9, name="add",
                statements=("ALTER TABLE books ADD COLUMN x TEXT",)).guard() is None)

# =========================================================================
print("\n--- a migration that fails partway ---")
d6 = fresh_dir()
db6 = d6 / "books.db"
s = Store(db6, d6 / "backups")
s.add_book({"isbn13": "9780547928227", "title": "The Hobbit",
            "authors": "J.R.R. Tolkien", "notes": "must survive"})
before_version = s.schema_version
s.close()

original = mig.MIGRATIONS
broken = Migration(
    version=mig.latest_version() + 1,
    name="deliberately_broken",
    statements=(
        "ALTER TABLE books ADD COLUMN good_column TEXT",
        "ALTER TABLE books ADD COLUMN bad_column NOT A REAL TYPE $$$",
    ),
)
mig.MIGRATIONS = original + (broken,)
try:
    Store(db6, d6 / "backups")
    check("broken migration raises", False, "no error raised")
except MigrationError as exc:
    check("broken migration raises", True)
    check("error says it rolled back", "rolled back" in str(exc), str(exc)[:80])
finally:
    mig.MIGRATIONS = original

s = Store(db6, d6 / "backups")
check("version unchanged after failed migration",
      s.schema_version == before_version, s.schema_version)
check("data survived the failed migration", s.count() == 1, s.count())
check("row content survived", s.get(1)["notes"] == "must survive")
cols = {r["name"] for r in s._conn.execute("PRAGMA table_info(books)")}
check("partial migration was fully rolled back", "good_column" not in cols, cols)
s.close()

# =========================================================================
print("\n--- durability settings ---")
d7 = fresh_dir()
s = Store(d7 / "books.db", d7 / "backups")
mode = s._conn.execute("PRAGMA journal_mode").fetchone()[0]
sync = s._conn.execute("PRAGMA synchronous").fetchone()[0]
check("WAL journal mode", mode.lower() == "wal", mode)
check("synchronous FULL", int(sync) == 2, sync)

# an accepted book must be on disk immediately, not buffered
s.add_book({"isbn13": "9781234567897", "title": "Durable"})
peek = sqlite3.connect(str(d7 / "books.db"))
found = peek.execute("SELECT COUNT(*) FROM books").fetchone()[0]
peek.close()
check("insert is visible to another connection at once", found == 1, found)

manual = s.backup_now("manual")
check("manual backup works", manual.exists(), manual.name)
s.close()

check("closing checkpoints the WAL",
      not (d7 / "books.db-wal").exists() or (d7 / "books.db-wal").stat().st_size == 0)

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
