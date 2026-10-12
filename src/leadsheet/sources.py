"""Where the MIDI songs come from, and how to get the same files again.

Some inputs of the arranger are fan-made MIDI sequences of Brazilian songs found on the web. They
belong to third parties, so they stay out of git in `data/raw/`. To keep the results
reproducible, `data/sources.json` (the *manifest*) records for each song its title and artist, the
page and the direct link of the file, and its SHA-256 *hash*: a 64-digit fingerprint of the bytes.
Two files with the same hash are, for every practical purpose, the same file, so a matching hash
proves that a fresh download is the very sequence the samples were made from. A site can change or
remove a file; the hash check turns that silent change into a clear error.

The manifest also says how each song was reduced to a lead sheet (melody track, excerpt, sections),
and names the committed ABC file that holds that reduction, so the arranger can rerun even when a
site goes away. Network access happens only in `fetch_song`, called by the `fetch` command.
"""

import hashlib
import json
import textwrap
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

# Some sites answer Python's default user agent with HTTP 406, so the request names the project.
USER_AGENT = "dcc831-tp1-fetch/1.0 (+https://github.com/GiowGiow/dcc831-tp1)"
DOWNLOAD_TIMEOUT_SECONDS = 60
COMMENT_WIDTH = 98


@dataclass(frozen=True)
class SongSource:
    """One MIDI song of the manifest.

    Attributes:
        id: short name of the song, for example "aquarela".
        title: song title.
        artist: performer the song is known by.
        composers: composers named on the source page (empty when the page names none).
        page_url: web page that links the file, or None when there is no public page.
        url: direct link to the MIDI file, or None when it cannot be downloaded.
        sha256: SHA-256 hash of the file, in hexadecimal.
        path: where the file lives, relative to the repository root (inside `data/raw/`).
        abc: the committed ABC lead sheet that holds the project's reduction of the song.
        sample: the sample folder (under `samples/`) made from this song.
        midi: lead-sheet settings of that sample, the `midi` section of its configuration.
        note: anything else a reader should know about the source.
    """

    id: str
    title: str
    artist: str
    composers: tuple[str, ...]
    page_url: str | None
    url: str | None
    sha256: str
    path: Path
    abc: Path
    sample: str
    midi: dict
    note: str


def load_sources(path: Path | str) -> list[SongSource]:
    """Read the manifest (`data/sources.json`) into a list of songs."""
    record = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        SongSource(
            **{
                **song,
                "composers": tuple(song["composers"]),
                "path": Path(song["path"]),
                "abc": Path(song["abc"]),
            }
        )
        for song in record["songs"]
    ]


def file_sha256(path: Path | str) -> str:
    """Return the SHA-256 hash of a file, in hexadecimal.

    >>> import tempfile
    >>> with tempfile.TemporaryDirectory() as folder:
    ...     empty = Path(folder) / "empty.mid"
    ...     _ = empty.write_bytes(b"")
    ...     file_sha256(empty)[:16]
    'e3b0c44298fc1c14'
    """
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def song_for_input(songs: list[SongSource], input_path: Path | str) -> SongSource:
    """Return the song whose file is `input_path` (as a sample's `config.json` records it)."""
    for song in songs:
        if song.path == Path(input_path):
            return song
    raise ValueError(f"{input_path} is not listed in the sources manifest")


def fetch_song(
    song: SongSource,
    root: Path | str = ".",
    opener: Callable = urllib.request.urlopen,
) -> str:
    """Make sure the song's file is in `data/raw/`, downloading it when needed.

    The download is checked against the manifest's hash before it is written, so a file that
    changed on the site never replaces the one the samples were made from.

    Args:
        song: the song to fetch.
        root: repository root; `song.path` is relative to it.
        opener: function that opens a `urllib.request.Request` (tests pass a stand-in).

    Returns:
        "present" when the file was already there with the right hash, "downloaded" when it was
        fetched now, "no url" when it is missing and has no public download.

    Raises:
        ValueError: when the download fails or its hash differs from the manifest.
    """
    target = Path(root) / song.path
    if target.exists() and file_sha256(target) == song.sha256:
        return "present"
    if song.url is None:
        if target.exists():
            raise ValueError(_hash_mismatch(song, file_sha256(target), f"{song.path}"))
        return "no url"

    request = urllib.request.Request(song.url, headers={"User-Agent": USER_AGENT})
    try:
        with opener(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            payload = response.read()
    except OSError as error:  # urllib's URLError and HTTPError are both OSErrors
        raise ValueError(f"{song.id}: download of {song.url} failed: {error}") from error
    digest = hashlib.sha256(payload).hexdigest()
    if digest != song.sha256:
        raise ValueError(_hash_mismatch(song, digest, f"the file at {song.url}"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return "downloaded"


def require_song_file(song: SongSource, root: Path | str = ".") -> Path:
    """Return the song's file, after checking that it is the file of the manifest.

    Raises:
        ValueError: when the file is missing (naming the command or the lead sheet to use
            instead) or when its hash differs from the manifest.
    """
    target = Path(root) / song.path
    if not target.exists():
        if song.url is None:
            raise ValueError(
                f"{song.path} is missing and has no public download URL; "
                f"arrange the committed lead sheet {song.abc.as_posix()} instead"
            )
        raise ValueError(f"{song.path} is missing; download it with `uv run src/main.py fetch`")
    digest = file_sha256(target)
    if digest != song.sha256:
        raise ValueError(_hash_mismatch(song, digest, f"{song.path}"))
    return target


def provenance_comments(song: SongSource, midi: dict, command: str) -> list[str]:
    """Return the comment lines (without "%") that say where an ABC lead sheet comes from.

    Args:
        song: the song the lead sheet was reduced from.
        midi: the lead-sheet settings used (melody_track, bars, sections, grid).
        command: the command that wrote the lead sheet.
    """
    credits = f"{song.title}, as performed by {song.artist}"
    if song.composers:
        credits += f" (composers: {', '.join(song.composers)})"
    paragraphs = [
        credits + ".",
        "This lead sheet is the project's reduction of a fan-made MIDI file: the melody of one "
        "track, the chords detected in the other tracks every half bar, and the part labels. It "
        "is our reinterpretation of the song, not the original recording or arrangement, made "
        "for academic use only (DCC831 TP1, UFMG).",
    ]
    if song.url is None:
        paragraphs.append(f"Source: a MIDI file with no public download URL. {song.note}")
    else:
        paragraphs.append(f"Source: {song.page_url} (file {song.url}). {song.note}")
    bars = midi["bars"]
    excerpt = f"bars {bars[0]}-{bars[1]} (0-based, end excluded)" if bars else "all bars"
    sections = ", ".join(f"{label} at bar {bar}" for bar, label in midi["sections"] or [])
    paragraphs.append(
        f"Reduced from {song.path.as_posix()} (sha256 {song.sha256}): melody track "
        f"{midi['melody_track']}, {excerpt}, sections {sections or 'A at bar 0'}, beat grid "
        f"{midi['grid']}."
    )
    paragraphs.append(f"Written by: {command}")
    lines = []
    for paragraph in paragraphs:
        # A double quote would open a chord symbol in some ABC readers, so comments avoid it.
        lines += textwrap.wrap(
            paragraph.replace('"', "'"),
            COMMENT_WIDTH - 2,
            break_long_words=False,  # keep URLs and hashes whole
            break_on_hyphens=False,
        )
    return lines


def _hash_mismatch(song: SongSource, digest: str, what: str) -> str:
    return (
        f"{song.id}: {what} has sha256 {digest}, but the manifest expects {song.sha256}; "
        "it is not the sequence the samples were made from"
    )
