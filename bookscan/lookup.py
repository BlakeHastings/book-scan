"""Confirming a book against Open Library and Google Books.

Open Library is the primary source and does the work for both ISBN lookups
and title searches. Google Books is only ever a top-up or a fallback: its
anonymous quota is per-IP and it starts returning HTTP 429 well before you
finish a shelf, so nothing here is allowed to depend on it.

Set google_api_key in settings.json to raise that quota if you want to.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import requests

OPEN_LIBRARY_URL = "https://openlibrary.org/api/books"
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
USER_AGENT = "book-scan/1.0 (personal library cataloguing)"

# Set by the app from Settings, so the modules stay import-order independent.
GOOGLE_API_KEY = ""


@dataclass
class BookRecord:
    title: str = ""
    authors: str = ""
    publisher: str = ""
    published: str = ""
    pages: str = ""
    isbn13: str = ""
    isbn10: str = ""
    source: str = ""
    notes: list[str] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return bool(self.title)


class RateLimited(Exception):
    """Google Books refused us for quota reasons."""


def _get(url: str, params: dict, timeout: float):
    """GET and parse JSON. Returns None on any failure except a quota block,
    which is raised so callers can report it rather than silently show the
    book as 'not found'."""
    try:
        response = requests.get(
            url, params=params, timeout=timeout,
            headers={"User-Agent": USER_AGENT},
        )
    except requests.RequestException:
        return None

    if response.status_code in (429, 403):
        raise RateLimited(f"HTTP {response.status_code}")
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _google_get(params: dict, timeout: float):
    """Google Books, with the optional API key attached. Never raises."""
    if GOOGLE_API_KEY:
        params = dict(params, key=GOOGLE_API_KEY)
    try:
        return _get(GOOGLE_BOOKS_URL, params, timeout)
    except RateLimited:
        return None


def _from_open_library(isbn: str, timeout: float) -> BookRecord | None:
    key = f"ISBN:{isbn}"
    try:
        data = _get(
            OPEN_LIBRARY_URL,
            {"bibkeys": key, "format": "json", "jscmd": "data"},
            timeout,
        )
    except RateLimited:
        return None
    if not data or key not in data:
        return None
    entry = data[key]

    identifiers = entry.get("identifiers", {}) or {}
    return BookRecord(
        title=" ".join(
            part for part in
            (entry.get("title", ""), entry.get("subtitle", "")) if part
        ).strip(),
        authors=", ".join(
            a.get("name", "") for a in entry.get("authors", []) or []
        ).strip(", "),
        publisher=", ".join(
            p.get("name", "") for p in entry.get("publishers", []) or []
        ).strip(", "),
        published=str(entry.get("publish_date", "")),
        pages=str(entry.get("number_of_pages", "") or ""),
        isbn13=(identifiers.get("isbn_13") or [""])[0],
        isbn10=(identifiers.get("isbn_10") or [""])[0],
        source="Open Library",
    )


def _from_google_volume(volume: dict) -> BookRecord:
    info = volume.get("volumeInfo", {}) or {}
    isbn13 = isbn10 = ""
    for ident in info.get("industryIdentifiers", []) or []:
        if ident.get("type") == "ISBN_13":
            isbn13 = ident.get("identifier", "")
        elif ident.get("type") == "ISBN_10":
            isbn10 = ident.get("identifier", "")

    return BookRecord(
        title=" ".join(
            part for part in
            (info.get("title", ""), info.get("subtitle", "")) if part
        ).strip(),
        authors=", ".join(info.get("authors", []) or []),
        publisher=info.get("publisher", ""),
        published=info.get("publishedDate", ""),
        pages=str(info.get("pageCount", "") or ""),
        isbn13=isbn13,
        isbn10=isbn10,
        source="Google Books",
    )


def _from_google_isbn(isbn: str, timeout: float) -> BookRecord | None:
    data = _google_get({"q": f"isbn:{isbn}"}, timeout)
    if not data or not data.get("items"):
        return None
    return _from_google_volume(data["items"][0])


def _from_open_library_search(title: str, timeout: float) -> BookRecord | None:
    """Title search against Open Library, the reliable path when there is no
    readable ISBN."""
    try:
        data = _get(
            OPEN_LIBRARY_SEARCH_URL,
            {"title": title, "limit": 5, "fields":
                "title,author_name,publisher,first_publish_year,"
                "number_of_pages_median,isbn"},
            timeout,
        )
    except RateLimited:
        return None
    docs = (data or {}).get("docs") or []
    if not docs:
        return None
    doc = docs[0]

    isbns = doc.get("isbn") or []
    isbn13 = next((i for i in isbns if len(i) == 13), "")
    isbn10 = next((i for i in isbns if len(i) == 10), "")

    return BookRecord(
        title=doc.get("title", ""),
        authors=", ".join(doc.get("author_name", []) or []),
        publisher=", ".join((doc.get("publisher", []) or [])[:2]),
        published=str(doc.get("first_publish_year", "") or ""),
        pages=str(doc.get("number_of_pages_median", "") or ""),
        isbn13=isbn13,
        isbn10=isbn10,
        source="Open Library search",
    )


def lookup_isbn(isbn: str, timeout: float = 8.0) -> BookRecord:
    """Look an ISBN up, Open Library first then Google Books."""
    isbn = "".join(c for c in isbn if c.isdigit() or c in "Xx").upper()
    if not isbn:
        return BookRecord(notes=["No ISBN to look up."])

    record = _from_open_library(isbn, timeout)
    if record and record.found:
        # Google often has the page count and publisher that Open Library
        # leaves blank, so top up cheaply rather than accepting a sparse row.
        if not record.publisher or not record.pages:
            extra = _from_google_isbn(isbn, timeout)
            if extra and extra.found:
                record.publisher = record.publisher or extra.publisher
                record.pages = record.pages or extra.pages
                record.published = record.published or extra.published
                record.source = "Open Library + Google Books"
        return record

    record = _from_google_isbn(isbn, timeout)
    if record and record.found:
        return record

    return BookRecord(notes=[f"ISBN {isbn} not found in either catalogue."])


def search_title(title: str, timeout: float = 8.0) -> BookRecord:
    """Fallback for books with no readable ISBN, using the OCR'd title."""
    title = (title or "").strip()
    if len(title) < 3:
        return BookRecord(notes=["Title too short to search."])

    record = _from_open_library_search(title, timeout)
    if record is None or not record.found:
        data = _google_get({"q": f'intitle:"{title}"', "maxResults": 5}, timeout)
        if not data or not data.get("items"):
            data = _google_get({"q": title, "maxResults": 5}, timeout)
        if not data or not data.get("items"):
            return BookRecord(notes=[f'No match for title "{title}".'])
        record = _from_google_volume(data["items"][0])

    record.notes.append(
        f'Matched by OCR title "{title}", not by ISBN. Please verify.'
    )
    return record
