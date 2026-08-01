"""Reading an ISBN and a title off the captured images.

Order of preference, as agreed: decode the barcode if one is visible, fall
back to OCR of the printed ISBN if not, and use OCR of the front cover as a
title candidate for the online lookup to confirm.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .config import Settings

try:
    from pyzbar import pyzbar

    ZBAR_AVAILABLE = True
    ZBAR_ERROR = ""
except Exception as exc:  # pragma: no cover - depends on local install
    pyzbar = None
    ZBAR_AVAILABLE = False
    ZBAR_ERROR = str(exc)

try:
    import pytesseract

    TESSERACT_IMPORTED = True
except Exception:  # pragma: no cover - depends on local install
    pytesseract = None
    TESSERACT_IMPORTED = False


# Lines that show up on nearly every cover and are never the title.
_TITLE_NOISE = re.compile(
    r"^(a\s+novel|a\s+memoir|new\s+york\s+times|#?\s*1\s+bestseller|"
    r"bestselling\s+author|national\s+bestseller|international\s+bestseller|"
    r"winner\s+of.*|author\s+of.*|with\s+a\s+new.*|now\s+a\s+major.*)$",
    re.IGNORECASE,
)

_ISBN13_RE = re.compile(r"(97[89][\s\-]?(?:\d[\s\-]?){10})")
_ISBN10_RE = re.compile(r"(?<!\d)((?:\d[\s\-]?){9}[\dXx])(?!\d)")


@dataclass
class Recognition:
    isbn13: str = ""
    isbn10: str = ""
    isbn_source: str = ""  # "barcode" | "ocr" | ""
    title_guess: str = ""
    barcodes: list[str] = field(default_factory=list)
    front_text: str = ""
    back_text: str = ""
    notes: list[str] = field(default_factory=list)


# Where the Windows installers put tesseract.exe. Checked because a fresh
# install does not reach an already-running shell's PATH.
_TESSERACT_FALLBACKS = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)


def configure_tesseract(settings: Settings) -> tuple[bool, str]:
    """Point pytesseract at the binary. Returns (available, message)."""
    if not TESSERACT_IMPORTED:
        return False, "pytesseract is not installed."

    candidates = []
    if settings.tesseract_cmd:
        candidates.append(settings.tesseract_cmd)
    candidates.append("tesseract")  # whatever is on PATH
    candidates.extend(_TESSERACT_FALLBACKS)

    for candidate in candidates:
        if candidate not in ("tesseract",) and not Path(candidate).exists():
            continue
        pytesseract.pytesseract.tesseract_cmd = candidate
        try:
            version = pytesseract.get_tesseract_version()
        except Exception:
            continue
        return True, f"Tesseract {version}"

    return False, (
        "Tesseract binary not found. Barcode scanning still works; install "
        "Tesseract to read titles and printed ISBNs."
    )


# --------------------------------------------------------------------------
# ISBN helpers
# --------------------------------------------------------------------------


def _digits(value: str) -> str:
    return re.sub(r"[^0-9Xx]", "", value).upper()


def valid_isbn13(value: str) -> bool:
    value = _digits(value)
    if len(value) != 13 or not value.isdigit():
        return False
    total = sum(
        int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(value[:12])
    )
    return (10 - total % 10) % 10 == int(value[12])


def valid_isbn10(value: str) -> bool:
    value = _digits(value)
    if len(value) != 10:
        return False
    total = 0
    for i, char in enumerate(value[:9]):
        if not char.isdigit():
            return False
        total += int(char) * (10 - i)
    check = value[9]
    total += 10 if check == "X" else (int(check) if check.isdigit() else -1000)
    return total % 11 == 0


def isbn10_to_13(value: str) -> str:
    value = _digits(value)
    if len(value) != 10:
        return ""
    core = "978" + value[:9]
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(core))
    return core + str((10 - total % 10) % 10)


def isbn13_to_10(value: str) -> str:
    value = _digits(value)
    if len(value) != 13 or not value.startswith("978"):
        return ""
    core = value[3:12]
    total = sum(int(d) * (10 - i) for i, d in enumerate(core))
    check = (11 - total % 11) % 11
    return core + ("X" if check == 10 else str(check))


# --------------------------------------------------------------------------
# Barcode
# --------------------------------------------------------------------------


def decode_barcodes(image: np.ndarray) -> list[str]:
    """Decode any barcodes in the image, most reliable variant first."""
    if not ZBAR_AVAILABLE or image is None:
        return []

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    attempts = [gray]
    # Upscaling rescues small or distant barcodes.
    attempts.append(cv2.resize(gray, None, fx=2.0, fy=2.0,
                               interpolation=cv2.INTER_CUBIC))
    # Thresholding rescues low-contrast or glossy covers.
    attempts.append(
        cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                              cv2.THRESH_BINARY, 31, 10)
    )
    # A book held sideways still has a readable barcode once rotated.
    attempts.append(cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE))

    found: list[str] = []
    for attempt in attempts:
        try:
            results = pyzbar.decode(attempt)
        except Exception:
            continue
        for result in results:
            try:
                data = result.data.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue
            # EAN-2 and EAN-5 are the price add-on strips, not the ISBN.
            if len(data) < 8:
                continue
            if data not in found:
                found.append(data)
        if found:
            break
    return found


# --------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------


def _preprocess_for_ocr(image: np.ndarray, max_width: int = 1600) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if width > max_width:
        scale = max_width / float(width)
        gray = cv2.resize(gray, (max_width, int(height * scale)),
                          interpolation=cv2.INTER_AREA)
    elif width < 900:
        gray = cv2.resize(gray, None, fx=2.0, fy=2.0,
                          interpolation=cv2.INTER_CUBIC)
    # CLAHE evens out the lighting across a glossy cover better than a plain
    # histogram equalisation does.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def ocr_text(image: np.ndarray) -> str:
    if not TESSERACT_IMPORTED or image is None:
        return ""
    try:
        return pytesseract.image_to_string(_preprocess_for_ocr(image))
    except Exception:
        return ""


def ocr_title_guess(image: np.ndarray) -> str:
    """Pick the most title-looking line off a front cover.

    Titles are set larger than everything else on the cover, so we group the
    OCR words into lines and score each line by the height of its glyphs.
    """
    if not TESSERACT_IMPORTED or image is None:
        return ""
    try:
        data = pytesseract.image_to_data(
            _preprocess_for_ocr(image), output_type=pytesseract.Output.DICT
        )
    except Exception:
        return ""

    lines: dict[tuple, list] = {}
    for i, word in enumerate(data.get("text", [])):
        word = (word or "").strip()
        if not word:
            continue
        try:
            confidence = float(data["conf"][i])
        except (ValueError, TypeError, KeyError):
            continue
        if confidence < 40:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append((word, data["height"][i]))

    scored: list[tuple[float, str]] = []
    for words in lines.values():
        text = " ".join(w for w, _ in words).strip()
        text = re.sub(r"\s+", " ", text)
        if len(text) < 3 or _TITLE_NOISE.match(text):
            continue
        if not re.search(r"[A-Za-z]", text):
            continue
        mean_height = sum(h for _, h in words) / len(words)
        # Height dominates, with a mild bonus for longer lines so that a big
        # single stray letter does not beat a real multi-word title.
        scored.append((mean_height * (1.0 + 0.10 * len(words)), text))

    if not scored:
        return ""
    scored.sort(reverse=True)
    return scored[0][1]


# --------------------------------------------------------------------------
# Top level
# --------------------------------------------------------------------------


def recognize(front: np.ndarray, back: np.ndarray,
              settings: Settings) -> Recognition:
    """Barcode first, OCR second. Never raises."""
    result = Recognition()

    # 1. Barcodes. The back cover normally carries it, but check both.
    for image, where in ((back, "back"), (front, "front")):
        for code in decode_barcodes(image):
            if code not in result.barcodes:
                result.barcodes.append(code)
        if result.barcodes:
            result.notes.append(f"Barcode found on {where} cover.")
            break

    for code in result.barcodes:
        digits = _digits(code)
        if valid_isbn13(digits):
            result.isbn13 = digits
            result.isbn10 = isbn13_to_10(digits)
            result.isbn_source = "barcode"
            break
        if valid_isbn10(digits):
            result.isbn10 = digits
            result.isbn13 = isbn10_to_13(digits)
            result.isbn_source = "barcode"
            break

    if not ZBAR_AVAILABLE:
        result.notes.append("Barcode decoding unavailable: " + ZBAR_ERROR)

    # 2. OCR. Always run it for the title, and for the ISBN if the barcode
    #    did not give us one.
    if settings.ocr_enabled and TESSERACT_IMPORTED:
        result.back_text = ocr_text(back)
        result.front_text = ocr_text(front)
        result.title_guess = ocr_title_guess(front)

        if not result.isbn13:
            combined = result.back_text + "\n" + result.front_text
            for match in _ISBN13_RE.finditer(combined):
                candidate = _digits(match.group(1))
                if valid_isbn13(candidate):
                    result.isbn13 = candidate
                    result.isbn10 = isbn13_to_10(candidate)
                    result.isbn_source = "ocr"
                    break
            if not result.isbn13:
                for match in _ISBN10_RE.finditer(combined):
                    candidate = _digits(match.group(1))
                    if valid_isbn10(candidate):
                        result.isbn10 = candidate
                        result.isbn13 = isbn10_to_13(candidate)
                        result.isbn_source = "ocr"
                        break
            if result.isbn13:
                result.notes.append("No barcode, ISBN read by OCR.")

    if not result.isbn13 and not result.isbn10:
        result.notes.append("No ISBN found. Check the title and type it in.")

    return result
