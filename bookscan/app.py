"""The scanning interface.

Live feed on the left, the front and back captures on the right, and an
editable review panel underneath. Hold a book up, it captures the front; turn
it over, it captures the back; check the fields and press the right arrow.
"""

from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

from . import camera as camera_module
from .config import BACKUP_DIR, CAPTURE_DIR, CSV_PATH, DB_PATH, Settings
from .migrations import MigrationError
from .detect import BookDetector, ShutterController
from . import lookup as lookup_module
from .lookup import BookRecord, lookup_isbn, search_title
from .recognize import Recognition, configure_tesseract, recognize
from .store import Store

try:
    import winsound

    def _beep() -> None:
        threading.Thread(
            target=lambda: winsound.Beep(880, 90), daemon=True
        ).start()
except Exception:  # pragma: no cover - non-Windows
    def _beep() -> None:
        pass


# Overlay colours, BGR because they are drawn with OpenCV.
STATUS_COLOURS = {
    "waiting": (170, 170, 170),
    "settling": (0, 200, 255),
    "holding": (60, 220, 60),
    "blurry": (0, 120, 255),
    "changed": (220, 160, 0),
}

FIELDS = [
    ("title", "Title"),
    ("authors", "Author(s)"),
    ("isbn13", "ISBN-13"),
    ("isbn10", "ISBN-10"),
    ("publisher", "Publisher"),
    ("published", "Published"),
    ("pages", "Pages"),
    ("notes", "Notes"),
]


class BookScanApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.settings = Settings.load()
        self.store = Store(DB_PATH, BACKUP_DIR)
        self.detector = BookDetector(self.settings)
        self.shutter = ShutterController(self.settings)
        self.stream = camera_module.CameraStream(
            self.settings.frame_width, self.settings.frame_height
        )

        self.ocr_available, self.ocr_message = configure_tesseract(self.settings)
        if not self.ocr_available:
            self.settings.ocr_enabled = False
        lookup_module.GOOGLE_API_KEY = self.settings.google_api_key

        self.state = "WAIT_FRONT"
        self.front_frame: np.ndarray | None = None
        self.back_frame: np.ndarray | None = None
        self.recognition: Recognition | None = None
        self.book: BookRecord | None = None
        self.duplicate_of: int | None = None
        self.camera_error = ""

        self._results: queue.Queue = queue.Queue()
        self._preview_image = None  # kept alive for Tk
        self._front_thumb = None
        self._back_thumb = None
        self._cameras: list[camera_module.CameraInfo] = []

        self.vars = {key: tk.StringVar() for key, _ in FIELDS}

        root.title("book-scan")
        root.geometry("1480x940")
        root.minsize(1180, 820)
        root.protocol("WM_DELETE_WINDOW", self.quit)

        self._build_ui()
        self._bind_keys()
        self.refresh_cameras(select_default=True)
        self._set_state("WAIT_FRONT")
        self.root.after(20, self._tick)

    # ------------------------------------------------------------------
    # Interface construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Prompt.TLabel", font=("Segoe UI", 13, "bold"))
        style.configure("Header.TLabel", font=("Segoe UI", 10, "bold"))
        style.configure("Warn.TLabel", foreground="#b00020")
        style.configure("Ok.TLabel", foreground="#0a7d38")

        top = ttk.Frame(self.root, padding=(10, 8))
        top.pack(fill=tk.X)

        ttk.Label(top, text="Camera:").pack(side=tk.LEFT)
        self.camera_box = ttk.Combobox(top, width=42, state="readonly")
        self.camera_box.pack(side=tk.LEFT, padx=(6, 4))
        self.camera_box.bind("<<ComboboxSelected>>", self._on_camera_selected)
        ttk.Button(top, text="Refresh", width=9,
                   command=self.refresh_cameras).pack(side=tk.LEFT)
        ttk.Button(top, text="Export CSV", width=11,
                   command=self.export_csv).pack(side=tk.LEFT, padx=(10, 0))

        self.count_label = ttk.Label(top, text="0 books", style="Header.TLabel")
        self.count_label.pack(side=tk.RIGHT)
        self.engine_label = ttk.Label(top, text="")
        self.engine_label.pack(side=tk.RIGHT, padx=(0, 16))

        middle = ttk.Frame(self.root, padding=(10, 0))
        middle.pack(fill=tk.BOTH, expand=True)

        left = ttk.Frame(middle)
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.prompt_label = ttk.Label(
            left, text="", style="Prompt.TLabel", anchor="center"
        )
        self.prompt_label.pack(side=tk.BOTTOM, fill=tk.X, pady=(6, 0))

        # The preview lives inside a holder whose size does NOT follow its
        # child. Without that, each rendered frame sets the label's requested
        # size, which grows the window, which makes the next frame larger
        # again, and the preview walks off the screen.
        self.preview_holder = tk.Frame(
            left, background="#101014",
            width=self.settings.preview_width,
            height=int(self.settings.preview_width * 9 / 16),
        )
        self.preview_holder.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.preview_holder.pack_propagate(False)

        self.preview = tk.Label(self.preview_holder, background="#101014")
        self.preview.pack(fill=tk.BOTH, expand=True)
        self.preview.bind("<Button-1>", lambda _e: self.root.focus_set())

        right = ttk.Frame(middle, padding=(12, 0, 0, 0))
        right.pack(side=tk.LEFT, fill=tk.Y)

        self.front_label = self._make_thumb(right, "Front cover", (2, 10))
        self.back_label = self._make_thumb(right, "Back cover", (2, 0))

        review = ttk.LabelFrame(
            self.root, text="Review", padding=(12, 8, 12, 10)
        )
        review.pack(fill=tk.X, padx=10, pady=(8, 4))
        review.columnconfigure(1, weight=1)
        review.columnconfigure(3, weight=1)

        self.entries: dict[str, ttk.Entry] = {}
        for i, (key, caption) in enumerate(FIELDS):
            row, column = divmod(i, 2)
            ttk.Label(review, text=caption + ":").grid(
                row=row, column=column * 2, sticky="e", padx=(0, 6), pady=3
            )
            entry = ttk.Entry(review, textvariable=self.vars[key], width=48)
            entry.grid(
                row=row, column=column * 2 + 1, sticky="ew",
                padx=(0, 18 if column == 0 else 0), pady=3,
            )
            entry.bind("<Return>", lambda _e: self.root.focus_set())
            entry.bind("<Escape>", lambda _e: self.root.focus_set())
            self.entries[key] = entry

        self.source_label = ttk.Label(review, text="")
        self.source_label.grid(
            row=len(FIELDS) // 2, column=0, columnspan=2, sticky="w", pady=(6, 0)
        )
        self.warning_label = ttk.Label(review, text="", style="Warn.TLabel")
        self.warning_label.grid(
            row=len(FIELDS) // 2, column=2, columnspan=2, sticky="w", pady=(6, 0)
        )

        hint = (
            "Right arrow  save and next     "
            "R  retake both     F  retake front     B  retake back     "
            "D  discard     Space  capture now     E  export CSV     "
            "Ctrl+Q  quit          (click a field to edit, Enter to leave it)"
        )
        self.hint_label = ttk.Label(self.root, text=hint, anchor="center")
        self.hint_label.pack(fill=tk.X, padx=10, pady=(0, 8))

        self._update_counts()
        self._update_engine_label()

    def _make_thumb(self, parent, caption: str, pady) -> tk.Label:
        """A fixed-size slot for a cover thumbnail.

        The size lives on the holder frame, in pixels. Putting it on the
        label instead would be read as characters and lines whenever the
        label is empty, which makes the panel enormous before the first
        capture.
        """
        ttk.Label(parent, text=caption, style="Header.TLabel").pack(anchor="w")
        holder = tk.Frame(
            parent, background="#1b1b20",
            width=self.settings.thumb_width,
            height=int(self.settings.thumb_width * 0.78),
        )
        holder.pack(pady=pady)
        holder.pack_propagate(False)

        label = tk.Label(holder, background="#1b1b20")
        label.pack(fill=tk.BOTH, expand=True)
        return label

    def _bind_keys(self) -> None:
        self.root.bind("<Right>", self._on_right)
        self.root.bind("<Control-Right>", lambda _e: self.accept())
        self.root.bind("<Control-q>", lambda _e: self.quit())
        for key, handler in (
            ("r", lambda: self.retake("both")),
            ("f", lambda: self.retake("front")),
            ("b", lambda: self.retake("back")),
            ("d", self.discard),
            ("e", self.export_csv),
            ("space", self.manual_capture),
        ):
            self.root.bind(
                f"<{key}>" if key == "space" else f"<KeyPress-{key}>",
                self._guarded(handler),
            )

    def _guarded(self, handler):
        def wrapped(_event=None):
            if self._is_typing():
                return None
            handler()
            return "break"
        return wrapped

    def _is_typing(self) -> bool:
        widget = self.root.focus_get()
        return isinstance(widget, (ttk.Entry, tk.Entry, tk.Text))

    def _on_right(self, _event=None):
        if self._is_typing():
            return None  # let the caret move inside the field
        self.accept()
        return "break"

    # ------------------------------------------------------------------
    # Camera
    # ------------------------------------------------------------------

    def refresh_cameras(self, select_default: bool = False) -> None:
        self._cameras = camera_module.list_cameras()
        self.camera_box["values"] = [str(c) for c in self._cameras]
        if not self._cameras:
            self.camera_box.set("No cameras found")
            return
        if select_default or not self.camera_box.get():
            wanted = next(
                (i for i, c in enumerate(self._cameras)
                 if c.index == self.settings.camera_index),
                0,
            )
            self.camera_box.current(wanted)
            self._open_camera(self._cameras[wanted].index)

    def _on_camera_selected(self, _event=None) -> None:
        position = self.camera_box.current()
        if 0 <= position < len(self._cameras):
            self._open_camera(self._cameras[position].index)
        self.root.focus_set()

    def _open_camera(self, index: int) -> None:
        # A failure here is reported in the preview area rather than in a
        # modal, because the usual fix is simply to pick a different entry
        # from the dropdown, and Windows happily lists virtual cameras that
        # cannot actually be opened.
        if not self.stream.open(index):
            self.camera_error = self.stream.error or (
                f"Camera {index} failed to open."
            )
            return
        self.camera_error = ""
        self.settings.camera_index = index
        self.settings.save()
        self.shutter.reset()

    # ------------------------------------------------------------------
    # Frame loop
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        self._drain_results()

        frame = self.stream.read()
        if frame is None:
            self._show_placeholder(
                self.camera_error
                or "No camera feed. Pick a camera above, then hold up a book."
            )
            self.root.after(60, self._tick)
            return

        small, _scale = self.detector.prepare(frame)

        detection = None
        shutter = None
        if self.state in ("WAIT_FRONT", "WAIT_BACK"):
            detection = self.detector.detect(small)
            shutter = self.shutter.update(detection, small, time.monotonic())
            if shutter.fire:
                self._capture(frame, small)

        self._render(small, detection, shutter)
        self.root.after(20, self._tick)

    def _render(self, small, detection, shutter) -> None:
        display = small.copy()
        height, width = display.shape[:2]

        if shutter is not None:
            colour = STATUS_COLOURS.get(shutter.status, (170, 170, 170))
            if detection is not None:
                if detection.quad is not None:
                    cv2.polylines(
                        display, [detection.quad.astype(np.int32)], True,
                        colour, 3,
                    )
                else:
                    x, y, w, h = detection.bbox
                    cv2.rectangle(display, (x, y), (x + w, y + h), colour, 3)

            if shutter.progress > 0:
                filled = int(width * min(1.0, shutter.progress))
                cv2.rectangle(
                    display, (0, height - 10), (filled, height), colour, -1
                )
            self._banner(display, shutter.message, colour)
        else:
            self._banner(display, "Reviewing", (170, 170, 170))

        # Fit inside the holder, never the other way round, and honour both
        # dimensions so a tall frame cannot overflow downwards.
        available_w = self.preview_holder.winfo_width()
        available_h = self.preview_holder.winfo_height()
        if available_w < 60 or available_h < 60:
            available_w = self.settings.preview_width
            available_h = int(self.settings.preview_width * 9 / 16)

        scale = min(available_w / float(width), available_h / float(height))
        resized = cv2.resize(
            display,
            (max(160, int(width * scale)), max(90, int(height * scale))),
            interpolation=cv2.INTER_LINEAR,
        )
        image = Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))
        self._preview_image = ImageTk.PhotoImage(image)
        self.preview.configure(image=self._preview_image, text="")

    @staticmethod
    def _banner(image, text: str, colour) -> None:
        cv2.rectangle(image, (0, 0), (image.shape[1], 34), (20, 20, 24), -1)
        cv2.putText(
            image, text, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.68, colour, 2,
            cv2.LINE_AA,
        )

    def _show_placeholder(self, message: str) -> None:
        self.preview.configure(
            image="", text=message, foreground="#cccccc",
            font=("Segoe UI", 12), wraplength=560, justify="center",
        )
        self._preview_image = None

    # ------------------------------------------------------------------
    # Capture and recognition
    # ------------------------------------------------------------------

    def manual_capture(self) -> None:
        if self.state not in ("WAIT_FRONT", "WAIT_BACK"):
            return
        frame = self.stream.read()
        if frame is None:
            return
        small, _ = self.detector.prepare(frame)
        self._capture(frame, small)

    def _capture(self, frame: np.ndarray, small: np.ndarray) -> None:
        self.shutter.notify_captured(small, time.monotonic())
        if self.settings.beep_on_capture:
            _beep()

        if self.state == "WAIT_FRONT":
            self.front_frame = frame.copy()
            self._set_thumb(self.front_label, frame, "front")
            if self.back_frame is None:
                self._set_state("WAIT_BACK")
            else:
                self._start_processing()  # this was a front-only retake
        elif self.state == "WAIT_BACK":
            self.back_frame = frame.copy()
            self._set_thumb(self.back_label, frame, "back")
            self._start_processing()

    def _set_thumb(self, label: tk.Label, frame, slot: str) -> None:
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        image.thumbnail(
            (self.settings.thumb_width, self.settings.thumb_width),
            Image.LANCZOS,
        )
        photo = ImageTk.PhotoImage(image)
        label.configure(image=photo)
        if slot == "front":
            self._front_thumb = photo
        else:
            self._back_thumb = photo

    def _clear_thumb(self, label: tk.Label, slot: str) -> None:
        label.configure(image="")
        if slot == "front":
            self._front_thumb = None
        else:
            self._back_thumb = None

    def _start_processing(self) -> None:
        self._set_state("PROCESSING")
        front = self.front_frame
        back = self.back_frame
        threading.Thread(
            target=self._process, args=(front, back), daemon=True
        ).start()

    def _process(self, front, back) -> None:
        """Runs off the UI thread: barcode, OCR, then the online lookup."""
        try:
            found = recognize(front, back, self.settings)
            record = BookRecord()
            if self.settings.lookup_enabled:
                if found.isbn13:
                    record = lookup_isbn(found.isbn13,
                                         self.settings.lookup_timeout)
                elif found.isbn10:
                    record = lookup_isbn(found.isbn10,
                                         self.settings.lookup_timeout)
                elif found.title_guess:
                    record = search_title(found.title_guess,
                                          self.settings.lookup_timeout)
            self._results.put((found, record, None))
        except Exception as exc:  # keep a bad frame from killing the session
            self._results.put((None, None, exc))

    def _drain_results(self) -> None:
        try:
            found, record, error = self._results.get_nowait()
        except queue.Empty:
            return

        if error is not None:
            messagebox.showerror("Recognition failed", str(error))
            self.recognition = Recognition()
            self.book = BookRecord()
        else:
            self.recognition = found
            self.book = record

        self._set_state("REVIEW")
        self._populate_review()

    def _populate_review(self) -> None:
        found = self.recognition or Recognition()
        record = self.book or BookRecord()

        isbn13 = record.isbn13 or found.isbn13
        isbn10 = record.isbn10 or found.isbn10

        self.vars["title"].set(record.title or found.title_guess or "")
        self.vars["authors"].set(record.authors)
        self.vars["isbn13"].set(isbn13)
        self.vars["isbn10"].set(isbn10)
        self.vars["publisher"].set(record.publisher)
        self.vars["published"].set(record.published)
        self.vars["pages"].set(record.pages)
        self.vars["notes"].set("")

        bits = []
        if found.isbn_source:
            bits.append(f"ISBN from {found.isbn_source}")
        bits.append(
            f"matched via {record.source}" if record.found
            else "no catalogue match"
        )
        if found.title_guess and not record.found:
            bits.append(f'OCR title "{found.title_guess}"')
        self.source_label.configure(text="  |  ".join(bits))

        warnings = list(found.notes) + list(record.notes)
        self.duplicate_of = None
        existing = self.store.find_by_isbn(isbn13)
        if existing is not None:
            self.duplicate_of = int(existing["id"])
            warnings.insert(
                0, f'Already scanned as #{existing["id"]}: {existing["title"]}'
            )

        self.warning_label.configure(text="  ".join(warnings)[:180])

        focus_key = "title" if not (record.title or found.title_guess) else None
        if focus_key:
            self.entries[focus_key].focus_set()

    # ------------------------------------------------------------------
    # Review actions
    # ------------------------------------------------------------------

    def accept(self) -> None:
        if self.state != "REVIEW":
            return
        title = self.vars["title"].get().strip()
        if not title:
            messagebox.showwarning(
                "Title required",
                "Give the book a title before saving. Everything else is "
                "optional.",
            )
            self.entries["title"].focus_set()
            return
        if self.duplicate_of is not None:
            if not messagebox.askyesno(
                "Duplicate ISBN",
                f"This ISBN is already saved as #{self.duplicate_of}.\n\n"
                "Save it anyway as a second copy?",
            ):
                return

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        isbn13 = self.vars["isbn13"].get().strip()
        slug = isbn13 or "noisbn"
        CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        front_path = CAPTURE_DIR / f"{stamp}_{slug}_front.jpg"
        back_path = CAPTURE_DIR / f"{stamp}_{slug}_back.jpg"
        params = [int(cv2.IMWRITE_JPEG_QUALITY), self.settings.jpeg_quality]
        if self.front_frame is not None:
            cv2.imwrite(str(front_path), self.front_frame, params)
        if self.back_frame is not None:
            cv2.imwrite(str(back_path), self.back_frame, params)

        found = self.recognition or Recognition()
        record = self.book or BookRecord()
        self.store.add_book({
            "isbn13": isbn13,
            "isbn10": self.vars["isbn10"].get().strip(),
            "title": title,
            "authors": self.vars["authors"].get().strip(),
            "publisher": self.vars["publisher"].get().strip(),
            "published": self.vars["published"].get().strip(),
            "pages": self.vars["pages"].get().strip(),
            "notes": self.vars["notes"].get().strip(),
            "isbn_source": found.isbn_source,
            "lookup_source": record.source,
            "front_image": str(front_path) if self.front_frame is not None else "",
            "back_image": str(back_path) if self.back_frame is not None else "",
            "ocr_title": found.title_guess,
            "ocr_back_text": (found.back_text or "")[:4000],
            "ocr_front_text": (found.front_text or "")[:4000],
            # Kept verbatim so a mis-parsed ISBN can be recovered later from
            # what the scanner actually read.
            "raw_barcodes": ", ".join(found.barcodes),
        })
        self._update_counts()
        self._reset_book()

    def discard(self) -> None:
        if self.state == "WAIT_FRONT" and self.front_frame is None:
            return
        self._reset_book()

    def retake(self, which: str) -> None:
        if self.state not in ("REVIEW", "WAIT_BACK"):
            return
        if which in ("both", "front"):
            self.front_frame = None
            self._clear_thumb(self.front_label, "front")
        if which in ("both", "back"):
            self.back_frame = None
            self._clear_thumb(self.back_label, "back")
        self.shutter.reset()
        if self.front_frame is None:
            self._set_state("WAIT_FRONT")
        else:
            self._set_state("WAIT_BACK")

    def _reset_book(self) -> None:
        self.front_frame = None
        self.back_frame = None
        self.recognition = None
        self.book = None
        self.duplicate_of = None
        for var in self.vars.values():
            var.set("")
        self.source_label.configure(text="")
        self.warning_label.configure(text="")
        self._clear_thumb(self.front_label, "front")
        self._clear_thumb(self.back_label, "back")

        # Disarm against the scene as it looks right now, so the book that was
        # just saved cannot immediately be photographed again as the next one.
        # Moving it out of frame, or swapping in the next book, re-arms us.
        frame = self.stream.read()
        if frame is None:
            self.shutter.reset()
        else:
            small, _ = self.detector.prepare(frame)
            self.shutter.notify_captured(small, time.monotonic())

        self.root.focus_set()
        self._set_state("WAIT_FRONT")

    # ------------------------------------------------------------------
    # State and status
    # ------------------------------------------------------------------

    def _set_state(self, state: str) -> None:
        self.state = state
        prompts = {
            "WAIT_FRONT": "Hold up the FRONT cover and keep it still",
            "WAIT_BACK": "Now turn it over: hold up the BACK cover",
            "PROCESSING": "Reading barcode and looking the book up...",
            "REVIEW": "Check the details, then press the RIGHT ARROW to save",
        }
        self.prompt_label.configure(text=prompts.get(state, ""))
        entry_state = "normal" if state == "REVIEW" else "disabled"
        for entry in self.entries.values():
            entry.configure(state=entry_state)

    def _update_counts(self) -> None:
        total = self.store.count()
        self.count_label.configure(
            text=f"{total} book{'' if total == 1 else 's'} saved"
        )

    def _update_engine_label(self) -> None:
        from .recognize import ZBAR_AVAILABLE

        parts = [
            "barcode: on" if ZBAR_AVAILABLE else "barcode: OFF",
            "OCR: on" if self.ocr_available else "OCR: OFF",
            "lookup: on" if self.settings.lookup_enabled else "lookup: off",
            f"db v{self.store.schema_version}",
        ]
        self.engine_label.configure(text="   ".join(parts))
        if not self.ocr_available:
            self.warning_label.configure(text=self.ocr_message)

    # ------------------------------------------------------------------

    def export_csv(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Export catalogue",
            defaultextension=".csv",
            initialfile=CSV_PATH.name,
            initialdir=str(CSV_PATH.parent),
            filetypes=[("CSV", "*.csv")],
        )
        if not path:
            return
        try:
            written = self.store.export_csv(Path(path))
        except OSError as exc:
            messagebox.showerror("Export failed", str(exc))
            return
        messagebox.showinfo("Export complete", f"Wrote {written} books to\n{path}")
        self.root.focus_set()

    def quit(self) -> None:
        self.stream.close()
        self.store.close()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    try:
        app = BookScanApp(root)
    except MigrationError as exc:
        # The catalogue is intact; we simply refused to open it. Say so
        # clearly rather than dying in a traceback the user will not read.
        root.withdraw()
        messagebox.showerror("Catalogue not opened", str(exc))
        root.destroy()
        return

    if app.store.applied:
        print("Applied migrations: " + ", ".join(app.store.applied))
        if app.store.backup:
            print(f"Pre-migration backup: {app.store.backup}")

    root.mainloop()
