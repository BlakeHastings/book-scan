"""Filing rules: surnames, fiction classification, ordering, and placement.

Run with:  uv run tests/test_shelving.py
"""
import sys
import tempfile
from pathlib import Path

from bookscan.shelving import (
    author_sort_name,
    first_author,
    guess_fiction,
    plan_placement,
    row_sort_key,
    series_position,
    sort_key,
)
from bookscan.store import Store

FICTION = ("S1", "S2", "S3")
NONFICTION = ("S4",)

ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


# --- Surnames -------------------------------------------------------------
print("--- filing surnames ---")
for credit, expect in [
    ("J.R.R. Tolkien", "TOLKIEN"),
    ("Tolkien, J.R.R.", "TOLKIEN"),
    ("Ursula K. Le Guin", "LE GUIN"),
    ("Le Guin, Ursula K.", "LE GUIN"),
    ("Ludwig van Beethoven", "VAN BEETHOVEN"),
    ("Cornelius van der Meer", "VAN DER MEER"),
    ("Honore de Balzac", "DE BALZAC"),
    ("Martin Luther King Jr.", "KING"),
    ("Dr. Seuss", "SEUSS"),
    ("Homer", "HOMER"),
    ("Jose Saramago", "SARAMAGO"),
    ("José Saramago", "SARAMAGO"),
    ("Mary Wollstonecraft Shelley", "SHELLEY"),
    ("", ""),
    ("   ", ""),
]:
    got = author_sort_name(credit)
    check(f"{credit!r} files under {expect!r}", got == expect, got)

print("\n--- multiple authors file under the first ---")
for credit, expect in [
    ("Neil Gaiman, Terry Pratchett", "GAIMAN"),
    ("Neil Gaiman & Terry Pratchett", "GAIMAN"),
    ("Neil Gaiman and Terry Pratchett", "GAIMAN"),
    ("Neil Gaiman; Terry Pratchett", "GAIMAN"),
]:
    got = author_sort_name(credit)
    check(f"{credit!r} -> {expect}", got == expect, got)

check("first_author keeps a sorted-form credit together",
      first_author("Tolkien, J.R.R.") == "Tolkien, J.R.R.",
      first_author("Tolkien, J.R.R."))

# --- Fiction guess --------------------------------------------------------
print("\n--- fiction or not ---")
for subjects, expect in [
    ("Fiction / Fantasy / Epic", True),
    ("Juvenile Fiction", True),
    ("Science fiction", True),
    ("Fantasy fiction, English", True),
    ("Detective and mystery stories", True),
    ("Biography & Autobiography", False),
    ("History, World War, 1939-1945", False),
    ("Cooking, Italian", False),
    ("Non-fiction", False),
    ("Nonfiction", False),
    ("Business & Economics", False),
    ("Self-help", False),
    ("", True),                      # nothing to go on, assume fiction
    ("Unclassifiable nonsense", True),
]:
    got = guess_fiction(subjects)
    check(f"{subjects!r} -> {'fiction' if expect else 'non-fiction'}",
          got == expect, got)

# --- Ordering -------------------------------------------------------------
print("\n--- ordering ---")
check("series position parses a number", series_position("3") == 3.0)
check("series position parses 'Book 2'", series_position("Book 2") == 2.0)
check("series position handles halves", series_position("4.5") == 4.5)
check("series position of nothing is zero", series_position("") == 0.0)

check("10 sorts after 2 within a series",
      sort_key("X", "S", "2", "b") < sort_key("X", "S", "10", "a"))
check("standalones sort before that author's series",
      sort_key("TOLKIEN", "", "", "The Hobbit")
      < sort_key("TOLKIEN", "The Lord of the Rings", "1", "Fellowship"))
check("authors sort before series matters",
      sort_key("ADAMS", "Z", "9", "z") < sort_key("AUSTEN", "", "", "a"))

# --- Placement ------------------------------------------------------------
print("\n--- placement against a real shelf ---")
tmp = Path(tempfile.mkdtemp())
store = Store(tmp / "books.db", tmp / "backups")


def shelve(author, title, shelf, area, series="", number="", fiction=1):
    return store.add_book({
        "title": title, "authors": author,
        "sort_author": author_sort_name(author),
        "series": series, "series_number": number,
        "shelf": shelf, "area": area, "is_fiction": fiction,
        "placed_at": "2026-08-01T10:00:00",
    })


shelve("Douglas Adams", "The Hitchhiker's Guide", "S1", "A")
shelve("Jane Austen", "Emma", "S1", "B")
shelve("J.R.R. Tolkien", "The Hobbit", "S2", "B")
shelve("J.R.R. Tolkien", "The Fellowship of the Ring", "S2", "C",
       "The Lord of the Rings", "1")
