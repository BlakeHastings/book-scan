"""Working out where a book belongs on the shelves.

Three jobs:

  * turn an author credit into a sortable surname
  * guess whether a book is fiction, which decides the shelf group
  * find the two books a new one goes between, and which shelf that implies

The ordering is: author surname, then series name, then position within the
series, then title. Books by an author that are not part of a series sort
before that author's series, so a run of standalones is followed by each
series in order.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Sequence

# Surname particles. "Ursula K. Le Guin" files under Le Guin, not Guin, and
# "Cornelius van der Meer" files under van der Meer.
PARTICLES = {
    "de", "del", "della", "di", "da", "das", "dos", "du", "des",
    "la", "le", "les", "lo", "van", "von", "vander", "ter", "ten",
    "den", "der", "af", "al", "bin", "ibn", "st", "st.", "saint",
    "mac", "mc", "o", "abu", "up", "ap",
}

# Dropped from the end of a name before looking for the surname.
SUFFIXES = {
    "jr", "jr.", "sr", "sr.", "i", "ii", "iii", "iv", "v",
    "phd", "ph.d", "ph.d.", "md", "m.d.", "esq", "esq.", "dds",
}

# Titles dropped from the front.
PREFIXES = {"mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir",
            "dame", "lord", "lady", "rev", "fr", "st", "sister", "brother"}

_NONFICTION_HINTS = (
    "biography", "autobiography", "memoir", "history", "historical study",
    "true crime", "self-help", "self help", "business", "economics",
    "philosophy", "religion", "theology", "spirituality", "psychology",
    "politics", "political science", "science", "mathematics", "medicine",
    "medical", "health", "fitness", "diet", "cooking", "cookbook", "cookery",
    "travel", "guidebook", "reference", "dictionary", "encyclopedia",
    "textbook", "education", "computers", "technology", "engineering",
    "gardening", "crafts", "sports", "nature", "animals", "art",
    "photography", "architecture", "music", "essays", "journalism",
    "social science", "anthropology", "sociology", "law", "military",
    "war", "biography & autobiography", "body, mind & spirit",
    "family & relationships", "house & home", "games & activities",
    "study aids", "transportation", "antiques & collectibles",
)

_FICTION_HINTS = (
    "fiction", "novel", "novels", "fantasy", "science fiction", "mystery",
    "detective", "thriller", "suspense", "romance", "horror", "adventure",
    "short stories", "comics", "graphic novel", "manga", "poetry", "drama",
    "plays", "fairy tales", "folklore", "mythology", "literary",
)


# --------------------------------------------------------------------------
# Author surnames
# --------------------------------------------------------------------------


def _strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def first_author(authors: str) -> str:
    """The first credited author from a comma or ampersand separated list."""
    if not authors:
        return ""
    # Split on separators that join whole names, never on the comma inside a
    # single "Surname, Firstname" credit. If the first chunk has no space it
    # is very likely a bare surname in sorted form, so keep the pairing.
    parts = re.split(r"\s*(?:;|&|\band\b|\bwith\b)\s*", authors, flags=re.I)
    head = parts[0].strip()

    chunks = [c.strip() for c in head.split(",") if c.strip()]
    if len(chunks) >= 2 and " " not in chunks[0]:
        # "Tolkien, J.R.R." is one author already in sorted order.
        return head
    return chunks[0] if chunks else head


def author_sort_name(authors: str) -> str:
    """The surname to file under, upper-cased. Empty if there is no author."""
    name = first_author(authors)
    if not name:
        return ""

    name = _strip_accents(name).replace("’", "'")

    # "Tolkien, J.R.R." is already surname first.
    if "," in name:
        surname = name.split(",")[0].strip()
        if surname:
            return re.sub(r"\s+", " ", surname).upper()

    tokens = [t for t in re.split(r"\s+", name.strip()) if t]
    while tokens and tokens[0].strip(".,").lower() in PREFIXES:
        tokens.pop(0)
    while tokens and tokens[-1].strip(".,").lower() in SUFFIXES:
        tokens.pop()
    if not tokens:
        return ""

    surname = [tokens[-1]]
    index = len(tokens) - 2
    while index >= 0 and tokens[index].strip(".,").lower() in PARTICLES:
        surname.insert(0, tokens[index])
        index -= 1

    joined = " ".join(surname).strip(".,'\"")
    return re.sub(r"\s+", " ", joined).upper()


def series_position(value: Any) -> float:
    """Numeric position within a series. Unnumbered entries sort first."""
    if value is None:
        return 0.0
    match = re.search(r"\d+(?:\.\d+)?", str(value))
    return float(match.group(0)) if match else 0.0


def sort_key(sort_author: str, series: str, number: Any,
             title: str) -> tuple:
    """The single ordering used everywhere: author, series, position, title."""
    return (
        (sort_author or "").upper(),
        (series or "").strip().upper(),
        series_position(number),
        (title or "").strip().upper(),
    )


def row_sort_key(row: Any) -> tuple:
    """Ordering key for a stored book row."""
    def get(name: str) -> str:
        try:
            value = row[name]
        except (KeyError, IndexError, TypeError):
            return ""
        return "" if value is None else str(value)

    return sort_key(
        get("sort_author") or author_sort_name(get("authors")),
        get("series"),
        get("series_number"),
        get("title"),
    )


# --------------------------------------------------------------------------
# Fiction or not
# --------------------------------------------------------------------------


def guess_fiction(subjects: str, title: str = "") -> bool:
    """Guess whether a book is fiction. Defaults to fiction when unsure.

    Home collections skew fiction and S4 is the single non-fiction shelf, so
    an unknown book is more likely to belong with the fiction. The operator
    sees the guess as a checkbox and can flip it before saving.
    """
    text = f"{subjects} {title}".lower()
    if not text.strip():
        return True

    if "non-fiction" in text or "nonfiction" in text:
        return False
    # "Science fiction" and "Juvenile fiction" both settle it immediately,
    # which is why this is checked before the non-fiction keyword sweep.
    if "fiction" in text:
        return True

    nonfiction_hits = sum(1 for hint in _NONFICTION_HINTS if hint in text)
    fiction_hits = sum(1 for hint in _FICTION_HINTS if hint in text)
    if nonfiction_hits > fiction_hits:
        return False
    if fiction_hits > 0:
        return True
    return nonfiction_hits == 0


# --------------------------------------------------------------------------
# Placement
# --------------------------------------------------------------------------


@dataclass
class Placement:
    """Where a book goes, expressed as the two books it sits between."""

    previous: Any = None       # the book it goes after, or None
    following: Any = None      # the book it goes before, or None
    shelf: str = ""            # suggested shelf
    section: str = "fiction"
    shelves: list[str] = field(default_factory=list)
    at_boundary: bool = False  # neighbours sit on different shelves
    is_first: bool = False     # nothing placed in this section yet
    position: int = 0          # how many placed books sort before it
    total: int = 0

    @property
    def headline(self) -> str:
        if self.is_first:
            return (f"First book on {self.shelf}. Start at the left hand "
                    f"end of {self.shelf}.")
        if self.previous is None:
            return f"Goes at the very start, before {_describe(self.following)}"
        if self.following is None:
            return f"Goes at the very end, after {_describe(self.previous)}"
        return (f"Goes between {_describe(self.previous)}"
                f"  and  {_describe(self.following)}")


def _describe(row: Any) -> str:
    if row is None:
        return "(nothing)"
    try:
        author = row["authors"] or row["sort_author"] or "unknown"
        title = row["title"] or "untitled"
        shelf = row["shelf"] or "?"
        area = row["area"] or "?"
    except (KeyError, IndexError, TypeError):
        return "(unknown book)"
    return f"{title} ({author}) at {shelf}-{area}"


def plan_placement(
    placed: Sequence[Any],
    key: tuple,
    is_fiction: bool,
    fiction_shelves: Sequence[str],
    nonfiction_shelves: Sequence[str],
) -> Placement:
    """Find the two placed books a new book belongs between.

    `placed` must already be restricted to books that have both a shelf and
    an area, because a book nobody has shelved yet cannot be used as a
    landmark to find a spot.
    """
    shelves = list(nonfiction_shelves if not is_fiction else fiction_shelves)
    section = "non-fiction" if not is_fiction else "fiction"

    relevant = [row for row in placed if (row["shelf"] or "") in shelves]
    ordered = sorted(relevant, key=row_sort_key)

    index = 0
    for index, row in enumerate(ordered):
        if row_sort_key(row) > key:
            break
    else:
        index = len(ordered)

    previous = ordered[index - 1] if index > 0 else None
    following = ordered[index] if index < len(ordered) else None

    placement = Placement(
        previous=previous,
        following=following,
        section=section,
        shelves=shelves,
        position=index,
        total=len(ordered),
        is_first=not ordered,
    )

    if not ordered:
        placement.shelf = shelves[0] if shelves else ""
    elif previous is not None and following is not None:
        previous_shelf = previous["shelf"] or ""
        following_shelf = following["shelf"] or ""
        placement.shelf = previous_shelf
        placement.at_boundary = previous_shelf != following_shelf
    elif previous is not None:
        placement.shelf = previous["shelf"] or (shelves[0] if shelves else "")
    else:
        placement.shelf = following["shelf"] or (shelves[0] if shelves else "")

    return placement
