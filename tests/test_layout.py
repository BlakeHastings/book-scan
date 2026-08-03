"""Guards against panes growing without bound.

Rendering a frame, filling a capture slot, or loading a neighbour's spine
photo must never change the size the window asks for. If it does, each
update is drawn slightly larger than the last and the layout walks off the
screen. Run with:  uv run tests/test_layout.py
"""
import sys, time, tempfile, tkinter as tk
from pathlib import Path

import numpy as np
import cv2

ok = True


def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name + ("  " + str(extra) if extra else ""))
    if not cond:
        ok = False


tmp = Path(tempfile.mkdtemp())

import bookscan.app as appmod

appmod.DB_PATH = tmp / "test.db"
appmod.CAPTURE_DIR = tmp / "captures"
appmod.BACKUP_DIR = tmp / "backups"


class FakeBox:
    @staticmethod
    def showerror(t, m): pass
    @staticmethod
    def showwarning(t, m): pass
    @staticmethod
    def showinfo(t, m): pass
    @staticmethod
    def askyesno(t, m): return True


appmod.messagebox = FakeBox

# A normal 1080p webcam frame with something book-shaped in it.
frame = np.full((1080, 1920, 3), 40, np.uint8)
cv2.randu(frame, 20, 70)
cv2.rectangle(frame, (700, 120), (1220, 960), (235, 235, 235), -1)
cv2.putText(frame, "THE HOBBIT", (730, 420), cv2.FONT_HERSHEY_SIMPLEX,
            1.6, (10, 10, 10), 5)

# A spine photo on disk, for the neighbour panel.
spine_path = tmp / "spine.jpg"
spine = np.full((900, 160, 3), 200, np.uint8)
cv2.putText(spine, "HOBBIT", (14, 400), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
            (20, 20, 20), 2)
cv2.imwrite(str(spine_path), spine)

root = tk.Tk()
app = appmod.BookScanApp(root)
app.stream.read = lambda: frame.copy()

root.update()
start_geom = (root.winfo_width(), root.winfo_height())
check("window opens at its configured size",
      start_geom == (1560, 1000), start_geom)


def sample(iterations=70):
    seen = []
    for _ in range(iterations):
        root.update()
        time.sleep(0.008)
        seen.append((
            root.winfo_width(), root.winfo_height(),
            root.winfo_reqwidth(), root.winfo_reqheight(),
        ))
    return seen


# --- The core regression: many frames rendered, size must not drift ------
seen = sample()
settled = seen[10:]
check("preview actually rendered", app._preview_image is not None)
check("window size stable across 70 frames", len(set(settled)) == 1,
      f"first={settled[0]} last={settled[-1]} distinct={len(set(settled))}")
check("window never grew",
      seen[-1][0] <= start_geom[0] and seen[-1][1] <= start_geom[1],
      f"{start_geom} -> {seen[-1][:2]}")
check("requested size fits inside the window",
      seen[-1][2] <= start_geom[0] and seen[-1][3] <= start_geom[1],
      f"requested {seen[-1][2]}x{seen[-1][3]}")

# --- Empty capture slots must not be sized in characters -----------------
for slot in ("front", "back", "spine"):
    holder = app.thumb_labels[slot].master
    width, height = holder.winfo_width(), holder.winfo_height()
    check(f"empty {slot} slot is pixel sized", 120 < width < 400,
          f"{width}x{height}")

# --- Neighbour slots too -------------------------------------------------
for side in ("previous", "following"):
    holder = app.neighbour_labels[side].master
    check(f"empty {side} neighbour slot is pixel sized",
          120 < holder.winfo_width() < 400,
          f"{holder.winfo_width()}x{holder.winfo_height()}")

# --- Filling the capture slots must not resize anything ------------------
before = (root.winfo_width(), root.winfo_height())
app._capture(frame)
root.update()
after_front = sample(20)[-1][:2]
check("capturing the front does not resize the window",
      after_front == before, f"{before} -> {after_front}")

app._capture(frame)
root.update()
after_back = sample(20)[-1][:2]
check("capturing the back does not resize the window",
      after_back == before, f"{before} -> {after_back}")

app._capture(frame)
root.update()
after_spine = sample(20)[-1][:2]
check("capturing the spine does not resize the window",
      after_spine == before, f"{before} -> {after_spine}")

# --- A neighbour spine photo must not resize anything --------------------
neighbour = {
    "title": "The Hobbit", "authors": "J.R.R. Tolkien",
    "sort_author": "TOLKIEN", "shelf": "S1", "area": "A",
    "spine_image": str(spine_path), "front_image": "",
}
app._set_neighbour("previous", neighbour)
app._set_neighbour("following", neighbour)
root.update()
check("neighbour spine photo loaded",
      app._neighbour_images["previous"] is not None)
after_neighbour = sample(20)[-1][:2]
check("showing neighbour spines does not resize the window",
      after_neighbour == before, f"{before} -> {after_neighbour}")

# A very long title must wrap rather than stretch the panel.
long_neighbour = dict(neighbour, title="A Truly Preposterously Long Book "
                                        "Title That Goes On And On Forever")
app._set_neighbour("following", long_neighbour)
root.update()
after_long = sample(20)[-1][:2]
check("a long neighbour title does not stretch the panel",
      after_long == before, f"{before} -> {after_long}")

# A neighbour with no photo at all.
app._set_neighbour("following", {"title": "No Photo", "authors": "X",
                                 "sort_author": "X", "shelf": "S2",
                                 "area": "C"})
root.update()
after_missing = sample(15)[-1][:2]
check("a neighbour with no photo does not resize the window",
      after_missing == before, f"{before} -> {after_missing}")

# --- The no-camera placeholder -------------------------------------------
app.stream.read = lambda: None
app.camera_error = (
    "Camera 0 could not be opened. It may be unplugged, in use by another "
    "program, blocked by Windows camera privacy settings, or a virtual "
    "device that has no feed."
)
after_placeholder = sample(25)[-1][:2]
check("long placeholder message does not resize the window",
      after_placeholder == before, f"{before} -> {after_placeholder}")

# --- Resizing smaller must be respected ----------------------------------
root.geometry("1350x920")
root.update()
shrunk = sample(25)[-1][:2]
check("window can be resized smaller and stays there",
      shrunk == (1350, 920), shrunk)

app.stream.close()
app.store.close()
root.destroy()

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