shelve("J.R.R. Tolkien", "The Two Towers", "S2", "C",
       "The Lord of the Rings", "2")
# Catalogued but never shelved, so it must not be used as a landmark.
store.add_book({"title": "Unshelved Book", "authors": "Bill Bryson",
                "sort_author": "BRYSON", "is_fiction": 1})

placed = store.placed_books(FICTION)
check("only shelved books are landmarks", len(placed) == 5, len(placed))
check("the unshelved book is excluded",
      all(r["title"] != "Unshelved Book" for r in placed))


def place(author, title, series="", number="", fiction=True):
    shelves = FICTION if fiction else NONFICTION
    key = sort_key(author_sort_name(author), series, number, title)
    return plan_placement(store.placed_books(shelves), key, fiction,
                          FICTION, NONFICTION)


# Next book in an existing series, at the end.
p = place("J.R.R. Tolkien", "The Return of the King",
          "The Lord of the Rings", "3")
check("series book follows the previous volume",
      p.previous is not None and p.previous["title"] == "The Two Towers",
      p.previous["title"] if p.previous else None)
check("series book is last, so nothing follows", p.following is None)
check("inherits the shelf of its neighbour", p.shelf == "S2", p.shelf)
check("not flagged as a boundary", not p.at_boundary)

# Middle of an existing series.
p = place("J.R.R. Tolkien", "The Two Towers", "The Lord of the Rings", "1.5")
check("mid-series lands between the right two volumes",
      p.previous["title"] == "The Fellowship of the Ring"
      and p.following["title"] == "The Two Towers",
      (p.previous["title"], p.following["title"]))

# A new author landing between two shelves.
p = place("Ray Bradbury", "Fahrenheit 451")
check("new author sits between Austen and Tolkien",
      p.previous["title"] == "Emma" and p.following["title"] == "The Hobbit",
      (p.previous["title"], p.following["title"]))
check("straddling two shelves is flagged", p.at_boundary, p.at_boundary)
check("suggests the earlier shelf at a boundary", p.shelf == "S1", p.shelf)

# Before everything. ACHEBE sorts ahead of ADAMS.
p = place("Chinua Achebe", "Things Fall Apart")
check("sorting first has nothing before it", p.previous is None,
      p.previous["title"] if p.previous else None)
check("sorting first points at the current first book",
      p.following["title"] == "The Hitchhiker's Guide",
      p.following["title"])
check("takes the shelf of the book it precedes", p.shelf == "S1", p.shelf)

# After everything.
p = place("Virginia Woolf", "Orlando")
check("sorting last has nothing after it", p.following is None)
check("sorting last follows the final book",
      p.previous["title"] == "The Two Towers", p.previous["title"])

# An author's standalone goes before their series.
p = place("J.R.R. Tolkien", "The Silmarillion")
check("standalone files before the author's series",
      p.previous["title"] == "The Hobbit"
      and p.following["title"] == "The Fellowship of the Ring",
      (p.previous["title"], p.following["title"]))

# Non-fiction goes to its own shelf, and starts empty.
p = place("Bill Bryson", "A Short History of Nearly Everything",
          fiction=False)
check("non-fiction is routed to S4", p.shelf == "S4", p.shelf)
check("non-fiction section is empty so it is the first", p.is_first)
check("non-fiction has no neighbours yet",
      p.previous is None and p.following is None)
check("non-fiction section is named", p.section == "non-fiction", p.section)
check("headline tells you to start the shelf",
      "First book on S4" in p.headline, p.headline)

# Once one non-fiction book is shelved, the next finds it.
shelve("Bill Bryson", "A Short History of Nearly Everything", "S4", "A",
       fiction=0)
p = place("Mary Roach", "Stiff", fiction=False)
check("second non-fiction book finds the first",
      p.previous is not None and p.previous["title"].startswith("A Short"),
      p.previous["title"] if p.previous else None)
check("second non-fiction book stays on S4", p.shelf == "S4", p.shelf)
check("fiction shelves are not consulted for non-fiction",
      p.following is None, p.following["title"] if p.following else None)

# Headlines read sensibly.
p = place("Ray Bradbury", "Fahrenheit 451")
check("headline names both neighbours and where they are",
      "Emma" in p.headline and "The Hobbit" in p.headline
      and "S1-B" in p.headline and "S2-B" in p.headline, p.headline)

check("row_sort_key falls back to the author when sort_author is blank",
      row_sort_key({"sort_author": "", "authors": "Ray Bradbury",
                    "series": "", "series_number": "", "title": "X"})[0]
      == "BRADBURY")

store.close()

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
