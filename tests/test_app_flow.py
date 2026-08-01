"""Drives the real Tk app end to end: capture front, capture back, recognise,
review, save, retake, discard, export. Uses a temp database and temp capture
folder, so your real catalogue is never touched.

Run with:  uv run tests/test_app_flow.py
"""
import sys, io, time, tempfile, tkinter as tk

import numpy as np, cv2
from pathlib import Path
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

# Redirect storage away from the real project files.
appmod.DB_PATH = tmp / "test.db"
appmod.CAPTURE_DIR = tmp / "captures"

# No blocking dialogs during an automated run.
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

# --- Build the covers ----------------------------------------------------
ISBN13 = "9780547928227"
front = np.full((900, 620, 3), 245, np.uint8)
cv2.putText(front, "THE HOBBIT", (55, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.9, (15, 15, 15), 5)
cv2.putText(front, "J R R Tolkien", (150, 800), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (40, 40, 40), 2)

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

# --- Boot the app --------------------------------------------------------
root = tk.Tk()
root.withdraw()
try:
    app = appmod.BookScanApp(root)
except Exception as exc:
    print("FAIL app failed to construct:", exc)
    raise

check("app starts in WAIT_FRONT", app.state == "WAIT_FRONT", app.state)
check("review fields start disabled",
      str(app.entries["title"].cget("state")) == "disabled")
check("db starts empty", app.store.count() == 0)

small_f = app.detector.prepare(front)[0]
small_b = app.detector.prepare(back)[0]

# --- Capture the front ---------------------------------------------------
app._capture(front, small_f)
root.update()
check("front capture moves to WAIT_BACK", app.state == "WAIT_BACK", app.state)
check("front frame stored", app.front_frame is not None)
check("front thumbnail rendered", app._front_thumb is not None)

# --- Capture the back ----------------------------------------------------
app._capture(back, small_b)
root.update()
check("back capture starts processing", app.state == "PROCESSING", app.state)

# --- Wait for the worker -------------------------------------------------
deadline = time.time() + 45
while app.state == "PROCESSING" and time.time() < deadline:
    root.update()
    app._drain_results()
    time.sleep(0.05)

check("reaches REVIEW", app.state == "REVIEW", app.state)
check("review fields enabled",
      str(app.entries["title"].cget("state")) == "normal")
check("ISBN-13 populated", app.vars["isbn13"].get() == ISBN13, app.vars["isbn13"].get())
check("title populated", "hobbit" in app.vars["title"].get().lower(),
      repr(app.vars["title"].get()))
check("author populated", "tolkien" in app.vars["authors"].get().lower(),
      repr(app.vars["authors"].get()))
check("source line shown", "barcode" in app.source_label.cget("text").lower(),
      app.source_label.cget("text"))
check("no duplicate flagged yet", app.duplicate_of is None)

# --- Right arrow saves ---------------------------------------------------
saved_title = app.vars["title"].get()
app.accept()
root.update()
check("saved one book", app.store.count() == 1, app.store.count())
check("returns to WAIT_FRONT", app.state == "WAIT_FRONT", app.state)
check("fields cleared", app.vars["title"].get() == "")
check("thumbnails cleared", app._front_thumb is None and app._back_thumb is None)
check("counter label updated", "1 book" in app.count_label.cget("text"),
      app.count_label.cget("text"))

images = sorted((tmp / "captures").glob("*.jpg"))
check("both images written", len(images) == 2, [i.name for i in images])
check("images named by ISBN", all(ISBN13 in i.name for i in images))
check("images are readable", all(cv2.imread(str(i)) is not None for i in images))

# --- Duplicate detection on a second scan of the same book ---------------
app._capture(front, small_f)
app._capture(back, small_b)
deadline = time.time() + 45
while app.state == "PROCESSING" and time.time() < deadline:
    root.update()
    app._drain_results()
    time.sleep(0.05)
check("duplicate detected", app.duplicate_of == 1, app.duplicate_of)
check("duplicate warning shown", "already scanned" in app.warning_label.cget("text").lower(),
      app.warning_label.cget("text"))

# --- Retake paths --------------------------------------------------------
app.retake("front")
root.update()
check("retake front -> WAIT_FRONT", app.state == "WAIT_FRONT", app.state)
check("back kept on front retake", app.back_frame is not None)
app._capture(front, small_f)
root.update()
check("front-only retake goes straight to processing",
      app.state == "PROCESSING", app.state)
deadline = time.time() + 45
while app.state == "PROCESSING" and time.time() < deadline:
    root.update(); app._drain_results(); time.sleep(0.05)
check("front retake returns to REVIEW", app.state == "REVIEW", app.state)

app.retake("both")
root.update()
check("retake both clears slots",
      app.front_frame is None and app.back_frame is None and app.state == "WAIT_FRONT")

# --- Discard -------------------------------------------------------------
app._capture(front, small_f)
app.discard()
root.update()
check("discard resets", app.front_frame is None and app.state == "WAIT_FRONT")
check("discard saved nothing", app.store.count() == 1, app.store.count())

# --- Empty title is refused ---------------------------------------------
app._capture(front, small_f)
app._capture(back, small_b)
deadline = time.time() + 45
while app.state == "PROCESSING" and time.time() < deadline:
    root.update(); app._drain_results(); time.sleep(0.05)
app.vars["title"].set("")
before = app.store.count()
app.accept()
check("blank title refused", app.store.count() == before, app.store.count())
check("warned about the title", any(p[0] == "warn" for p in popups), popups[-1:])

# --- CSV export ----------------------------------------------------------
n = app.store.export_csv(tmp / "out.csv")
text = (tmp / "out.csv").read_text(encoding="utf-8-sig")
check("csv exported", n == 1 and saved_title.split()[0].lower() in text.lower(), n)

check("no unexpected error popups", not any(p[0] == "error" for p in popups),
      [p for p in popups if p[0] == "error"])

app.stream.close()
app.store.close()
root.destroy()

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
