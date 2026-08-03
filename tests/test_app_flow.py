"""Drives the real Tk app end to end: three captures, recognition, shelving
guidance, review, save, retake, discard, manual lookup, export.

Uses a temp database and temp capture folder, so your real catalogue is
never touched. Run with:  uv run tests/test_app_flow.py
"""
import sys, io, time, tempfile, tkinter as tk
from pathlib import Path

import numpy as np
import cv2
from PIL import Image

ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


tmp = Path(tempfile.mkdtemp())

import bookscan.app as appmod
from bookscan.store import Store

appmod.DB_PATH = tmp / "test.db"
appmod.CAPTURE_DIR = tmp / "captures"
appmod.BACKUP_DIR = tmp / "backups"

popups = []


class FakeBox:
    @staticmethod
    def showerror(t, m): popups.append(("error", t, m))
    @staticmethod
    def showwarning(t, m): popups.append(("warn", t, m))
    @staticmethod
    def showinfo(t, m): popups.append(("info", t, m))
    @staticmethod
    def askyesno(t, m): popups.append(("ask", t, m)); return True


appmod.messagebox = FakeBox

# --- Covers ---------------------------------------------------------------
ISBN13 = "9780547928227"
front = np.full((900, 620, 3), 245, np.uint8)
cv2.putText(front, "THE HOBBIT", (55, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.9,
            (15, 15, 15), 5)

import barcode
from barcode.writer import ImageWriter
buf = io.BytesIO()
barcode.get("ean13", ISBN13[:12], writer=ImageWriter()).write(
    buf, options={"module_height": 14.0, "quiet_zone": 6.5, "dpi": 300})
buf.seek(0)
bc = cv2.cvtColor(np.array(Image.open(buf).convert("RGB")), cv2.COLOR_RGB2BGR)
bh, bw = bc.shape[:2]
bc = cv2.resize(bc, (300, int(bh * 300.0 / bw)), interpolation=cv2.INTER_AREA)
back = np.full((900, 620, 3), 238, np.uint8)
sh_, sw_ = bc.shape[:2]
back[900 - sh_ - 40:900 - 40, 620 - sw_ - 40:620 - 40] = bc

spine = np.full((900, 160, 3), 210, np.uint8)
cv2.putText(spine, "HOBBIT", (18, 400), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
            (20, 20, 20), 2)

# --- Boot -----------------------------------------------------------------
root = tk.Tk()
root.withdraw()
app = appmod.BookScanApp(root)

check("starts in WAIT_FRONT", app.state == "WAIT_FRONT", app.state)
check("record fields start disabled",
      str(app.entries["title"].cget("state")) == "disabled")
check("db starts empty", app.store.count() == 0)
check("schema is at least v3", app.store.schema_version >= 3,
      app.store.schema_version)

# --- Three captures -------------------------------------------------------
app._capture(front)
root.update()
check("front capture moves to WAIT_BACK", app.state == "WAIT_BACK", app.state)
check("front thumbnail rendered", app._thumb_images["front"] is not None)

app._capture(back)
root.update()
check("back capture moves to WAIT_SPINE", app.state == "WAIT_SPINE", app.state)

app._capture(spine)
root.update()
check("spine capture starts processing", app.state == "PROCESSING", app.state)
check("spine thumbnail rendered", app._thumb_images["spine"] is not None)


def settle(timeout=45):
    deadline = time.time() + timeout
    while app.state == "PROCESSING" and time.time() < deadline:
        root.update()
        app._drain_results()
        time.sleep(0.05)


settle()
check("reaches REVIEW", app.state == "REVIEW", app.state)
check("ISBN populated", app.vars["isbn13"].get() == ISBN13,
      app.vars["isbn13"].get())
check("title populated", "hobbit" in app.vars["title"].get().lower(),
      app.vars["title"].get())
check("author populated", "tolkien" in app.vars["authors"].get().lower(),
      app.vars["authors"].get())
check("sort_author derived", app.vars["sort_author"].get() == "TOLKIEN",
      app.vars["sort_author"].get())
check("classified as fiction", app.fiction_var.get() is True)

# --- Placement on an empty shelf ------------------------------------------
check("placement computed", app.placement is not None)
check("first book on an empty shelf", app.placement.is_first)
check("suggests S1 for the first fiction book", app.shelf_var.get() == "S1",
      app.shelf_var.get())
check("headline says to start the shelf",
      "First book on S1" in app.place_headline.cget("text"),
      app.place_headline.cget("text"))
check("no neighbours yet",
      app.placement.previous is None and app.placement.following is None)

# --- Save with a shelf position -------------------------------------------
saved_title = app.vars["title"].get()
app.area_var.set("a")
before_popups = len(popups)
app.accept()
root.update()
check("saved one book", app.store.count() == 1, app.store.count())
check("no confirmation needed when a position is given",
      len(popups) == before_popups, popups[before_popups:])
check("returns to WAIT_FRONT", app.state == "WAIT_FRONT", app.state)
check("fields cleared", app.vars["title"].get() == "")
check("thumbnails cleared",
      all(v is None for v in app._thumb_images.values()))

row = app.store.get(1)
check("shelf stored", row["shelf"] == "S1", row["shelf"])
check("area stored upper-cased", row["area"] == "A", row["area"])
check("placed_at stamped", bool(row["placed_at"]), row["placed_at"])
check("sort_author stored", row["sort_author"] == "TOLKIEN")
check("is_fiction stored", row["is_fiction"] == 1, row["is_fiction"])
check("spine image path stored", bool(row["spine_image"]))
check("subjects stored", row["subjects"] is not None)

images = sorted((tmp / "captures").glob("*.jpg"))
check("three images written", len(images) == 3, [i.name for i in images])
check("one of them is the spine",
      any("_spine" in i.name for i in images), [i.name for i in images])
check("images are readable",
      all(cv2.imread(str(i)) is not None for i in images))
check("counter shows it as shelved", "1 shelved" in app.count_label.cget("text"),
      app.count_label.cget("text"))

# --- A second book, placed relative to the first --------------------------
app._capture(front)
app._capture(back)
app._capture(spine)
settle()
check("duplicate detected", app.duplicate_of == 1, app.duplicate_of)
check("duplicate warning names the shelf position",
      "S1-A" in app.warning_label.cget("text"),
      app.warning_label.cget("text"))

# Pretend this is a different author and re-plan.
app.vars["authors"].set("Douglas Adams")
app.vars["sort_author"].set("")
app.vars["title"].set("The Hitchhiker's Guide")
app.update_placement()
check("re-derives the surname from the author",
      app.vars["sort_author"].get() == "ADAMS", app.vars["sort_author"].get())
check("ADAMS sorts before TOLKIEN, so nothing precedes it",
      app.placement.previous is None)
check("points at the shelved Tolkien as the book it goes before",
      app.placement.following is not None
      and "hobbit" in app.placement.following["title"].lower(),
      app.placement.following["title"] if app.placement.following else None)
check("headline names the neighbour and where it is",
      "S1-A" in app.place_headline.cget("text"),
      app.place_headline.cget("text"))
check("neighbour spine photo loaded",
      app._neighbour_images["following"] is not None)
check("neighbour caption shows shelf and area",
      "S1 - A" in app.neighbour_captions["following"].cget("text"),
      app.neighbour_captions["following"].cget("text"))
check("inherits the neighbour's shelf", app.shelf_var.get() == "S1",
      app.shelf_var.get())

# Flipping to non-fiction must move it to S4.
app.fiction_var.set(False)
app.update_placement()
check("non-fiction re-routes to S4", app.shelf_var.get() == "S4",
      app.shelf_var.get())
check("non-fiction section has no neighbours yet",
      app.placement.previous is None and app.placement.following is None)
app.fiction_var.set(True)
app.update_placement()

# --- Saving without a position asks first ---------------------------------
app.area_var.set("")
before_popups = len(popups)
app.accept()
root.update()
check("asked before saving with no position",
      any(p[0] == "ask" and "No shelf position" in p[1]
          for p in popups[before_popups:]), popups[before_popups:])
check("saved anyway when confirmed", app.store.count() == 2, app.store.count())
unplaced = app.store.get(2)
check("no placed_at without an area", not (unplaced["placed_at"] or ""),
      unplaced["placed_at"])
check("unplaced book is not a landmark",
      all(r["id"] != 2 for r in app.store.placed_books()))

# --- Skipping the spine ---------------------------------------------------
app._capture(front)
app._capture(back)
check("waiting for the spine", app.state == "WAIT_SPINE", app.state)
app.skip_spine()
check("skipping the spine starts processing", app.state == "PROCESSING",
      app.state)
settle()
check("skipped spine still reaches REVIEW", app.state == "REVIEW", app.state)
check("no spine frame held", app.frames["spine"] is None)

# --- Retakes --------------------------------------------------------------
app.retake("spine")
check("retake spine returns to WAIT_SPINE", app.state == "WAIT_SPINE",
      app.state)
app._capture(spine)
settle()
check("re-capturing the spine reprocesses", app.state == "REVIEW", app.state)

app.retake("front")
check("retake front returns to WAIT_FRONT", app.state == "WAIT_FRONT",
      app.state)
check("back and spine kept",
      app.frames["back"] is not None and app.frames["spine"] is not None)
app._capture(front)
settle()
check("front retake goes straight back to REVIEW", app.state == "REVIEW",
      app.state)

app.retake("all")
check("retake all clears every slot",
      all(v is None for v in app.frames.values())
      and app.state == "WAIT_FRONT")

# --- Discard --------------------------------------------------------------
app._capture(front)
app.discard()
root.update()
check("discard resets", app.frames["front"] is None
      and app.state == "WAIT_FRONT")
check("discard saved nothing", app.store.count() == 2, app.store.count())

# --- Blank title is refused -----------------------------------------------
app._capture(front)
app._capture(back)
app.skip_spine()
settle()
app.vars["title"].set("")
before = app.store.count()
app.accept()
check("blank title refused", app.store.count() == before, app.store.count())
check("warned about the title",
      any(p[0] == "warn" and "Title" in p[1] for p in popups), popups[-1:])


# --- Typing an ISBN, or scanning one with a USB barcode scanner ----------
# A USB scanner is a keyboard: it types the digits then presses Enter, which
# is bound to lookup_now. This is the fallback when the camera cannot read
# the barcode, so it has to work.
def run_lookup(timeout=45):
    app.lookup_now()
    deadline = time.time() + timeout
    while app._busy and time.time() < deadline:
        root.update()
        app._drain_results()
        time.sleep(0.05)


app.vars["isbn13"].set("9780061120084")   # To Kill a Mockingbird
app.vars["title"].set("")
app.vars["authors"].set("")
run_lookup()
check("typed ISBN fills in the title",
      "mockingbird" in app.vars["title"].get().lower(), app.vars["title"].get())
check("typed ISBN fills in the author",
      "lee" in app.vars["authors"].get().lower(), app.vars["authors"].get())
check("typed ISBN sets the filing surname",
      app.vars["sort_author"].get() == "LEE", app.vars["sort_author"].get())
check("typed ISBN is kept as typed",
      app.vars["isbn13"].get() == "9780061120084", app.vars["isbn13"].get())
check("placement recomputed after a manual lookup",
      app.placement is not None and app.shelf_var.get() in ("S1", "S2", "S3"),
      app.shelf_var.get())

app.vars["isbn13"].set("978-0-7432-7356-5")   # The Great Gatsby
app.vars["title"].set("")
run_lookup()
check("hyphenated ISBN works",
      "gatsby" in app.vars["title"].get().lower(), app.vars["title"].get())
check("hyphenated ISBN is normalised in the field",
      app.vars["isbn13"].get() == "9780743273565", app.vars["isbn13"].get())

app.vars["isbn13"].set("")
app.vars["isbn10"].set("0306406152")
app.vars["title"].set("")
run_lookup()
check("ISBN-10 input is converted and looked up",
      app.vars["isbn13"].get() == "9780306406157", app.vars["isbn13"].get())

app.vars["isbn13"].set("1234567890123")
app.lookup_now()
check("invalid ISBN is refused",
      "not a valid ISBN" in app.warning_label.cget("text"),
      app.warning_label.cget("text"))
check("invalid ISBN starts no lookup", not app._busy)

app.vars["isbn13"].set("")
app.vars["isbn10"].set("")
app.vars["title"].set("The Hobbit")
run_lookup()
check("title-only lookup works",
      "hobbit" in app.vars["title"].get().lower(), app.vars["title"].get())

app.vars["isbn13"].set("")
app.vars["isbn10"].set("")
app.vars["title"].set("")
app.lookup_now()
check("empty lookup is refused politely",
      "Type an ISBN" in app.warning_label.cget("text"),
      app.warning_label.cget("text"))

# --- Diagnostics and export ----------------------------------------------
window_count = len(root.winfo_children())
app.show_diagnostics()
root.update()
check("diagnostics window opens", len(root.winfo_children()) > window_count)
for child in root.winfo_children():
    if isinstance(child, tk.Toplevel):
        child.destroy()

n = app.store.export_csv(tmp / "out.csv")
text = (tmp / "out.csv").read_text(encoding="utf-8-sig")
check("csv exported", n == 2, n)
check("csv carries the shelf columns",
      "shelf" in text and "area" in text and "S1" in text)
check("csv carries the filing surname", "sort_author" in text and "TOLKIEN" in text)

check("no unexpected error popups", not any(p[0] == "error" for p in popups),
      [p for p in popups if p[0] == "error"])

app.stream.close()
app.store.close()
root.destroy()

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
