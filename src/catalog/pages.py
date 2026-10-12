"""Read the catalog site's pages: who wrote and who sang each song, and where its MIDI file is.

The catalog comes from Beatriz Kauffmann's Web Site (https://www.beakauffmann.com/), credited in
every copy of the catalog. Its pages say "All Rights Reserved", so the project keeps only
metadata and links from them, never the MIDI files or the lyrics.

The site has two kinds of pages:

- An *index page* per initial letter (`mpb_0-9.html`, `mpb_a.html` ... `mpb_z.html`). Each song
  is one table row: a link to the song page with the title in bold, then the composers after a
  non-breaking space. A medley joins its titles with a bullet, and some rows add a subtitle in
  parentheses right after the link.
- A *song page* per song (`mpb_m/mulher-de-fases.html`). Its `<title>` reads
  "TITLE - Performer - MIDI e Letra da Música - Lyric", and its MIDI links point to `som/`.

These functions are pure: they take the text of a page and its URL, and return plain records.
Fetching the pages is the job of `catalog.crawl`.
"""

import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

# A song link is "mpb_<letter>/<slug>.html"; the letter links ("mpb_x.html") and the other lists
# ("musicas-juninas.html") are not songs.
SONG_HREF = re.compile(r"mpb_(?:0-9|[a-z])/[^/?#]+\.html")
SONG_LINK_CLASS = "BB"
# A song page's title ends with the site's own label: "- MIDI e Letra da Música - Lyric" for a
# song, "- MIDI" for an instrumental. It is not song metadata.
SITE_LABEL = re.compile(r"\s*-\s*MIDI\b.*$")
# Fields of the title are separated by a dash with a space on at least one side ("VOCÊ- Victor"
# happens); a hyphen inside a word ("MEIA-VOLTA") is not a separator.
FIELD_SEPARATOR = re.compile(r"\s+-\s*|\s*-\s+")


@dataclass(frozen=True)
class IndexRow:
    """One song of an index page.

    Attributes:
        title: the title in the site's spelling (usually upper case), with a medley's titles
            joined by " • " and a parenthesized subtitle kept.
        composers: the composers as the site writes them, e.g. "Digão e Rodolfo" ("" if none).
        page_url: absolute URL of the song page.
    """

    title: str
    composers: str
    page_url: str


@dataclass(frozen=True)
class SongPage:
    """What a song page adds to its index row.

    Attributes:
        performer: the artist named in the page title ("" if the title names none).
        midi_urls: absolute URLs of the page's MIDI files, in page order, without repeats.
    """

    performer: str
    midi_urls: tuple[str, ...]


def decode_page(payload: bytes) -> str:
    """Turn the bytes of a page into text.

    The site writes accents as HTML entities, so its pages are plain ASCII. A page that is not
    valid UTF-8 is read as Latin-1, the usual encoding of older Brazilian sites.

    >>> decode_page(b"Dig&atilde;o")
    'Dig&atilde;o'
    >>> decode_page("Digão".encode("latin-1"))
    'Digão'
    """
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("latin-1")


def parse_index(html: str, base_url: str) -> list[IndexRow]:
    """Return the songs listed on an index page, in page order.

    Args:
        html: text of the index page.
        base_url: URL of the index page, to make the song links absolute.

    >>> html = ('<tr><td><a href="mpb_m/mulher-de-fases.html" class="BB"><b>MULHER DE FASES</b>'
    ...         '</a> &nbsp;Dig&atilde;o e Rodolfo</td></tr>')
    >>> [row] = parse_index(html, "https://www.beakauffmann.com/mpb_m.html")
    >>> row.title, row.composers
    ('MULHER DE FASES', 'Digão e Rodolfo')
    >>> row.page_url
    'https://www.beakauffmann.com/mpb_m/mulher-de-fases.html'
    """
    reader = _IndexReader()
    reader.feed(html)
    reader.close()
    rows = []
    for href, link_text, after_link in reader.songs:
        subtitle, composers = _split_after_link(_squeeze(after_link))
        title = _squeeze(f"{link_text} {subtitle}")
        rows.append(IndexRow(title, composers, urljoin(base_url, href)))
    return rows


def parse_song_page(html: str, page_url: str) -> SongPage:
    """Return the performer and the MIDI links of a song page.

    Args:
        html: text of the song page.
        page_url: URL of the song page, to make the MIDI links absolute.

    >>> page = ('<title>MULHER DE FASES - Raimundos - MIDI e Letra da M&uacute;sica - Lyric'
    ...         '</title><a href="som/mulher-de-fases.mid">MIDI</a>')
    >>> song = parse_song_page(page, "https://www.beakauffmann.com/mpb_m/mulher-de-fases.html")
    >>> song.performer
    'Raimundos'
    >>> song.midi_urls
    ('https://www.beakauffmann.com/mpb_m/som/mulher-de-fases.mid',)
    """
    reader = _SongPageReader()
    reader.feed(html)
    reader.close()
    midi_urls = [urljoin(page_url, href) for href in reader.hrefs if _is_midi_link(href)]
    return SongPage(_performer(_squeeze(reader.title)), tuple(dict.fromkeys(midi_urls)))


def _squeeze(text: str) -> str:
    # str.split() also splits on the non-breaking spaces that the site puts around its separators.
    return " ".join(text.split())


def _split_after_link(after_link: str) -> tuple[str, str]:
    """Split the text after a song link into a parenthesized subtitle and the composers."""
    if after_link.startswith("(") and ")" in after_link:
        end = after_link.index(")") + 1
        return after_link[:end], after_link[end:].strip()
    return "", after_link


def _performer(page_title: str) -> str:
    """Return the performer from "TITLE - Performer - MIDI e Letra da Música - Lyric"."""
    fields = FIELD_SEPARATOR.split(SITE_LABEL.sub("", page_title))
    # The performer is the last field, so a title that contains " - " still gives the performer.
    return fields[-1].strip() if len(fields) > 1 else ""


def _is_midi_link(href: str) -> bool:
    return urlsplit(href).path.lower().endswith(".mid")


class _IndexReader(HTMLParser):
    """Collect (href, link text, text after the link) for each song link of an index page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.songs: list[tuple[str, str, str]] = []
        self._in_song_link = False
        self._after_song_link = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._after_song_link = False
            attributes = dict(attrs)
            href = attributes.get("href") or ""
            classes = (attributes.get("class") or "").split()
            if SONG_LINK_CLASS in classes and SONG_HREF.fullmatch(href):
                self.songs.append((href, "", ""))
                self._in_song_link = True
        elif tag in ("td", "tr", "br", "table"):
            self._after_song_link = False

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_song_link:
            self._in_song_link = False
            self._after_song_link = True
        elif tag in ("td", "tr", "table"):
            self._after_song_link = False

    def handle_data(self, data: str) -> None:
        if not self.songs or not (self._in_song_link or self._after_song_link):
            return
        href, link_text, after_link = self.songs[-1]
        if self._in_song_link:
            self.songs[-1] = (href, link_text + data, after_link)
        else:
            self.songs[-1] = (href, link_text, after_link + data)


class _SongPageReader(HTMLParser):
    """Collect the `<title>` text and every link target of a song page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.hrefs: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        elif tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
