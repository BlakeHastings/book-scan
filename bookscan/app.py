"""The scanning interface.

Live feed on the left with the three captures beneath it, shelving guidance
on the right, and the editable record along the bottom.

Capture is manual: hold the book up and press space for the front, turn it
over for the back, then show the spine. Once the book is identified the
right hand panel says which two books it belongs between, shows their
spines so you can find them on the shelf, and suggests the shelf. You put
the book there and type in the area you used.
"""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

from . import camera as camera_module
from . import lookup as lookup_module
from .config import BACKUP_DIR, CAPTURE_DIR, CSV_PATH, DB_PATH, Settings
from .lookup import BookRecord, lookup_isbn, search_title
from .migrations import MigrationError
from .recognize import (
    Recognition,
    configure_tesseract,
    normalise_isbn,
    recognize,
    sharpness,
)
from .shelving import Placement, author_sort_name, guess_fiction, plan_placement, sort_key
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


# Laid out three to a row along the bottom of the record panel.
FIELDS = [
    ("title", "Title"),
    ("authors", "Author(s)"),
    ("sort_author", "Sort as"),
    ("series", "Series"),
    ("series_number", "Series #"),
    ("isbn13", "ISBN-13"),
    ("isbn10", "ISBN-10"),
    ("publisher", "Publisher"),
    ("published", "Published"),
    ("pages", "Pages"),
    ("subjects", "Subjects"),
    ("notes", "Notes"),
]

SLOTS = (("front", "Front"), ("back", "Back"), ("spine", "Spine"))


class BookScanApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.settings = Settings.load()
        self.store = Store(DB_PATH, BACKUP_DIR)
        self.stream = camera_module.CameraStream(
            self.settings.frame_width, self.settings.frame_height
        )

        self.ocr_available, self.ocr_message = configure_tesseract(self.settings)
        if not self.ocr_available:
            self.settings.ocr_enabled = False
        lookup_module.GOOGLE_API_KEY = self.settings.google_api_key

        self.state = "WAIT_FRONT"
        self.frames: dict[str, np.ndarray | None] = {
            "front": None, "back": None, "spine": None
        }
        self.recognition: Recognition | None = None
        self.book: BookRecord | None = None
        self.placement: Placement | None = None
        self.duplicate_of: int | None = None
        self.camera_error = ""
        self._busy = False

        self._results: queue.Queue = queue.Queue()
        self._preview_image = None  # kept alive for Tk
        self._thumb_images: dict[str, ImageTk.PhotoImage | None] = {
            "front": None, "back": None, "spine": None
        }
        self._neighbour_images: dict[str, ImageTk.PhotoImage | None] = {
            "previous": None, "following": None
        }
        self._cameras: list[camera_module.CameraInfo] = []

        self.vars = {key: tk.StringVar() for key, _ in FIELDS}
        self.shelf_var = tk.StringVar()
        self.area_var = tk.StringVar()
        self.fiction_var = tk.BooleanVar(value=True)

        root.title("book-scan")
        root.geometry("1560x1000")
        root.minsize(1300, 900)
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
        style.configure("Prompt.TLabel", font=("Segoe UI", 12, "bold"))
        style.configure("Header.TLabel", font=("Segoe UI", 9, "bold"))
        style.configure("Place.TLabel", font=("Segoe UI", 11, "bold"))
        style.configure("Warn.TLabel", foreground="#b00020")
        style.configure("Note.TLabel", foreground="#5a5a5a")
        style.configure("Big.TButton", font=("Segoe UI", 11, "bold"))

        top = ttk.Frame(self.root, padding=(10, 8))
        top.pack(fill=tk.X)
        ttk.Label(top, text="Camera:").pack(side=tk.LEFT)
        self.camera_box = ttk.Combobox(top, width=32, state="readonly")
        self.camera_box.pack(side=tk.LEFT, padx=(6, 4))
        self.camera_box.bind("<<ComboboxSelected>>", self._on_camera_selected)
        ttk.Button(top, text="Refresh", width=9,
                   command=self.refresh_cameras).pack(side=tk.LEFT)
        ttk.Button(top, text="Export CSV", width=11,
                   command=self.export_csv).pack(side=tk.LEFT, padx=(10, 0))
        ttk.Button(top, text="Diagnostics", width=12,
                   command=self.show_diagnostics).pack(side=tk.LEFT, padx=(6, 0))
        self.count_label = ttk.Label(top, text="", style="Header.TLabel")
        self.count_label.pack(side=tk.RIGHT)
        self.engine_label = ttk.Label(top, text="")
        self.engine_label.pack(side=tk.RIGHT, padx=(0, 16))

        middle = ttk.Frame(self.root, padding=(10, 0))
        middle.pack(fill=tk.BOTH, expand=True)

        # --- left: live feed, prompt, capture button, the three captures --
        left = ttk.Frame(middle)
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        thumbs = ttk.Frame(left)
        thumbs.pack(side=tk.BOTTOM, fill=tk.X, pady=(8, 0))
        self.thumb_labels: dict[str, tk.Label] = {}
        for slot, caption in SLOTS:
            self.thumb_labels[slot] = self._make_capture_slot(
                thumbs, caption, slot
            )

        self.capture_button = ttk.Button(
            left, text="", style="Big.TButton", command=self.manual_capture
        )
        self.capture_button.pack(side=tk.BOTTOM, fill=tk.X, pady=(6, 0))

        self.prompt_label = ttk.Label(
            left, text="", style="Prompt.TLabel", anchor="center"
        )
        self.prompt_label.pack(side=tk.BOTTOM, fill=tk.X, pady=(6, 0))

        # The holder has a fixed requested size and does not propagate its
        # child's size upward. Without that, the rendered frame sets the
        # label's requested size, which grows the window, which makes the
        # next frame larger again.
        # The height here is only a floor. The holder expands to fill
        # whatever is left over, so asking for a full 16:9 box would push the
        # window's requested height past the screen and clip the panels
        # below.
        self.preview_holder = tk.Frame(
            left, background="#101014",
            width=self.settings.preview_width, height=280,
        )
        self.preview_holder.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.preview_holder.pack_propagate(False)
        self.preview = tk.Label(self.preview_holder, background="#101014")
        self.preview.pack(fill=tk.BOTH, expand=True)
        self.preview.bind("<Button-1>", lambda _e: self.root.focus_set())

        # --- right: shelving --------------------------------------------
        self._build_placement_panel(middle)

        # --- bottom: the record ------------------------------------------
        self._build_record_panel()

        hint = (
            "Space  capture     S  skip or retake spine     "
            "Right arrow  save and next     I  ISBN     A  area     "
            "Ctrl+L  look up     U  update placement     "
            "R / F / B  retake     D  discard     E  export     Ctrl+Q  quit"
        )
        ttk.Label(self.root, text=hint, anchor="center").pack(
            fill=tk.X, padx=10, pady=(0, 8)
        )

        self._update_counts()
        self._update_engine_label()

    def _make_capture_slot(self, parent, caption: str, slot: str) -> tk.Label:
        """A fixed-size slot for one captured cover.

        The size lives on the holder frame, in pixels. Putting it on the
        label instead would be read as characters and lines whenever the
        label is empty, which makes the panel enormous before the first
        capture.
        """
        box = ttk.Frame(parent)
        box.pack(side=tk.LEFT, padx=(0, 8))
        ttk.Label(box, text=caption, style="Header.TLabel").pack(anchor="w")
        holder = tk.Frame(
            box, background="#1b1b20",
            width=self.settings.thumb_width,
            height=int(self.settings.thumb_width * 0.72),
        )
        holder.pack()
        holder.pack_propagate(False)
        label = tk.Label(holder, background="#1b1b20")
        label.pack(fill=tk.BOTH, expand=True)
        return label

    def _build_placement_panel(self, parent) -> None:
        panel = ttk.LabelFrame(parent, text="Where it goes", padding=(10, 6))
        panel.pack(side=tk.LEFT, fill=tk.Y, padx=(12, 0))

        self.place_headline = ttk.Label(
            panel, text="", style="Place.TLabel", wraplength=470,
            justify="left",
        )
        self.place_headline.pack(anchor="w", fill=tk.X)

        self.place_note = ttk.Label(
            panel, text="", style="Note.TLabel", wraplength=470,
            justify="left",
        )
        self.place_note.pack(anchor="w", fill=tk.X, pady=(2, 6))

        cards = ttk.Frame(panel)
        cards.pack(fill=tk.X)
        self.neighbour_labels = {}
        self.neighbour_captions = {}
        for side, caption in (("previous", "Goes AFTER this"),
                              ("following", "Goes BEFORE this")):
            card = ttk.Frame(cards)
            card.pack(side=tk.LEFT, padx=(0, 10))
            ttk.Label(card, text=caption, style="Header.TLabel").pack(
                anchor="w"
            )
            holder = tk.Frame(card, background="#1b1b20", width=222,
                              height=250)
            holder.pack()
            holder.pack_propagate(False)
            label = tk.Label(holder, background="#1b1b20", fg="#999999",
                             wraplength=200, font=("Segoe UI", 8))
            label.pack(fill=tk.BOTH, expand=True)
            self.neighbour_labels[side] = label

            caption_label = ttk.Label(card, text="", wraplength=222,
                                      justify="left", font=("Segoe UI", 8))
            caption_label.pack(anchor="w", pady=(2, 0))
            self.neighbour_captions[side] = caption_label

        controls = ttk.Frame(panel)
        controls.pack(fill=tk.X, pady=(10, 0))

        ttk.Label(controls, text="Shelf:").grid(row=0, column=0, sticky="e")
        self.shelf_box = ttk.Combobox(
            controls, textvariable=self.shelf_var, width=6, state="readonly",
            values=list(self.settings.fiction_shelves)
            + list(self.settings.nonfiction_shelves),
        )
        self.shelf_box.grid(row=0, column=1, sticky="w", padx=(4, 14))

        ttk.Label(controls, text="Area:").grid(row=0, column=2, sticky="e")
        self.area_entry = ttk.Entry(controls, textvariable=self.area_var,
                                    width=8)
        self.area_entry.grid(row=0, column=3, sticky="w", padx=(4, 14))
        self.area_entry.bind("<Return>", lambda _e: self.root.focus_set())
        self.area_entry.bind("<Escape>", lambda _e: self.root.focus_set())

        self.fiction_check = ttk.Checkbutton(
            controls, text="Fiction", variable=self.fiction_var,
            command=self.update_placement,
        )
        self.fiction_check.grid(row=0, column=4, sticky="w")

        ttk.Button(controls, text="Update placement  (U)",
                   command=self.update_placement).grid(
            row=1, column=0, columnspan=5, sticky="w", pady=(8, 0)
        )

    def _build_record_panel(self) -> None:
        record = ttk.LabelFrame(self.root, text="Record",
                                padding=(12, 6, 12, 8))
        record.pack(fill=tk.X, padx=10, pady=(8, 4))
        for column in (1, 3, 5):
            record.columnconfigure(column, weight=1)

        self.entries: dict[str, ttk.Entry] = {}
        for i, (key, caption) in enumerate(FIELDS):
            row, column = divmod(i, 3)
            ttk.Label(record, text=caption + ":").grid(
                row=row, column=column * 2, sticky="e", padx=(0, 6), pady=3
            )
            entry = ttk.Entry(record, textvariable=self.vars[key], width=30)
            entry.grid(row=row, column=column * 2 + 1, sticky="ew",
                       padx=(0, 16), pady=3)
            if key == "isbn13":
                # Enter here means "look this up". A USB barcode scanner
                # sends the digits followed by Enter, so scanning into this
                # field just works.
                entry.bind("<Return>", lambda _e: self.lookup_now())
            elif key in ("sort_author", "series", "series_number", "authors"):
                # These change where the book files, so recompute.
                entry.bind("<Return>", lambda _e: self.update_placement())
            else:
                entry.bind("<Return>", lambda _e: self.root.focus_set())
            entry.bind("<Escape>", lambda _e: self.root.focus_set())
            self.entries[key] = entry

        actions = ttk.Frame(record)
        actions.grid(row=(len(FIELDS) + 2) // 3, column=0, columnspan=6,
                     sticky="ew", pady=(8, 0))
        self.lookup_button = ttk.Button(
            actions, text="Look up  (Ctrl+L)", command=self.lookup_now
        )
        self.lookup_button.pack(side=tk.LEFT)
        ttk.Button(actions, text="Type ISBN  (I)",
                   command=self.focus_isbn).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(actions, text="Save and next  (Right arrow)",
                   command=self.accept).pack(side=tk.LEFT, padx=(6, 0))
        self.source_label = ttk.Label(actions, text="")
        self.source_label.pack(side=tk.LEFT, padx=(18, 0))

        self.warning_label = ttk.Label(record, text="", style="Warn.TLabel",
                                       wraplength=1400, justify="left")
        self.warning_label.grid(row=(len(FIELDS) + 2) // 3 + 1, column=0,
                                columnspan=6, sticky="w", pady=(6, 0))

    def _bind_keys(self) -> None:
        self.root.bind("<Right>", self._on_right)
        self.root.bind("<Control-Right>", lambda _e: self.accept())
        self.root.bind("<Control-q>", lambda _e: self.quit())
        self.root.bind("<Control-l>", lambda _e: self.lookup_now())
        for key, handler in (
            ("r", lambda: self.retake("all")),
            ("f", lambda: self.retake("front")),
            ("b", lambda: self.retake("back")),
            ("s", self.spine_key),
            ("u", self.update_placement),
            ("d", self.discard),
            ("e", self.export_csv),
            ("i", self.focus_isbn),
            ("a", self.focus_area),
            ("space", self.manual_capture),
        ):
            self.root.bind(
                "<space>" if key == "space" else f"<KeyPress-{key}>",
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
        # Reported in the preview area rather than a modal, because the fix
        # is usually to pick a different entry and Windows happily lists
        # virtual cameras that cannot actually be opened.
        if not self.stream.open(index):
            self.camera_error = self.stream.error or (
                f"Camera {index} failed to open."
            )
            return
        self.camera_error = ""
        self.settings.camera_index = index
        self.settings.save()
        self._update_engine_label()

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
        self._render(frame)
        self.root.after(25, self._tick)

    def _render(self, frame) -> None:
        display = frame.copy()
        height, width = display.shape[:2]

        waiting = {
            "WAIT_FRONT": "Front cover", "WAIT_BACK": "Back cover",
            "WAIT_SPINE": "Spine",
        }
        if self.state in waiting:
            # Focus matters more than anything else for reading an ISBN, so
            # say so plainly instead of hiding it in a log.
            small = cv2.resize(display, (640, int(640 * height / width)))
            if sharpness(small) < self.settings.min_sharpness:
                message = "Soft focus: steady the book, or move it slightly"
                colour = (0, 140, 255)
            else:
                message = f"{waiting[self.state]}: press SPACE"
                colour = (60, 220, 60)
        elif self.state == "PROCESSING":
            message, colour = "Reading...", (200, 200, 90)
        else:
            message, colour = "Reviewing", (170, 170, 170)
        self._banner(display, message, colour)

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
            interpolation=cv2.INTER_AREA,
        )
        image = Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))
        self._preview_image = ImageTk.PhotoImage(image)
        self.preview.configure(image=self._preview_image, text="")

    @staticmethod
    def _banner(image, text: str, colour) -> None:
        scale = max(0.6, image.shape[1] / 1600.0)
        bar = int(44 * scale)
        cv2.rectangle(image, (0, 0), (image.shape[1], bar), (20, 20, 24), -1)
        cv2.putText(
            image, text, (14, int(bar * 0.72)), cv2.FONT_HERSHEY_SIMPLEX,
            0.8 * scale, colour, max(1, int(2 * scale)), cv2.LINE_AA,
        )

    def _show_placeholder(self, message: str) -> None:
        self.preview.configure(
            image="", text=message, foreground="#cccccc",
            font=("Segoe UI", 12), wraplength=560, justify="center",
        )
        self._preview_image = None

    # ------------------------------------------------------------------
    # Capture
    # ------------------------------------------------------------------

    def manual_capture(self) -> None:
        if self.state not in ("WAIT_FRONT", "WAIT_BACK", "WAIT_SPINE"):
            return
        frame = self.stream.read()
        if frame is None:
            return
        self._capture(frame)

    def _capture(self, frame: np.ndarray) -> None:
        slot = {"WAIT_FRONT": "front", "WAIT_BACK": "back",
                "WAIT_SPINE": "spine"}.get(self.state)
        if slot is None:
            return
        if self.settings.beep_on_capture:
            _beep()

        self.frames[slot] = frame.copy()
        self._set_thumb(slot, frame)
        self._advance_capture()

    def _advance_capture(self) -> None:
        """Move to the next missing capture, or start recognition."""
        for slot in ("front", "back", "spine"):
            if self.frames[slot] is None:
                self._set_state(f"WAIT_{slot.upper()}")
                return
        self._start_processing()

    def spine_key(self) -> None:
        """S skips the spine while capturing, and retakes it while reviewing."""
        if self.state == "WAIT_SPINE":
            self.skip_spine()
        elif self.state == "REVIEW":
            self.retake("spine")

    def skip_spine(self) -> None:
        if self.state != "WAIT_SPINE":
            return
        self._start_processing()

    def _set_thumb(self, slot: str, frame) -> None:
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        image.thumbnail(
            (self.settings.thumb_width,
             int(self.settings.thumb_width * 0.72)),
            Image.LANCZOS,
        )
        photo = ImageTk.PhotoImage(image)
        self.thumb_labels[slot].configure(image=photo)
        self._thumb_images[slot] = photo

    def _clear_thumb(self, slot: str) -> None:
        self.thumb_labels[slot].configure(image="")
        self._thumb_images[slot] = None

    # ------------------------------------------------------------------
    # Recognition and lookup
    # ------------------------------------------------------------------

    def _start_processing(self) -> None:
        self._set_state("PROCESSING")
        front, back = self.frames["front"], self.frames["back"]
        threading.Thread(
            target=self._process, args=(front, back), daemon=True
        ).start()

    def _process(self, front, back) -> None:
        """Runs off the UI thread: barcode, OCR, then the online lookup."""
        try:
            found = recognize(front, back, self.settings)
            record = BookRecord()
            if self.settings.lookup_enabled:
                if found.isbn13 or found.isbn10:
                    record = lookup_isbn(found.isbn13 or found.isbn10,
                                         self.settings.lookup_timeout)
                elif found.title_guess:
                    record = search_title(found.title_guess,
                                          self.settings.lookup_timeout)
            self._results.put(("recognize", found, record, None))
        except Exception as exc:  # keep a bad frame from killing the session
            self._results.put(("recognize", None, None, exc))

    def focus_isbn(self) -> None:
        """Put the caret in the ISBN box, ready to type or to scan into."""
        self._focus_entry(self.entries["isbn13"])

    def focus_area(self) -> None:
        """Put the caret in the area box, for after the book is shelved."""
        self._focus_entry(self.area_entry)

    def _focus_entry(self, entry) -> None:
        if self.state != "REVIEW":
            return
        entry.focus_set()
        entry.select_range(0, tk.END)
        entry.icursor(tk.END)

    def lookup_now(self) -> None:
        """Look up whatever is in the fields right now.

        Driven by the Look up button, by Ctrl+L, and by Enter in the ISBN
        box, which is also what a USB barcode scanner sends after the digits.
        """
        if self.state != "REVIEW" or self._busy:
            return

        typed = (self.vars["isbn13"].get().strip()
                 or self.vars["isbn10"].get().strip())
        title = self.vars["title"].get().strip()

        isbn13, isbn10 = normalise_isbn(typed)
        if typed and not isbn13:
            self.warning_label.configure(
                text=f'"{typed}" is not a valid ISBN. Check the digits, or '
                     "clear the field to search by title instead."
            )
            return
        if not isbn13 and not title:
            self.warning_label.configure(
                text="Type an ISBN, or a title, then look up."
            )
            return

        self._busy = True
        self.lookup_button.configure(text="Looking up...")
        self.warning_label.configure(text="")
        self.root.focus_set()
        threading.Thread(
            target=self._lookup_worker, args=(isbn13, isbn10, title),
            daemon=True,
        ).start()

    def _lookup_worker(self, isbn13: str, isbn10: str, title: str) -> None:
        try:
            if isbn13:
                record = lookup_isbn(isbn13, self.settings.lookup_timeout)
            else:
                record = search_title(title, self.settings.lookup_timeout)
            self._results.put(("lookup", (isbn13, isbn10), record, None))
        except Exception as exc:
            self._results.put(("lookup", (isbn13, isbn10), None, exc))

    def _drain_results(self) -> None:
        try:
            kind, payload, record, error = self._results.get_nowait()
        except queue.Empty:
            return

        if kind == "recognize":
            if error is not None:
                messagebox.showerror("Recognition failed", str(error))
                self.recognition = Recognition()
                self.book = BookRecord()
            else:
                self.recognition = payload
                self.book = record
            self._set_state("REVIEW")
            self._populate_review()
            return

        # A manual or re-run lookup.
        self._busy = False
        self.lookup_button.configure(text="Look up  (Ctrl+L)")
        if error is not None:
            self.warning_label.configure(text=f"Lookup failed: {error}")
            return

        isbn13, isbn10 = payload
        if self.recognition is not None and isbn13:
            self.recognition.isbn13 = isbn13
            self.recognition.isbn10 = isbn10
            if self.recognition.isbn_source in ("", "ocr"):
                self.recognition.isbn_source = "manual"
        self.book = record
        self._apply_record(record, keep_typed_isbn=(isbn13, isbn10))
        self.update_placement()

    def _apply_record(self, record: BookRecord,
                      keep_typed_isbn: tuple[str, str] | None = None) -> None:
        """Fill the record fields from a catalogue result."""
        found = self.recognition or Recognition()

        if keep_typed_isbn and keep_typed_isbn[0]:
            isbn13, isbn10 = keep_typed_isbn
        else:
            isbn13 = record.isbn13 or found.isbn13
            isbn10 = record.isbn10 or found.isbn10

        if record.found:
            self.vars["title"].set(record.title)
            self.vars["authors"].set(record.authors)
            self.vars["publisher"].set(record.publisher)
            self.vars["published"].set(record.published)
            self.vars["pages"].set(record.pages)
            self.vars["subjects"].set(record.subjects)
            if record.series:
                self.vars["series"].set(record.series)
            if record.series_number:
                self.vars["series_number"].set(record.series_number)
            self.vars["sort_author"].set(author_sort_name(record.authors))
            self.fiction_var.set(guess_fiction(record.subjects, record.title))
        else:
            # Do not wipe what the operator has already typed.
            if not self.vars["title"].get().strip():
                self.vars["title"].set(found.title_guess or "")

        self.vars["isbn13"].set(isbn13)
        self.vars["isbn10"].set(isbn10)

        bits = []
        if found.isbn_source:
            bits.append(f"ISBN from {found.isbn_source}")
        bits.append(
            f"matched via {record.source}" if record.found
            else "no catalogue match"
        )
        self.source_label.configure(text="  |  ".join(bits))

        warnings = list(record.notes)
        if not record.found:
            warnings.append("Nothing found. Check the ISBN and look up again.")

        self.duplicate_of = None
        existing = self.store.find_by_isbn(isbn13)
        if existing is not None:
            self.duplicate_of = int(existing["id"])
            warnings.insert(
                0,
                f'Already scanned as #{existing["id"]}: {existing["title"]} '
                f'at {existing["shelf"] or "?"}-{existing["area"] or "?"}'
            )
        self.warning_label.configure(text="  ".join(warnings)[:400])

    def _populate_review(self) -> None:
        found = self.recognition or Recognition()
        record = self.book or BookRecord()

        for var in self.vars.values():
            var.set("")
        self.shelf_var.set("")
        self.area_var.set("")
        self.fiction_var.set(True)

        # _apply_record fills the fields and reports the record's own notes
        # plus any duplicate. Prepend what the recogniser wants to say.
        self._apply_record(record)
        if found.notes:
            already = self.warning_label.cget("text")
            combined = list(found.notes) + ([already] if already else [])
            self.warning_label.configure(text="  ".join(combined)[:400])

        self.update_placement()

        # Land the caret where the operator is most likely to need it.
        if not self.vars["isbn13"].get().strip():
            self.focus_isbn()
        elif not self.vars["title"].get().strip():
            self._focus_entry(self.entries["title"])

    # ------------------------------------------------------------------
    # Shelving
    # ------------------------------------------------------------------

    def update_placement(self) -> None:
        """Work out which two shelved books this one belongs between."""
        if self.state != "REVIEW":
            return

        surname = (self.vars["sort_author"].get().strip()
                   or author_sort_name(self.vars["authors"].get()))
        self.vars["sort_author"].set(surname)

        is_fiction = bool(self.fiction_var.get())
        shelves = list(
            self.settings.fiction_shelves if is_fiction
            else self.settings.nonfiction_shelves
        )
        key = sort_key(
            surname,
            self.vars["series"].get(),
            self.vars["series_number"].get(),
            self.vars["title"].get(),
        )
        placement = plan_placement(
            self.store.placed_books(shelves), key, is_fiction,
            self.settings.fiction_shelves, self.settings.nonfiction_shelves,
        )
        self.placement = placement
        self.shelf_var.set(placement.shelf)
        self._render_placement(placement)

    def _render_placement(self, placement: Placement) -> None:
        if not self.vars["title"].get().strip() and not self.vars["authors"].get().strip():
            self.place_headline.configure(
                text="Identify the book first, then this will show where it goes."
            )
            self.place_note.configure(text="")
            for side in ("previous", "following"):
                self._set_neighbour(side, None)
            return

        self.place_headline.configure(text=placement.headline)

        notes = [
            f"{placement.section}, so it belongs on "
            f"{' / '.join(placement.shelves)}.",
            f"Position {placement.position + 1} of {placement.total + 1} "
            f"in this section.",
        ]
        if placement.at_boundary:
            notes.append(
                f"These two sit on different shelves "
                f"({placement.previous['shelf']} and "
                f"{placement.following['shelf']}). Suggesting "
                f"{placement.shelf}; move it to the next shelf if that one "
                f"is full."
            )
        self.place_note.configure(text="  ".join(notes))

        self._set_neighbour("previous", placement.previous)
        self._set_neighbour("following", placement.following)

    def _set_neighbour(self, side: str, row) -> None:
        label = self.neighbour_labels[side]
        caption = self.neighbour_captions[side]

        if row is None:
            label.configure(image="", text="(nothing on this side)")
            self._neighbour_images[side] = None
            caption.configure(text="")
            return

        caption.configure(
            text=f'{row["title"]}\n{row["authors"] or row["sort_author"]}\n'
                 f'{row["shelf"] or "?"} - {row["area"] or "?"}'
        )

        photo = self._load_shelf_photo(row)
        if photo is None:
            label.configure(image="", text="(no spine photo)")
            self._neighbour_images[side] = None
        else:
            label.configure(image=photo, text="")
            self._neighbour_images[side] = photo

    def _load_shelf_photo(self, row) -> ImageTk.PhotoImage | None:
        """The spine if we have one, otherwise the front cover."""
        for column in ("spine_image", "front_image"):
            try:
                path = row[column]
            except (KeyError, IndexError, TypeError):
                continue
            if not path:
                continue
            file = Path(path)
            if not file.exists():
                continue
            try:
                image = Image.open(file)
                image.thumbnail((220, 248), Image.LANCZOS)
                return ImageTk.PhotoImage(image)
            except Exception:
                continue
        return None

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
            self._focus_entry(self.entries["title"])
            return

        shelf = self.shelf_var.get().strip()
        area = self.area_var.get().strip().upper()
        if not shelf or not area:
            if not messagebox.askyesno(
                "No shelf position",
                "This book has no shelf and area recorded.\n\n"
                "It will be saved, but it will not be used as a landmark "
                "when placing later books until you fill those in.\n\n"
                "Save anyway?",
            ):
                self.focus_area()
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
        params = [int(cv2.IMWRITE_JPEG_QUALITY), self.settings.jpeg_quality]

        paths: dict[str, str] = {}
        for slot in ("front", "back", "spine"):
            frame = self.frames[slot]
            if frame is None:
                paths[slot] = ""
                continue
            path = CAPTURE_DIR / f"{stamp}_{slug}_{slot}.jpg"
            cv2.imwrite(str(path), frame, params)
            paths[slot] = str(path)

        found = self.recognition or Recognition()
        record = self.book or BookRecord()
        self.store.add_book({
            "isbn13": isbn13,
            "isbn10": self.vars["isbn10"].get().strip(),
            "title": title,
            "authors": self.vars["authors"].get().strip(),
            "sort_author": (self.vars["sort_author"].get().strip()
                            or author_sort_name(self.vars["authors"].get())),
            "series": self.vars["series"].get().strip(),
            "series_number": self.vars["series_number"].get().strip(),
            "publisher": self.vars["publisher"].get().strip(),
            "published": self.vars["published"].get().strip(),
            "pages": self.vars["pages"].get().strip(),
            "subjects": self.vars["subjects"].get().strip(),
            "notes": self.vars["notes"].get().strip(),
            "shelf": shelf,
            "area": area,
            "placed_at": (datetime.now().isoformat(timespec="seconds")
                          if shelf and area else ""),
            "is_fiction": 1 if self.fiction_var.get() else 0,
            "isbn_source": found.isbn_source,
            "lookup_source": record.source,
            "front_image": paths["front"],
            "back_image": paths["back"],
            "spine_image": paths["spine"],
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
        if self.state == "WAIT_FRONT" and self.frames["front"] is None:
            return
        self._reset_book()

    def retake(self, which: str) -> None:
        if self.state not in ("REVIEW", "WAIT_BACK", "WAIT_SPINE"):
            return
        slots = ("front", "back", "spine") if which == "all" else (which,)
        for slot in slots:
            if slot in self.frames:
                self.frames[slot] = None
                self._clear_thumb(slot)
        self._advance_capture()

    def _reset_book(self) -> None:
        for slot in ("front", "back", "spine"):
            self.frames[slot] = None
            self._clear_thumb(slot)
        self.recognition = None
        self.book = None
        self.placement = None
        self.duplicate_of = None
        self._busy = False
        for var in self.vars.values():
            var.set("")
        self.shelf_var.set("")
        self.area_var.set("")
        self.fiction_var.set(True)
        self.source_label.configure(text="")
        self.warning_label.configure(text="")
        self.lookup_button.configure(text="Look up  (Ctrl+L)")
        self.place_headline.configure(text="")
        self.place_note.configure(text="")
        for side in ("previous", "following"):
            self._set_neighbour(side, None)
        self.root.focus_set()
        self._set_state("WAIT_FRONT")

    # ------------------------------------------------------------------
    # State and status
    # ------------------------------------------------------------------

    def _set_state(self, state: str) -> None:
        self.state = state
        prompts = {
            "WAIT_FRONT": "Hold up the FRONT cover, then press SPACE",
            "WAIT_BACK": "Turn it over, then press SPACE for the BACK",
            "WAIT_SPINE": "Now the SPINE. Press SPACE, or S to skip it",
            "PROCESSING": "Reading barcode and looking the book up...",
            "REVIEW": "Shelve it, type the area, then press the RIGHT ARROW",
        }
        self.prompt_label.configure(text=prompts.get(state, ""))

        buttons = {
            "WAIT_FRONT": "Capture front cover  (Space)",
            "WAIT_BACK": "Capture back cover  (Space)",
            "WAIT_SPINE": "Capture spine  (Space)    |    skip with S",
            "PROCESSING": "Working...",
            "REVIEW": "Save and next  (Right arrow)",
        }
        self.capture_button.configure(
            text=buttons.get(state, ""),
            command=self.accept if state == "REVIEW" else self.manual_capture,
            state="disabled" if state == "PROCESSING" else "normal",
        )

        editable = "normal" if state == "REVIEW" else "disabled"
        for entry in self.entries.values():
            entry.configure(state=editable)
        self.lookup_button.configure(state=editable)
        self.area_entry.configure(state=editable)
        self.fiction_check.configure(state=editable)
        self.shelf_box.configure(
            state="readonly" if state == "REVIEW" else "disabled"
        )

    def _update_counts(self) -> None:
        total = self.store.count()
        placed = len(self.store.placed_books())
        self.count_label.configure(
            text=f"{total} book{'' if total == 1 else 's'}, {placed} shelved"
        )

    def _update_engine_label(self) -> None:
        from .recognize import ZBAR_AVAILABLE

        parts = [
            "barcode: on" if ZBAR_AVAILABLE else "barcode: OFF",
            "OCR: on" if self.ocr_available else "OCR: OFF",
            f"db v{self.store.schema_version}",
        ]
        width, height = self.stream.actual_size
        if width:
            parts.append(f"{width}x{height}")
        self.engine_label.configure(text="   ".join(parts))

    # ------------------------------------------------------------------

    def show_diagnostics(self) -> None:
        """Everything the recogniser saw on the last book, verbatim."""
        from .recognize import ZBAR_AVAILABLE, ZBAR_ERROR

        found = self.recognition
        width, height = self.stream.actual_size

        lines = [
            "ENVIRONMENT",
            f"  Tesseract   : {self.ocr_message}",
            "  Barcode     : "
            + ("available" if ZBAR_AVAILABLE else f"NOT available ({ZBAR_ERROR})"),
            f"  Camera      : {self.camera_box.get() or 'none'}"
            f"  [{self.stream.backend or 'not open'}]",
            f"  Resolution  : {width}x{height}"
            + ("  (low resolution makes ISBN OCR much harder)"
               if width and width < 1280 else ""),
            f"  Catalogue   : {DB_PATH}  (schema v{self.store.schema_version})",
            "",
            "SHELVES",
        ]
        summary = self.store.shelf_summary()
        if not summary:
            lines.append("  Nothing shelved yet.")
        for shelf, area, count in summary:
            lines.append(f"  {shelf}-{area or '?':<4} {count} book(s)")
        lines.append("")

        if found is None:
            lines.append("No book has been processed yet in this session.")
        else:
            lines.append("LAST BOOK")
            lines.append(f"  ISBN-13     : {found.isbn13 or '(none)'}")
            lines.append(f"  ISBN-10     : {found.isbn10 or '(none)'}")
            lines.append(f"  ISBN source : {found.isbn_source or '(none)'}")
            lines.append(f"  Title guess : {found.title_guess or '(none)'}")
            lines.append(f"  Raw barcodes: {', '.join(found.barcodes) or '(none)'}")
            lines.append(f"  Files under : {self.vars['sort_author'].get() or '(none)'}")
            lines.append("")
            lines.append("WHAT WAS TRIED")
            for attempt in found.attempts:
                lines.append(f"  {attempt}")
            lines.append("")
            lines.append("FRONT COVER OCR TEXT")
            lines.append(found.front_text.strip() or "  (nothing read)")
            lines.append("")
            lines.append("BACK COVER OCR TEXT")
            lines.append(found.back_text.strip() or "  (nothing read)")

        window = tk.Toplevel(self.root)
        window.title("Diagnostics")
        window.geometry("880x660")
        frame = ttk.Frame(window, padding=8)
        frame.pack(fill=tk.BOTH, expand=True)
        text = tk.Text(frame, wrap="word", font=("Consolas", 9))
        scroll = ttk.Scrollbar(frame, command=text.yview)
        text.configure(yscrollcommand=scroll.set)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        text.insert("1.0", "\n".join(lines))
        text.configure(state="disabled")
        ttk.Button(window, text="Close", command=window.destroy).pack(pady=6)

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
        messagebox.showinfo("Export complete",
                            f"Wrote {written} books to\n{path}")
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
