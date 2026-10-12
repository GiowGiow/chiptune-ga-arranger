"""Walk the MPB MIDI catalog site once, politely, and write the app's song list.

The browser arranger searches a list of about 3,700 Brazilian songs that have a MIDI file on
Beatriz Kauffmann's Web Site (https://www.beakauffmann.com/). The site offers no list to
download, and a browser on another site cannot read its pages, so this module builds the list
offline, once:

1. read the 27 index pages (`mpb_0-9.html`, `mpb_a.html` ... `mpb_z.html`) for title, composers
   and song page;
2. read every song page for the performer and the MIDI links;
3. write `arranger/data/catalog.json` with metadata and links only.

Credit and rights: the site says "All Rights Reserved". The catalog therefore names its source,
holds no MIDI file and no lyrics, and sends the visitor to the site to download a song.

Politeness: the crawl sends the project's User-Agent, waits at least one second between
requests (shorter pauses are refused), and keeps every page it reads in a cache folder
(`data/raw/catalog/`, never committed). A page already in the cache is never requested again, so
an interrupted crawl resumes where it stopped and a rerun costs the site nothing.

Network access happens only in `fetch_url`; `crawl` receives it (and `sleep`) as parameters, so
the tests run it on a fake site.
"""

import argparse
import http.client
import json
import re
import time
import unicodedata
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlsplit

from catalog.pages import decode_page, parse_index, parse_song_page
from leadsheet.sources import DOWNLOAD_TIMEOUT_SECONDS, USER_AGENT

SITE = "https://www.beakauffmann.com/"
SOURCE = "Beatriz Kauffmann's Web Site"
NOTE = "Metadata and links only. The MIDI files stay on the catalog site (All Rights Reserved)."
ALL_LETTERS = ("0-9", *"abcdefghijklmnopqrstuvwxyz")
MINIMUM_DELAY_SECONDS = 1.0
PROGRESS_EVERY_PAGES = 100
DEFAULT_OUT = Path("arranger/data/catalog.json")
DEFAULT_CACHE = Path("data/raw/catalog")


@dataclass(frozen=True)
class CatalogEntry:
    """One song of the catalog: an index row joined with its song page.

    Attributes:
        title: title in the site's spelling, e.g. "MULHER DE FASES".
        composers: composers as the site writes them, e.g. "Digão e Rodolfo".
        performer: artist named on the song page, e.g. "Raimundos".
        page_url: the song page, where the visitor downloads the MIDI file.
        midi_urls: the MIDI files linked from the song page.
    """

    title: str
    composers: str
    performer: str
    page_url: str
    midi_urls: tuple[str, ...]


@dataclass(frozen=True)
class CrawlResult:
    """What a crawl found.

    Attributes:
        entries: the songs with at least one MIDI link, in index order.
        dropped: songs left out because their page links no MIDI file.
        failed: pages (index or song) that could not be read; a rerun tries them again.
    """

    entries: list[CatalogEntry]
    dropped: int
    failed: int


def index_url(letter: str) -> str:
    """Return the index page of one initial letter.

    >>> index_url("0-9")
    'https://www.beakauffmann.com/mpb_0-9.html'
    """
    return f"{SITE}mpb_{letter}.html"


def parse_letters(text: str) -> list[str]:
    """Read a comma-separated list of index letters, as `--letters` takes it.

    >>> parse_letters("0-9, a,M")
    ['0-9', 'a', 'm']
    """
    letters = [letter.strip().lower() for letter in text.split(",") if letter.strip()]
    unknown = [letter for letter in letters if letter not in ALL_LETTERS]
    if unknown or not letters:
        raise argparse.ArgumentTypeError(
            f"unknown index letters {unknown or [text]}; use 0-9 and a to z, e.g. '0-9,a,m'"
        )
    return letters


def cache_path(cache_dir: Path, url: str) -> Path:
    """Return the cache file of a page: its URL path, made safe, under `cache_dir`.

    Each path segment keeps only letters, digits, ".", "_" and "-", so a URL can never point the
    cache outside its folder.

    >>> page = "https://www.beakauffmann.com/mpb_m/mulher-de-fases.html"
    >>> cache_path(Path("cache"), page).as_posix()
    'cache/mpb_m/mulher-de-fases.html'
    >>> cache_path(Path("cache"), "https://example.org/../a b.html").as_posix()
    'cache/_/a_b.html'
    """
    segments = [segment for segment in unquote(urlsplit(url).path).split("/") if segment]
    safe = [re.sub(r"[^A-Za-z0-9._-]", "_", segment) for segment in segments]
    return cache_dir.joinpath(*("_" if set(segment) == {"."} else segment for segment in safe))


