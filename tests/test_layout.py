"""Guards against the preview pane growing without bound.

Rendering a frame must never change the size the window asks for. If it does,
each frame is drawn slightly larger than the last and the preview walks off
the screen. Run with:  uv run tests/test_layout.py
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

# A normal 720p webcam frame with something book-shaped in it.
frame = np.full((720, 1280, 3), 40, np.uint8)
cv2.randu(frame, 20, 70)
cv2.rectangle(frame, (430, 90), (830, 650), (235, 235, 235), -1)
cv2.putText(frame, "THE HOBBIT", (455, 300), cv2.FONT_HERSHEY_SIMPLEX,
            1.6, (10, 10, 10), 5)

root = tk.Tk()
app = appmod.BookScanApp(root)

# Stand in for a camera that is not present in CI or on this machine.
app.stream.read = lambda: frame.copy()

root.update()
start_geom = (root.winfo_width(), root.winfo_height())
check("window opens at its configured size",
      start_geom[0] == 1480 and start_geom[1] == 940, start_geom)


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


# --- The actual regression: many frames rendered, size must not drift ----
seen = sample()
settled = seen[10:]
check("preview actually rendered", app._preview_image is not None)
check("window size stable across 70 frames", len(set(settled)) == 1,
      f"first={settled[0]} last={settled[-1]} distinct={len(set(settled))}")
check("window never grew", seen[-1][0] <= start_geom[0] and seen[-1][1] <= start_geom[1],
      f"{start_geom} -> {seen[-1][:2]}")

# --- Empty thumbnails must not be sized in characters --------------------
fw = app.front_label.master.winfo_width()
fh = app.front_label.master.winfo_height()
check("empty front thumb is pixel sized", 200 < fw < 500, f"{fw}x{fh}")
check("right panel is a sane width",
      app.front_label.master.master.winfo_width() < 500,
      app.front_label.master.master.winfo_width())

# --- Filling the thumbnails must not resize anything either --------------
before = (root.winfo_width(), root.winfo_height())
small = app.detector.prepare(frame)[0]
app._capture(frame, small)
root.update()
after_front = sample(25)[-1][:2]
check("capturing the front does not resize the window",
      after_front == before, f"{before} -> {after_front}")

app._capture(frame, small)
root.update()
after_back = sample(25)[-1][:2]
check("capturing the back does not resize the window",
      after_back == before, f"{before} -> {after_back}")

# --- The no-camera placeholder must not resize anything ------------------
app.stream.read = lambda: None
app.camera_error = (
    "Camera 0 could not be opened. It may be unplugged, in use by another "
    "program, blocked by Windows camera privacy settings, or a virtual "
    "device that has no feed."
)
after_placeholder = sample(30)[-1][:2]
check("long placeholder message does not resize the window",
      after_placeholder == before, f"{before} -> {after_placeholder}")

# --- Shrinking the window must be respected, not fought ------------------
root.geometry("1200x820")
root.update()
shrunk = sample(30)[-1][:2]
check("window can be resized smaller and stays there",
      shrunk == (1200, 820), shrunk)

app.stream.close()
app.store.close()
root.destroy()

print()
print("RESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
