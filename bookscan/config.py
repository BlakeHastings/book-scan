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
    frame_width: int = 1280
    frame_height: int = 720

    # --- Detection ------------------------------------------------------
    # Detection runs on a downscaled copy of each frame for speed.
    detect_width: int = 640

    # A candidate must fill at least this fraction of the frame to count as
    # a book held up, and no more than this much (that is a hand over the
    # lens, not a book).
    min_area_ratio: float = 0.10
    max_area_ratio: float = 0.92

    # Width divided by height, permissive enough for a tilted paperback and
    # for a landscape coffee-table book.
    min_aspect: float = 0.35
    max_aspect: float = 1.70

    # Variance of the Laplacian. Below this the frame is too blurry to keep,
    # which is what stops us saving a photo mid-flip.
    min_sharpness: float = 45.0

    # How still, and for how long, before the shutter fires.
    stable_frames: int = 14
    center_tolerance: float = 0.030  # as a fraction of frame width
    area_tolerance: float = 0.10  # as a fraction of the running mean area

    # After a capture, stay disarmed until the scene has visibly changed, so
    # one steady book cannot be photographed twice in a row.
    rearm_frames: int = 8
    rearm_diff: float = 18.0
    cooldown_seconds: float = 1.2

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

    # --- Interface ------------------------------------------------------
    preview_width: int = 820
    thumb_width: int = 330
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
                if key in known:
                    setattr(settings, key, value)
        return settings

    def save(self) -> None:
        SETTINGS_PATH.write_text(
            json.dumps(asdict(self), indent=2), encoding="utf-8"
        )
