"""Reading an ISBN and a title off the captured images.

Order of preference: decode the barcode if one is visible, fall back to OCR
of the printed ISBN if not, and use OCR of the front cover as a title
candidate. Whatever comes out, the operator can correct it by hand.

The hard part is that ISBN print is small. On a book held at arm's length in
a 1080p frame the digits are only a dozen or so pixels tall, which is below
what Tesseract reliably reads. So instead of one OCR pass, this module walks
a short ladder of increasingly aggressive attempts (crop to the lower part of
the cover, upscale, binarise, restrict to digits) and stops at the first one
that produces a checksum-valid ISBN.
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
    from pyzbar.pyzbar import ZBarSymbol

    ZBAR_AVAILABLE = True
    ZBAR_ERROR = ""
except Exception as exc:  # pragma: no cover - depends on local install
    pyzbar = None
    ZBarSymbol = None
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
    r"^(a\s+novel|a\s+memoir|fiction|non[-\s]?fiction|a\s+story|"
    r"new\s+york\s+times|#?\s*1\s+bestseller|bestselling\s+author|"
    r"national\s+bestseller|international\s+bestseller|winner\s+of.*|"
    r"author\s+of.*|with\s+a\s+new.*|now\s+a\s+major.*|"
    r"illustrated\s+by.*|translated\s+by.*)$",
    re.IGNORECASE,
)

# Characters Tesseract routinely swaps for digits. Aggressive substitution is
# safe here only because every candidate is checksum-validated afterwards.
_CONFUSIONS = str.maketrans({
    "O": "0", "o": "0", "D": "0", "Q": "0", "U": "0",
    "I": "1", "l": "1", "i": "1", "|": "1", "!": "1", "[": "1", "]": "1",
    "Z": "2", "z": "2",
    "A": "4",
    "S": "5", "s": "5",
    "G": "6", "b": "6",
    "T": "7", "?": "7",
    "B": "8",
    "g": "9", "q": "9",
})

# "ISBN", "ISBN-13:", "1SBN 13", and similar, followed by the number itself.
#
# The character classes below match spaces and tabs but deliberately NOT
# newlines. An ISBN is printed on one line, whereas the five digit price
# code sits on its own line just below it. Allowing \s here let the two run
# together into an eighteen digit string, and sliding a window along that
# eventually finds a different number with a valid check digit, which is
# exactly how a wrong ISBN gets saved without anyone noticing.
_DIGITISH = r"0-9OoDQUIiLlZzASsGbTB"
_LABEL_RE = re.compile(
    r"[I1l|]SBN[ \t]*(?:[-\t ]*1[03])?[ \t]*[:.\-]?[ \t]*"
    rf"([{_DIGITISH}!|\[\]]"
    rf"[{_DIGITISH}!|\[\]Xx\-\u2010-\u2015 \t]{{8,24}})",
    re.IGNORECASE,
)

# Any run that could plausibly be a long number, confusable letters included.
_RUN_RE = re.compile(
    rf"[{_DIGITISH}]"
    rf"[{_DIGITISH}Xx\-\u2010-\u2015 \t]{{8,24}}"
    r"[0-9Xx]"
)

# How far along a run of digits we may slide when looking for a 13 digit
# ISBN. Zero means the number has to start where the run starts.
#
# Measured, not guessed: on deliberately degraded frames, allowing any slide
# at all produced silently wrong ISBNs, because a misread digit invalidates
# the real number while some shifted window still passes the check digit.
# Going from a tolerance of three to zero removed every wrong reading in the
# test corpus and cost no correct ones.
_MAX_WINDOW_OFFSET = 0


@dataclass
class Recognition:
    isbn13: str = ""
    isbn10: str = ""
    isbn_source: str = ""  # "barcode" | "ocr" | "manual" | ""
    title_guess: str = ""
    barcodes: list[str] = field(default_factory=list)
    front_text: str = ""
    back_text: str = ""
    notes: list[str] = field(default_factory=list)
    # An ISBN that OCR saw once but could not confirm. Offered as a
    # suggestion only, never written into the record automatically.
    unconfirmed_isbn: str = ""
    # What the ladder actually tried, so the operator can see whether OCR is
    # alive at all rather than guessing.
    attempts: list[str] = field(default_factory=list)


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
        if candidate != "tesseract" and not Path(candidate).exists():
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
# ISBN validation and conversion
# --------------------------------------------------------------------------


def _digits(value: str) -> str:
    return re.sub(r"[^0-9Xx]", "", value or "").upper()


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


def normalise_isbn(value: str) -> tuple[str, str]:
    """Take anything the operator typed or a scanner sent, return
    (isbn13, isbn10). Empty strings if it is not a valid ISBN."""
    digits = _digits(str(value).translate(_CONFUSIONS))
    if valid_isbn13(digits):
        return digits, isbn13_to_10(digits)
    if valid_isbn10(digits):
        return isbn10_to_13(digits), digits
    return "", ""


# --------------------------------------------------------------------------
# Pulling ISBNs out of OCR text
# --------------------------------------------------------------------------


def _to_digits(chunk: str) -> str:
    return re.sub(r"[^0-9X]", "", chunk.translate(_CONFUSIONS).upper())


def _windows(digits: str, length: int, max_offset: int = _MAX_WINDOW_OFFSET):
    limit = min(max_offset, max(0, len(digits) - length))
    for i in range(0, limit + 1):
        yield digits[i:i + length]


def extract_isbns(text: str) -> tuple[str, str, str]:
    """Find an ISBN in OCR output. Returns (isbn13, isbn10, how).

    Labelled numbers are trusted first. Unlabelled candidates must be a
    978/979 ISBN-13 with a valid check digit, which is specific enough that
    stray numbers on a back cover do not produce false positives. Bare
    ten-digit numbers are only accepted next to an ISBN label, because too
    many things on a cover are ten digits long.
    """
    if not text:
        return "", "", ""

    for match in _LABEL_RE.finditer(text):
        digits = _to_digits(match.group(1))
        for candidate in _windows(digits, 13):
            if candidate.startswith(("978", "979")) and valid_isbn13(candidate):
                return candidate, isbn13_to_10(candidate), "labelled"
        for candidate in _windows(digits, 10):
            if valid_isbn10(candidate):
                return isbn10_to_13(candidate), candidate, "labelled"

    for match in _RUN_RE.finditer(text):
        digits = _to_digits(match.group(0))
        for candidate in _windows(digits, 13):
            if candidate.startswith(("978", "979")) and valid_isbn13(candidate):
                return candidate, isbn13_to_10(candidate), "unlabelled"

    return "", "", ""


# --------------------------------------------------------------------------
# Image preparation
# --------------------------------------------------------------------------

_MAX_OCR_WIDTH = 3200


def _gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _scaled(gray: np.ndarray, factor: float) -> np.ndarray:
    height, width = gray.shape[:2]
    target = int(width * factor)
    if target > _MAX_OCR_WIDTH:
        factor = _MAX_OCR_WIDTH / float(width)
    if abs(factor - 1.0) < 0.01:
        return gray
    interpolation = cv2.INTER_CUBIC if factor > 1 else cv2.INTER_AREA
    return cv2.resize(gray, None, fx=factor, fy=factor,
                      interpolation=interpolation)


def _enhance(gray: np.ndarray, mode: str) -> np.ndarray:
    if mode == "clahe":
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        return clahe.apply(gray)
    if mode == "otsu":
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        _, binary = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        return binary
    if mode == "adaptive":
        return cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY,
            35, 11,
        )
    if mode == "sharp":
        blurred = cv2.GaussianBlur(gray, (0, 0), 3)
        return cv2.addWeighted(gray, 1.6, blurred, -0.6, 0)
    return gray


def _region(image: np.ndarray, where: str) -> np.ndarray:
    """The ISBN and barcode almost always sit low on the back cover."""
    height = image.shape[0]
    if where == "bottom":
        return image[int(height * 0.55):, :]
    if where == "bottom_third":
        return image[int(height * 0.70):, :]
    return image


def sharpness(image: np.ndarray) -> float:
    """Variance of the Laplacian. Higher is crisper."""
    if image is None:
        return 0.0
    return float(cv2.Laplacian(_gray(image), cv2.CV_64F).var())


# --------------------------------------------------------------------------
# Barcode
# --------------------------------------------------------------------------

_BARCODE_SYMBOLS = None


def _barcode_symbols():
    global _BARCODE_SYMBOLS
    if _BARCODE_SYMBOLS is None and ZBarSymbol is not None:
        # Deliberately NOT ISBN10 or ISBN13. Enabling those makes zbar
        # rewrite an EAN-13 payload into ISBN-10 form, which throws away the
        # digits actually printed on the book. We want the raw scan on
        # record and do the conversion ourselves.
        _BARCODE_SYMBOLS = [
            ZBarSymbol.EAN13, ZBarSymbol.EAN8,
            ZBarSymbol.CODE128, ZBarSymbol.CODE39,
        ]
    return _BARCODE_SYMBOLS


def _decode_one(image: np.ndarray) -> list[str]:
    try:
        results = pyzbar.decode(image, symbols=_barcode_symbols())
    except Exception:
        return []
    found = []
    for result in results:
        try:
            data = result.data.decode("utf-8", errors="ignore").strip()
        except Exception:
            continue
        # EAN-2 and EAN-5 are the price add-on strips, not the ISBN.
        if len(data) >= 8 and data not in found:
            found.append(data)
    return found


def decode_barcodes(image: np.ndarray) -> list[str]:
    """Decode any barcodes, working through progressively harder variants."""
    if not ZBAR_AVAILABLE or image is None:
        return []

    gray = _gray(image)
    bottom = _region(gray, "bottom")

    for candidate in (
        gray,
        _scaled(gray, 2.0),
        _enhance(gray, "sharp"),
        _enhance(gray, "otsu"),
        bottom,
        _scaled(bottom, 2.5),
        _enhance(_scaled(bottom, 2.5), "sharp"),
        _enhance(_scaled(bottom, 2.5), "otsu"),
        _enhance(gray, "adaptive"),
        cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE),
        cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE),
        cv2.rotate(gray, cv2.ROTATE_180),
    ):
        found = _decode_one(candidate)
        if found:
            return found
    return []


# --------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------


def _ocr(image: np.ndarray, psm: int, digits_only: bool = False) -> str:
    if not TESSERACT_IMPORTED:
        return ""
    config = f"--oem 3 --psm {psm}"
    if digits_only:
        config += " -c tessedit_char_whitelist=0123456789Xx-ISBNisbn: "
    try:
        return pytesseract.image_to_string(image, config=config)
    except Exception:
        return ""


def ocr_text(image: np.ndarray) -> str:
    """General purpose OCR, used for the diagnostics view."""
    if not TESSERACT_IMPORTED or image is None:
        return ""
    prepared = _enhance(_scaled(_gray(image), 2.0), "clahe")
    return _ocr(prepared, psm=3)


# region, scale, enhancement, page segmentation mode, digits-only whitelist.
# Ordered cheapest and most likely first; the walk stops at the first hit.
_ISBN_LADDER = (
    ("full 2x clahe psm6", "full", 2.0, "clahe", 6, False),
    ("bottom 3x clahe psm6", "bottom", 3.0, "clahe", 6, False),
    ("bottom 3x otsu psm6 digits", "bottom", 3.0, "otsu", 6, True),
    ("bottom third 4x sharp psm7 digits", "bottom_third", 4.0, "sharp", 7, True),
    ("full 2x otsu psm11", "full", 2.0, "otsu", 11, False),
    ("bottom 3x adaptive psm11 digits", "bottom", 3.0, "adaptive", 11, True),
)


def find_isbn_by_ocr(
    image: np.ndarray,
) -> tuple[str, str, list[str], str, str]:
    """Walk the ladder looking for an ISBN.

    Returns (isbn13, isbn10, attempt log, best text, unconfirmed candidate).

    Only a number printed next to the word ISBN is trusted. An unlabelled
    one is reported as a suggestion and never written into the record.

    That rule was set by measurement, not taste. A sliding window over a
    long, OCR-mangled run of digits can land on a different number that
    still has a valid check digit, and requiring two passes to agree does
    not help because Tesseract misreads the same glyphs the same way every
    time, so the passes are correlated rather than independent. On badly
    degraded frames the unlabelled path produced silently wrong ISBNs.
    Books without the word ISBN nearly always carry a barcode, which is
    decoded before OCR is ever reached, so little is given up here.
    """
    if not TESSERACT_IMPORTED or image is None:
        return "", "", ["OCR unavailable"], "", ""

    gray = _gray(image)
    log: list[str] = []
    best_text = ""
    votes: dict[str, list[str]] = {}

    for label, where, scale, mode, psm, digits_only in _ISBN_LADDER:
        prepared = _enhance(_scaled(_region(gray, where), scale), mode)
        text = _ocr(prepared, psm=psm, digits_only=digits_only)
        if len(text.strip()) > len(best_text.strip()):
            best_text = text

        isbn13, isbn10, how = extract_isbns(text)
        note = f"{label}: {len(text.strip())} chars"

        if isbn13 and how == "labelled":
            log.append(note + f", ISBN {isbn13} (labelled, trusted)")
            return isbn13, isbn10, log, text, ""

        if isbn13:
            votes.setdefault(isbn13, []).append(label)
            note += f", unlabelled candidate {isbn13} (not trusted)"

        log.append(note)

    if votes:
        candidate = max(votes, key=lambda k: len(votes[k]))
        log.append(
            f"best unlabelled candidate {candidate}, seen by "
            f"{len(votes[candidate])} pass(es). Suggested, not saved."
        )
        return "", "", log, best_text, candidate

    return "", "", log, best_text, ""


def ocr_title_guess(image: np.ndarray) -> str:
    """Pick the most title-looking line off a front cover.

    Titles are set larger than everything else, so group the OCR words into
    lines and score each line by the height of its glyphs.
    """
    if not TESSERACT_IMPORTED or image is None:
        return ""

    prepared = _enhance(_scaled(_gray(image), 2.0), "clahe")
    best = ""
    best_score = 0.0

    for psm in (3, 6, 11):
        try:
            data = pytesseract.image_to_data(
                prepared, config=f"--oem 3 --psm {psm}",
                output_type=pytesseract.Output.DICT,
            )
        except Exception:
            continue

        lines: dict[tuple, list] = {}
        for i, word in enumerate(data.get("text", [])):
            word = (word or "").strip()
            if not word:
                continue
            try:
                confidence = float(data["conf"][i])
            except (ValueError, TypeError, KeyError):
                continue
            if confidence < 45:
                continue
            key = (data["block_num"][i], data["par_num"][i],
                   data["line_num"][i])
            lines.setdefault(key, []).append((word, data["height"][i]))

        for words in lines.values():
            text = re.sub(r"\s+", " ", " ".join(w for w, _ in words)).strip()
            text = text.strip(" .,:;-_|")
            if len(text) < 3 or _TITLE_NOISE.match(text):
                continue
            letters = sum(c.isalpha() for c in text)
            if letters < 3 or letters < len(text) * 0.5:
                continue  # mostly digits or punctuation, not a title
            mean_height = sum(h for _, h in words) / len(words)
            score = mean_height * (1.0 + 0.10 * len(words))
            if score > best_score:
                best_score = score
                best = text

        if best:
            break  # the first segmentation mode that reads anything wins

    return best


# --------------------------------------------------------------------------
# Top level
# --------------------------------------------------------------------------


def recognize(front: np.ndarray, back: np.ndarray,
              settings: Settings) -> Recognition:
    """Barcode first, OCR second. Never raises."""
    result = Recognition()

    if not ZBAR_AVAILABLE:
        result.notes.append("Barcode decoding unavailable: " + ZBAR_ERROR)
    else:
        for image, where in ((back, "back"), (front, "front")):
            if image is None:
                continue
            codes = decode_barcodes(image)
            if codes:
                result.barcodes = codes
                result.attempts.append(f"barcode on {where}: {', '.join(codes)}")
                break
        if not result.barcodes:
            result.attempts.append("barcode: nothing decoded")

    for code in result.barcodes:
        isbn13, isbn10 = normalise_isbn(code)
        if isbn13:
            result.isbn13 = isbn13
            result.isbn10 = isbn10
            result.isbn_source = "barcode"
            break

    if not settings.ocr_enabled or not TESSERACT_IMPORTED:
        result.attempts.append("OCR: disabled or unavailable")
        if not result.isbn13:
            result.notes.append("No ISBN found. Type it in to look the book up.")
        return result

    # Title always comes from OCR, since no barcode carries it.
    result.title_guess = ocr_title_guess(front)
    result.front_text = ocr_text(front)
    result.attempts.append(
        f"front OCR: {len(result.front_text.strip())} chars, "
        f"title guess {result.title_guess!r}"
    )

    if result.isbn13:
        result.back_text = ocr_text(back)
        result.attempts.append(
            f"back OCR: {len(result.back_text.strip())} chars (ISBN already "
            "known from barcode)"
        )
        return result

    # No barcode, so work for the ISBN.
    isbn13, isbn10, log, text, unconfirmed = find_isbn_by_ocr(back)
    result.attempts.extend(log)
    result.back_text = text

    if not isbn13:
        # Some books print the ISBN on the front flap or inside the cover.
        isbn13, isbn10, front_log, _, front_unconfirmed = find_isbn_by_ocr(front)
        result.attempts.extend(f"front {entry}" for entry in front_log)
        unconfirmed = unconfirmed or front_unconfirmed

    if isbn13:
        result.isbn13 = isbn13
        result.isbn10 = isbn10
        result.isbn_source = "ocr"
        result.notes.append("No barcode, ISBN read by OCR. Please check it.")
    elif unconfirmed:
        result.unconfirmed_isbn = unconfirmed
        result.notes.append(
            f"OCR possibly read {unconfirmed} but could not confirm it. "
            "Check the book, then type it in and press Enter."
        )
    else:
        result.notes.append(
            "No ISBN found by barcode or OCR. Type it in, or scan it with "
            "the USB scanner, and press Enter."
        )

    return result
