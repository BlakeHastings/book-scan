"""Tunable settings.

Everything worth adjusting while scanning a real shelf lives here. Drop a
settings.json next to run.py to override any field without touching code.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CAPTURE_DIR = PROJECT_ROOT / "captures"
DB_PATH = PROJECT_ROOT / "books.db"
# Automatic pre-migration copies land here, and are never pruned.
BACKUP_DIR = PROJECT_ROOT / "backups"
CSV_PATH = PROJECT_ROOT / "books.csv"
SETTINGS_PATH = PROJECT_ROOT / "settings.json"


@dataclass
class Settings:
    # --- Camera ---------------------------------------------------------
    camera_index: int = 0
    # ISBN print is small. At 720p the digits on a back cover land around ten
    # pixels tall, which is below what Tesseract can read, so ask for as much
    # resolution as the camera will give. It falls back on its own if the
    # camera cannot do this.
    frame_width: int = 1920
    frame_height: int = 1080

    # --- Capture --------------------------------------------------------
    # Variance of the Laplacian. Below this the preview warns that the shot
    # is too soft to read an ISBN from. It never blocks a capture.
    min_sharpness: float = 45.0

    # --- Recognition ----------------------------------------------------
    # Leave blank to use whatever tesseract.exe is on PATH.
    tesseract_cmd: str = ""
    ocr_enabled: bool = True

    # --- Online lookup --------------------------------------------------
    lookup_enabled: bool = True
    lookup_timeout: float = 8.0
    # Optional. Open Library does the real work; Google Books is only a
    # top-up and rate-limits anonymous callers, so a key is nice to have and
    # never required.
    google_api_key: str = ""

    # --- Shelving -------------------------------------------------------
    # Fiction fills these in order; non-fiction lives on its own shelf.
    fiction_shelves: tuple = ("S1", "S2", "S3")
    nonfiction_shelves: tuple = ("S4",)

    # --- Interface ------------------------------------------------------
    preview_width: int = 760
    thumb_width: int = 208
    beep_on_capture: bool = True
    jpeg_quality: int = 92

    @classmethod
    def load(cls) -> "Settings":
        settings = cls()
        if SETTINGS_PATH.exists():
            try:
                raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return settings
            known = {f.name for f in fields(cls)}
            for key, value in raw.items():
                if key not in known:
                    continue
                # JSON has no tuples, so shelf lists come back as lists.
                if isinstance(getattr(settings, key), tuple):
                    value = tuple(value)
                setattr(settings, key, value)
        return settings

    def save(self) -> None:
        SETTINGS_PATH.write_text(
            json.dumps(asdict(self), indent=2), encoding="utf-8"
        )
