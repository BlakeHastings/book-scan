"""ISBN maths, book detection, the auto-capture shutter, and the catalogue.

No camera and no GUI. Run with:  uv run tests/test_core.py
"""
import sys

import numpy as np
import cv2

from bookscan.config import Settings
from bookscan.detect import BookDetector, ShutterController
from bookscan import recognize as rec
from bookscan.lookup import lookup_isbn, search_title
from bookscan.store import Store
from pathlib import Path
import tempfile

s = Settings()
ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


# --- ISBN maths -----------------------------------------------------------
check("isbn13 valid", rec.valid_isbn13("9780306406157"))
check("isbn13 invalid", not rec.valid_isbn13("9780306406158"))
check("isbn10 valid", rec.valid_isbn10("0306406152"))
check("isbn10 X checkdigit", rec.valid_isbn10("043942089X"))
check("10->13", rec.isbn10_to_13("0306406152") == "9780306406157",
      rec.isbn10_to_13("0306406152"))
check("13->10", rec.isbn13_to_10("9780306406157") == "0306406152",
      rec.isbn13_to_10("9780306406157"))

# --- Detection on a synthetic "book held up" ------------------------------
det = BookDetector(s)
frame = np.full((720, 1280, 3), 40, np.uint8)
cv2.randu(frame, 20, 70)                      # textured background
cv2.rectangle(frame, (430, 90), (830, 650), (235, 235, 235), -1)   # the book
cv2.putText(frame, "THE HOBBIT", (455, 300), cv2.FONT_HERSHEY_SIMPLEX,
            1.6, (10, 10, 10), 5)
small, scale = det.prepare(frame)
check("prepare downscales", small.shape[1] == s.detect_width, small.shape)
d = det.detect(small)
check("detects the book", d is not None)
if d:
    check("area ratio sane", 0.10 < d.area_ratio < 0.92, round(d.area_ratio, 3))
    check("aspect sane", 0.35 < d.aspect < 1.7, round(d.aspect, 3))
    check("centre near middle", abs(d.center[0] - 0.49) < 0.08, d.center)

# empty scene must not detect
empty = np.full((720, 1280, 3), 40, np.uint8)
cv2.randu(empty, 20, 70)
check("no false positive on noise", det.detect(det.prepare(empty)[0]) is None)

# --- Shutter: fires only after holding still ------------------------------
sh = ShutterController(s)
t = 100.0
fired_at = None
for i in range(40):
    t += 0.033
    st = sh.update(d, small, t)
    if st.fire:
        fired_at = i
        break
check("shutter fires when still", fired_at is not None, f"frame {fired_at}")
check("shutter waits >= stable_frames", fired_at is not None and fired_at >= s.stable_frames - 1, fired_at)

# after capture it must disarm
sh.notify_captured(small, t)
st = sh.update(d, small, t + 0.1)
check("disarms after capture", not st.fire and st.status == "changed", st.status)

# same scene should NOT re-arm
for i in range(30):
    t += 0.033
    st = sh.update(d, small, t)
check("stays disarmed on unchanged scene", not st.fire, st.status)

# flipping to a different cover should re-arm then fire
back = small.copy()
cv2.rectangle(back, (215, 45), (415, 325), (60, 60, 160), -1)
d2 = det.detect(back)
fired2 = None
for i in range(60):
    t += 0.033
    st = sh.update(d2, back, t)
    if st.fire:
        fired2 = i
        break
check("re-arms and fires on the back cover", fired2 is not None, f"frame {fired2}")

# blur must block capture
sh2 = ShutterController(s)
blurred = cv2.GaussianBlur(small, (31, 31), 0)
db = det.detect(blurred)
t = 200.0
blur_fired = False
for i in range(40):
    t += 0.033
    st = sh2.update(db, blurred, t)
    if st.fire:
        blur_fired = True
check("blurry frames rejected", not blur_fired)

# --- Barcode decode on a generated EAN-13 ---------------------------------
check("zbar available", rec.ZBAR_AVAILABLE, rec.ZBAR_ERROR)

# --- Store ----------------------------------------------------------------
tmp = Path(tempfile.mkdtemp())
st_db = Store(tmp / "t.db")
bid = st_db.add_book({"isbn13": "9780306406157", "title": "Test Book",
                      "authors": "A. Author"})
check("insert returns id", bid == 1, bid)
check("count", st_db.count() == 1)
row = st_db.find_by_isbn("9780306406157")
check("duplicate lookup finds it", row is not None and row["title"] == "Test Book")
check("no false duplicate", st_db.find_by_isbn("9781234567897") is None)
n = st_db.export_csv(tmp / "t.csv")
check("csv export", n == 1 and (tmp / "t.csv").exists())
csv_text = (tmp / "t.csv").read_text(encoding="utf-8-sig")
check("csv has header and row", "isbn13" in csv_text and "Test Book" in csv_text)
st_db.close()

# --- Live lookup ----------------------------------------------------------
r = lookup_isbn("9780547928227", 10.0)   # The Hobbit
check("online ISBN lookup", r.found, f"{r.title!r} / {r.authors} / {r.source}")
r2 = lookup_isbn("9790000000001", 10.0)  # nonsense
check("unknown ISBN handled", not r2.found, r2.notes)
r3 = search_title("The Hobbit", 10.0)
check("title search fallback", r3.found, f"{r3.title!r} / {r3.authors}")

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