def fetch_url(url: str, opener: Callable = urllib.request.urlopen) -> bytes:
    """Download one page with the project's User-Agent.

    Args:
        url: the page to download.
        opener: function that opens a `urllib.request.Request` (tests pass a stand-in).
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with opener(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        return response.read()


def crawl(
    letters: list[str],
    cache_dir: Path,
    delay: float = MINIMUM_DELAY_SECONDS,
    fetch: Callable[[str], bytes] = fetch_url,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> CrawlResult:
    """Read the index pages of `letters`, then every song page they list.

    Args:
        letters: index letters, e.g. ["0-9", "a"].
        cache_dir: folder that keeps every page read; cached pages are not requested again.
        delay: seconds to wait between two requests to the site (at least 1.0).
        fetch: function that downloads a URL and returns its bytes.
        sleep: function that waits a number of seconds.
        log: function that prints one progress or failure line.

    Raises:
        ValueError: when `delay` is below one second.
    """
    if delay < MINIMUM_DELAY_SECONDS:
        raise ValueError(f"--delay must be at least {MINIMUM_DELAY_SECONDS} seconds, got {delay}")
    reader = _PageReader(Path(cache_dir), delay, fetch, sleep, log)
    entries = []
    dropped = 0
    seen_pages = set()
    for letter in letters:
        index_page = reader.read(index_url(letter))
        if index_page is None:
            continue
        for row in parse_index(index_page, index_url(letter)):
            if row.page_url in seen_pages:
                continue
            seen_pages.add(row.page_url)
            song_page = reader.read(row.page_url)
            if song_page is None:
                continue
            song = parse_song_page(song_page, row.page_url)
            if not song.midi_urls:
                dropped += 1
                continue
            entries.append(
                CatalogEntry(row.title, row.composers, song.performer, row.page_url, song.midi_urls)
            )
    return CrawlResult(entries, dropped, reader.failed)


def title_sort_key(title: str) -> str:
    """Return the key that sorts titles the way a reader expects: no accents, no letter case.

    >>> sorted(["Zebra", "abelha", "Ábaco"], key=title_sort_key)
    ['Ábaco', 'abelha', 'Zebra']
    """
    decomposed = unicodedata.normalize("NFD", title)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).casefold()


def write_catalog(entries: list[CatalogEntry], path: Path, retrieved: str) -> Path:
    """Write the catalog JSON of contracts/files.md, one entry per line, sorted by title.

    Args:
        entries: the songs to write.
        path: the output file (its folder is created when missing).
        retrieved: date of the crawl, as an ISO date, e.g. "2026-10-12".
    """
    ordered = sorted(
        entries, key=lambda entry: (title_sort_key(entry.title), entry.title, entry.page_url)
    )
    header = {"source": SOURCE, "home": SITE, "note": NOTE, "retrieved": retrieved}
    # Compact entries, one per line: the file stays small (under 1 MB) and diffs stay readable.
    lines = [
        json.dumps(
            {
                "t": entry.title,
                "c": entry.composers,
                "p": entry.performer,
                "u": entry.page_url,
                "m": list(entry.midi_urls),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        for entry in ordered
    ]
    fields = [f"  {json.dumps(key)}: {json.dumps(value)}" for key, value in header.items()]
    entry_lines = ",\n".join(f"    {line}" for line in lines)
    text = "{\n" + ",\n".join(fields) + ',\n  "entries": [\n' + entry_lines + "\n  ]\n}\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def add_catalog_parser(commands: argparse._SubParsersAction) -> argparse.ArgumentParser:
    """Add the `catalog` command (contracts/cli.md) to the subcommands of `main.py`."""
    catalog = commands.add_parser(
        "catalog", help="build the app's MPB MIDI catalog (metadata and links only)"
    )
    catalog.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output file")
    catalog.add_argument(
        "--cache", type=Path, default=DEFAULT_CACHE, help="folder for downloaded pages, to resume"
    )
    catalog.add_argument(
        "--delay",
        type=float,
        default=MINIMUM_DELAY_SECONDS,
        metavar="SECONDS",
        help="pause between requests (values below 1.0 are refused)",
    )
    catalog.add_argument(
        "--letters",
        type=parse_letters,
        default=list(ALL_LETTERS),
        help='only these index pages, e.g. "0-9,a,m" (default: all 27)',
    )
    catalog.set_defaults(handler=run_catalog)
    return catalog


def run_catalog(
    args: argparse.Namespace,
    fetch: Callable[[str], bytes] = fetch_url,
    sleep: Callable[[float], None] = time.sleep,
) -> CrawlResult:
    """Crawl the catalog site and write the catalog file; print the counts."""
    result = crawl(args.letters, args.cache, args.delay, fetch, sleep)
    write_catalog(result.entries, args.out, date.today().isoformat())
    print(
        f"{len(result.entries)} entries, {result.dropped} dropped (no MIDI link), "
        f"{result.failed} pages failed: {args.out}"
    )
    return result


class _PageReader:
    """Read pages through the cache, pausing before every request but the first."""

    def __init__(
        self,
        cache_dir: Path,
        delay: float,
        fetch: Callable[[str], bytes],
        sleep: Callable[[float], None],
        log: Callable[[str], None],
    ) -> None:
        self.cache_dir = cache_dir
        self.delay = delay
        self.fetch = fetch
        self.sleep = sleep
        self.log = log
        self.pages = 0
        self.downloaded = 0
        self.failed = 0
        self._requested = False

    def read(self, url: str) -> str | None:
        """Return the page text, or None (logged and counted) when the request fails."""
        self.pages += 1
        try:
            return decode_page(self._payload(url))
        except (OSError, http.client.HTTPException) as error:
            # urllib's URLError, HTTPError and timeouts are all OSErrors.
            self.failed += 1
            self.log(f"failed: {url}: {error}")
            return None
        finally:
            if self.pages % PROGRESS_EVERY_PAGES == 0:
                self.log(
                    f"{self.pages} pages read: {self.downloaded} downloaded, {self.failed} failed"
                )

    def _payload(self, url: str) -> bytes:
        path = cache_path(self.cache_dir, url)
        if path.exists():
            return path.read_bytes()
        if self._requested:
            self.sleep(self.delay)
        self._requested = True
        payload = self.fetch(url)
        self.downloaded += 1
        # Write to a side file first, so an interrupted crawl never leaves half a page cached.
        partial = path.with_name(path.name + ".part")
        partial.parent.mkdir(parents=True, exist_ok=True)
        partial.write_bytes(payload)
        partial.replace(path)
        return payload
