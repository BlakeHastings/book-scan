"""OCR, real EAN-13 decoding, the recognize() pipeline, and the lookups.

Run with:  uv run tests/test_recognition.py
"""
import sys, io, tempfile

import numpy as np, cv2
from PIL import Image
from pathlib import Path

from bookscan.config import Settings
from bookscan import recognize as rec
from bookscan.lookup import lookup_isbn, search_title, _from_open_library_search

s = Settings()
ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


# --- Tesseract discovery (installed but not on this shell's PATH) ---------
avail, msg = rec.configure_tesseract(s)
check("tesseract found without PATH", avail, msg)

# --- Build a synthetic front cover and OCR the title ---------------------
front = np.full((900, 620, 3), 245, np.uint8)
cv2.putText(front, "THE HOBBIT", (55, 240), cv2.FONT_HERSHEY_SIMPLEX,
            1.9, (15, 15, 15), 5)
cv2.putText(front, "A NOVEL", (200, 330), cv2.FONT_HERSHEY_SIMPLEX,
            0.7, (90, 90, 90), 2)
cv2.putText(front, "J R R Tolkien", (150, 800), cv2.FONT_HERSHEY_SIMPLEX,
            0.85, (40, 40, 40), 2)

title = rec.ocr_title_guess(front)
check("OCR reads the cover title", "HOBBIT" in title.upper(), repr(title))
check("OCR skips the 'A NOVEL' noise line", title.strip().upper() != "A NOVEL", repr(title))

# --- Generate a real ISBN barcode and decode it --------------------------
import barcode
from barcode.writer import ImageWriter

ISBN13 = "9780547928227"          # The Hobbit
ean = barcode.get("ean13", ISBN13[:12], writer=ImageWriter())
buf = io.BytesIO()
ean.write(buf, options={"module_height": 14.0, "quiet_zone": 6.5, "dpi": 300})
buf.seek(0)
bc = cv2.cvtColor(np.array(Image.open(buf).convert("RGB")), cv2.COLOR_RGB2BGR)
check("barcode image generated", bc.shape[0] > 50, bc.shape)

codes = rec.decode_barcodes(bc)
check("pyzbar decodes the EAN-13", ISBN13 in codes, codes)

# Paste it onto a realistic back cover, smaller and off to one side
back = np.full((900, 620, 3), 238, np.uint8)
cv2.putText(back, "Praise for this edition...", (40, 120),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 60), 1)
bh, bw = bc.shape[:2]
scale = 300.0 / bw
bc_small = cv2.resize(bc, (300, int(bh * scale)), interpolation=cv2.INTER_AREA)
sh_, sw_ = bc_small.shape[:2]
back[900 - sh_ - 40:900 - 40, 620 - sw_ - 40:620 - 40] = bc_small
cv2.putText(back, f"ISBN 978-0-547-92822-7", (40, 700),
            cv2.FONT_HERSHEY_SIMPLEX, 0.62, (20, 20, 20), 2)

check("decodes from a full back cover", ISBN13 in rec.decode_barcodes(back),
      rec.decode_barcodes(back))

# --- Full recognize() pipeline -------------------------------------------
r = rec.recognize(front, back, s)
check("recognize gets ISBN-13", r.isbn13 == ISBN13, r.isbn13)
check("recognize prefers barcode", r.isbn_source == "barcode", r.isbn_source)
check("recognize derives ISBN-10", rec.valid_isbn10(r.isbn10), r.isbn10)
check("recognize guesses a title", "HOBBIT" in r.title_guess.upper(), repr(r.title_guess))

# --- OCR fallback: same back cover with the barcode painted out ----------
no_bc = back.copy()
no_bc[900 - sh_ - 40:900 - 40, 620 - sw_ - 40:620 - 40] = 238
check("barcode really removed", not rec.decode_barcodes(no_bc))
r2 = rec.recognize(front, no_bc, s)
check("OCR fallback finds printed ISBN", r2.isbn13 == ISBN13, f"{r2.isbn13} src={r2.isbn_source}")
check("OCR fallback marked as ocr", r2.isbn_source == "ocr", r2.isbn_source)

# --- Lookup: title search must no longer depend on Google ----------------
ols = _from_open_library_search("The Hobbit", 10.0)
check("Open Library title search works", ols is not None and ols.found,
      f"{ols.title!r} / {ols.authors}" if ols else None)

r3 = search_title("The Hobbit", 10.0)
check("search_title fallback works under Google 429", r3.found,
      f"{r3.title!r} / {r3.authors} / {r3.source}")
check("search_title warns it was title-matched",
      any("verify" in n.lower() for n in r3.notes), r3.notes)

r4 = lookup_isbn(ISBN13, 10.0)
check("ISBN lookup still fine", r4.found, f"{r4.title!r} / {r4.source}")

# rate limiting must not crash anything
r5 = search_title("zzzqqq not a real book title xyzzy", 10.0)
check("no-match title handled cleanly", not r5.found, r5.notes)

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
