"""ISBN maths, tolerant ISBN parsing, the catalogue, and the online lookups.

No camera and no GUI. Run with:  uv run tests/test_core.py
"""
import sys
import tempfile
from pathlib import Path

from bookscan import recognize as rec
from bookscan.lookup import lookup_isbn, search_title
from bookscan.store import Store

ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


# --- ISBN maths -----------------------------------------------------------
print("--- ISBN validation and conversion ---")
check("isbn13 valid", rec.valid_isbn13("9780306406157"))
check("isbn13 invalid", not rec.valid_isbn13("9780306406158"))
check("isbn10 valid", rec.valid_isbn10("0306406152"))
check("isbn10 X checkdigit", rec.valid_isbn10("043942089X"))
check("10->13", rec.isbn10_to_13("0306406152") == "9780306406157",
      rec.isbn10_to_13("0306406152"))
check("13->10", rec.isbn13_to_10("9780306406157") == "0306406152",
      rec.isbn13_to_10("9780306406157"))

# --- What the operator types, or a USB scanner sends ---------------------
print("\n--- normalise_isbn, for typed and scanned input ---")
for raw, expect in [
    ("9780547928227", "9780547928227"),
    ("978-0-547-92822-7", "9780547928227"),
    ("978 0 547 92822 7", "9780547928227"),
    ("  9780547928227\r\n", "9780547928227"),
    ("054792822X", "9780547928227"),
    ("0-306-40615-2", "9780306406157"),
]:
    got13, got10 = rec.normalise_isbn(raw)
    check(f"normalise {raw!r}", got13 == expect, got13)

check("rejects a wrong check digit", rec.normalise_isbn("9780547928228") == ("", ""))
check("rejects junk", rec.normalise_isbn("hello there") == ("", ""))
check("rejects an empty string", rec.normalise_isbn("") == ("", ""))
check("rejects a too-short number", rec.normalise_isbn("12345") == ("", ""))

# --- Pulling an ISBN out of mangled OCR text -----------------------------
print("\n--- extract_isbns tolerates OCR character confusion ---")
HOBBIT = "9780547928227"

cases = [
    ("clean labelled", "Some blurb here.\nISBN 978-0-547-92822-7\nPrinted in USA", HOBBIT),
    ("O for zero, B for eight, Z for two",
     "l5BN 97B-O-547-9282Z-7", HOBBIT),
    ("ISBN-13 prefix", "ISBN-13: 978-0-547-92822-7", HOBBIT),
    ("no separators", "ISBN 9780547928227", HOBBIT),
    ("unlabelled but valid 978",
     "blah blah\n9780547928227\n51299", HOBBIT),
    ("l for one in the label", "1SBN: 9780547928227", HOBBIT),
    ("surrounded by price addon",
     "ISBN 978-0-547-92822-7  51299>  9 780547 928227", HOBBIT),
]
for label, text, expect in cases:
    got13, got10, how = rec.extract_isbns(text)
    check(f"finds ISBN: {label}", got13 == expect, f"{got13!r} via {how}")

check("derives the ISBN-10 too",
      rec.extract_isbns("ISBN 978-0-547-92822-7")[1] == "054792822X",
      rec.extract_isbns("ISBN 978-0-547-92822-7")[1])

print("\n--- and does not invent one ---")
check("empty text", rec.extract_isbns("")[0] == "")
check("prose only", rec.extract_isbns(
    "A gripping tale of adventure and courage from the master.")[0] == "")
check("a bare wrong-checksum number is rejected",
      rec.extract_isbns("9780547928228")[0] == "", rec.extract_isbns("9780547928228"))
check("a bare ten digit number is NOT treated as an ISBN",
      rec.extract_isbns("Call us on 0306406152 today")[0] == "",
      rec.extract_isbns("Call us on 0306406152 today"))
check("a labelled ISBN-10 IS accepted",
      rec.extract_isbns("ISBN 0-306-40615-2")[0] == "9780306406157",
      rec.extract_isbns("ISBN 0-306-40615-2"))
check("a price code alone is rejected", rec.extract_isbns("51299")[0] == "")

# The bug that mattered most: the price code sits on the line below the
# ISBN. If the label pattern is allowed to span newlines it swallows those
# five digits, and sliding a window along the resulting eighteen digit run
# finds a different number with a valid check digit. That is a silently
# wrong ISBN, which is worse than finding none at all.
print("\n--- price code contamination must not invent an ISBN ---")
CONTAMINATED = [
    # A misread digit: 547 read as 647, so the true ISBN no longer validates.
    ("misread digit plus price code below", "ISBN978-0-647-92822-7\n\n51299\n"),
    ("misread prefix plus price code", "ISBN970-0-647-92822-7\n\nb1209\n"),
    ("misread digit, price code with letter", "1SBN978-6-547-92822-7\n\n61299\n"),
]
for label, text in CONTAMINATED:
    got13, _, how = rec.extract_isbns(text)
    check(f"no invented ISBN: {label}", got13 == "", f"{got13!r} via {how}")

check("a correct ISBN with the price code below is still found",
      rec.extract_isbns("ISBN 978-0-547-92822-7\n\n51299\n")[0] == HOBBIT,
      rec.extract_isbns("ISBN 978-0-547-92822-7\n\n51299\n"))
check("a correct ISBN with the price code alongside is still found",
      rec.extract_isbns("ISBN 978-0-547-92822-7   51299")[0] == HOBBIT,
      rec.extract_isbns("ISBN 978-0-547-92822-7   51299"))

# --- Catalogue ------------------------------------------------------------
print("\n--- the catalogue ---")
tmp = Path(tempfile.mkdtemp())
store = Store(tmp / "t.db", tmp / "backups")
bid = store.add_book({"isbn13": "9780306406157", "title": "Test Book",
                      "authors": "A. Author"})
check("insert returns id", bid == 1, bid)
check("count", store.count() == 1)
row = store.find_by_isbn("9780306406157")
check("duplicate lookup finds it", row is not None and row["title"] == "Test Book")
check("no false duplicate", store.find_by_isbn("9781234567897") is None)
n = store.export_csv(tmp / "t.csv")
check("csv export", n == 1 and (tmp / "t.csv").exists())
csv_text = (tmp / "t.csv").read_text(encoding="utf-8-sig")
check("csv has header and row", "isbn13" in csv_text and "Test Book" in csv_text)
store.close()

# --- Live lookup ----------------------------------------------------------
print("\n--- online lookup against real catalogues ---")
KNOWN = [
    ("9780547928227", "hobbit", "tolkien"),
    ("9780061120084", "mockingbird", "lee"),
    # Catalogued under its spelled-out title, not "1984".
    ("9780451524935", "eighty-four", "orwell"),
    ("9780743273565", "gatsby", "fitzgerald"),
]
for isbn, title_fragment, author_fragment in KNOWN:
    record = lookup_isbn(isbn, 12.0)
    good = (record.found
            and title_fragment in record.title.lower()
            and author_fragment in record.authors.lower())
    check(f"lookup {isbn}", good,
          f"{record.title!r} / {record.authors} / {record.source}")

record = lookup_isbn("9780547928227", 12.0)
check("lookup returns an author", bool(record.authors.strip()), record.authors)

r2 = lookup_isbn("9790000000001", 12.0)
check("unknown ISBN handled", not r2.found, r2.notes)
r3 = search_title("The Hobbit", 12.0)
check("title search fallback", r3.found, f"{r3.title!r} / {r3.authors}")

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
