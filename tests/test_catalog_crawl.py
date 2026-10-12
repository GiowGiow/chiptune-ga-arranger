"""Crawling the MPB MIDI catalog politely, and writing `catalog.json` (contracts/files.md).

The site here is a fake: a dictionary of synthetic pages served by an injected `fetch`, with an
injected `sleep` that records the pauses instead of waiting. No test touches the network.
"""

import argparse
import json
import urllib.error
from pathlib import Path

import pytest

from catalog.crawl import (
    ALL_LETTERS,
    CatalogEntry,
    add_catalog_parser,
    cache_path,
    crawl,
    fetch_url,
    run_catalog,
    write_catalog,
)
from leadsheet.sources import USER_AGENT

SITE = "https://www.beakauffmann.com/"
DELAY = 1.5


def index_page(*rows: tuple[str, str, str]) -> bytes:
    """An index page with one row per (slug path, title, composers)."""
    body = "".join(
        f'<tr><td><a href="{path}" class="BB"><b>{title}</b></a> &nbsp;{composers}</td></tr>'
        for path, title, composers in rows
    )
    return f'<a href="mpb_b.html" class="BK">B</a><table>{body}</table>'.encode()


def song_page(title: str, performer: str, *midi_links: str) -> bytes:
    anchors = "".join(f'<a href="{link}">MIDI</a>' for link in midi_links)
    return f"<title>{title} - {performer} - MIDI e Letra da M&uacute;sica</title>{anchors}".encode()


class FakeSite:
    """Serves synthetic pages, records each fetch, and fails on the URLs it is told to fail."""

    def __init__(self, pages: dict[str, bytes], failing: tuple[str, ...] = ()) -> None:
        self.pages = pages
        self.failing = failing
        self.fetched: list[str] = []

    def fetch(self, url: str) -> bytes:
        self.fetched.append(url)
        if url in self.failing or url not in self.pages:
            raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
        return self.pages[url]


class Pauses:
    def __init__(self) -> None:
        self.seconds: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.seconds.append(seconds)


def small_site() -> dict[str, bytes]:
    """Letter A with two songs, letter M with one song and one song page without MIDI."""
    return {
        SITE + "mpb_a.html": index_page(
            ("mpb_a/aquarela.html", "AQUARELA", "Toquinho e Vinicius"),
            ("mpb_a/andanca.html", "ANDAN&Ccedil;A", "Danilo Caymmi"),
        ),
        SITE + "mpb_a/aquarela.html": song_page("AQUARELA", "Toquinho", "som/aquarela.mid"),
        SITE + "mpb_a/andanca.html": song_page(
            "ANDAN&Ccedil;A", "Beth Carvalho", "som/andanca.mid"
        ),
        SITE + "mpb_m.html": index_page(
            ("mpb_m/mulher-de-fases.html", "MULHER DE FASES", "Dig&atilde;o e Rodolfo"),
            ("mpb_m/maracatu.html", "MARACATU", "Nobody"),
        ),
        SITE + "mpb_m/mulher-de-fases.html": song_page(
            "MULHER DE FASES", "Raimundos", "som/mulher-de-fases.mid"
        ),
        SITE + "mpb_m/maracatu.html": song_page("MARACATU", "Somebody", "letra.html"),
    }


def run(site: FakeSite, cache_dir: Path, letters=("a", "m"), delay: float = DELAY, log=None):
    pauses = Pauses()
    lines: list[str] = []
    result = crawl(
        list(letters),
        cache_dir,
        delay,
        fetch=site.fetch,
        sleep=pauses,
        log=lines.append if log is None else log,
    )
    return result, pauses.seconds, lines


# --- The crawl ---


def test_an_entry_joins_the_index_row_and_the_song_page(tmp_path):
    result, _, _ = run(FakeSite(small_site()), tmp_path)

    assert (
        CatalogEntry(
            title="MULHER DE FASES",
            composers="Digão e Rodolfo",
            performer="Raimundos",
            page_url=SITE + "mpb_m/mulher-de-fases.html",
            midi_urls=(SITE + "mpb_m/som/mulher-de-fases.mid",),
        )
        in result.entries
    )
    assert len(result.entries) == 3


def test_the_crawl_pauses_for_the_delay_between_real_fetches(tmp_path):
    site = FakeSite(small_site())

    _, pauses, _ = run(site, tmp_path)

    assert len(site.fetched) == 6
    assert pauses == [DELAY] * 5


def test_a_cached_page_is_never_fetched_again_and_needs_no_pause(tmp_path):
    first, _, _ = run(FakeSite(small_site()), tmp_path)
    site = FakeSite(small_site())

    second, pauses, _ = run(site, tmp_path)

    assert site.fetched == []
    assert pauses == []
    assert second == first


def test_a_song_listed_twice_is_fetched_once_and_kept_once(tmp_path):
    pages = small_site()
    pages[SITE + "mpb_m.html"] = index_page(
        ("mpb_m/mulher-de-fases.html", "MULHER DE FASES", "Dig&atilde;o e Rodolfo"),
        ("mpb_m/mulher-de-fases.html", "MULHER DE FASES", "Dig&atilde;o e Rodolfo"),
    )
    site = FakeSite(pages)

    result, _, _ = run(site, tmp_path, letters=["m"])

    assert site.fetched.count(SITE + "mpb_m/mulher-de-fases.html") == 1
    assert len(result.entries) == 1


def test_pages_are_cached_under_their_url_path(tmp_path):
    run(FakeSite(small_site()), tmp_path)

    assert (tmp_path / "mpb_m.html").exists()
    assert (tmp_path / "mpb_m" / "mulher-de-fases.html").read_bytes() == small_site()[
        SITE + "mpb_m/mulher-de-fases.html"
    ]


def test_a_failing_page_is_skipped_counted_and_retried_on_the_next_crawl(tmp_path):
    failing = SITE + "mpb_a/andanca.html"

    result, _, lines = run(FakeSite(small_site(), failing=(failing,)), tmp_path)

    assert result.failed == 1
    assert [entry.title for entry in result.entries if entry.title.startswith("A")] == ["AQUARELA"]
    assert any(failing in line for line in lines)
    retry = FakeSite(small_site())
    run(retry, tmp_path)
    assert retry.fetched == [failing]


def test_a_failing_index_page_is_counted_and_the_other_letters_go_on(tmp_path):
    result, _, _ = run(FakeSite(small_site()), tmp_path, letters=["b", "m"])

    assert result.failed == 1
    assert [entry.title for entry in result.entries] == ["MULHER DE FASES"]


def test_an_entry_without_a_midi_link_is_dropped_and_counted(tmp_path):
    result, _, _ = run(FakeSite(small_site()), tmp_path, letters=["m"])

    assert result.dropped == 1
    assert "MARACATU" not in [entry.title for entry in result.entries]


def test_a_delay_below_one_second_is_refused_before_any_fetch(tmp_path):
    site = FakeSite(small_site())

    with pytest.raises(ValueError, match="1.0"):
        run(site, tmp_path, delay=0.5)
    assert site.fetched == []


def test_progress_is_logged_every_100_pages(tmp_path):
    slugs = [f"song-{number:03d}" for number in range(150)]
    pages = {SITE + "mpb_s.html": index_page(*((f"mpb_s/{s}.html", s, "X") for s in slugs))}
    pages |= {SITE + f"mpb_s/{s}.html": song_page(s, "Y", f"som/{s}.mid") for s in slugs}

    _, _, lines = run(FakeSite(pages), tmp_path, letters=["s"])

    progress = [line for line in lines if "pages" in line]
    assert len(progress) == 1
    assert progress[0].startswith("100 pages")


# --- Cache file names and the real fetch ---


def test_the_cache_file_mirrors_the_url_path_and_cannot_leave_the_cache_folder():
    cache = Path("cache")

    assert cache_path(cache, SITE + "mpb_m/mulher-de-fases.html") == Path(
        "cache/mpb_m/mulher-de-fases.html"
    )
    assert cache_path(cache, SITE + "../../etc/pass wd").parts[:1] == ("cache",)
    assert ".." not in cache_path(cache, SITE + "a/../../b.html").parts


def test_fetch_url_sends_the_project_user_agent():
    sent = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b"<html></html>"

    def opener(request, timeout=None):
        sent.append(request)
        return Response()

    assert fetch_url(SITE + "mpb_m.html", opener=opener) == b"<html></html>"
    assert sent[0].get_header("User-agent") == USER_AGENT


# --- catalog.json ---


def test_write_catalog_writes_the_contract_json_sorted_by_title_ignoring_accents_and_case(
    tmp_path,
):
    def entry(title: str) -> CatalogEntry:
        slug = title.lower()
        return CatalogEntry(
            title, "Composer", "Performer", f"{SITE}x/{slug}.html", (f"{SITE}x/som/{slug}.mid",)
        )

    path = tmp_path / "data" / "catalog.json"

    write_catalog([entry("Zebra"), entry("Ábaco"), entry("abelha")], path, "2026-10-12")

    record = json.loads(path.read_text(encoding="utf-8"))
    assert list(record) == ["source", "home", "note", "retrieved", "entries"]
    assert record["source"] == "Beatriz Kauffmann's Web Site"
    assert record["home"] == SITE
    assert "All Rights Reserved" in record["note"]
    assert record["retrieved"] == "2026-10-12"
    assert [entry["t"] for entry in record["entries"]] == ["Ábaco", "abelha", "Zebra"]
    assert record["entries"][0] == {
        "t": "Ábaco",
        "c": "Composer",
        "p": "Performer",
        "u": f"{SITE}x/ábaco.html",
        "m": [f"{SITE}x/som/ábaco.mid"],
    }
    assert "Ábaco" in path.read_text(encoding="utf-8")  # UTF-8, not \u escapes


# --- The `catalog` command ---


def catalog_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    add_catalog_parser(parser.add_subparsers(dest="command", required=True))
    return parser


def test_the_catalog_command_defaults_follow_the_cli_contract():
    args = catalog_parser().parse_args(["catalog"])

    assert args.out == Path("arranger/data/catalog.json")
    assert args.cache == Path("data/raw/catalog")
    assert args.delay == 1.0
    assert args.letters == list(ALL_LETTERS)
    assert len(ALL_LETTERS) == 27
    assert args.handler is run_catalog


def test_letters_are_read_from_a_comma_separated_list():
    args = catalog_parser().parse_args(["catalog", "--letters", "0-9, a,M"])

    assert args.letters == ["0-9", "a", "m"]


def test_an_unknown_letter_is_refused(capsys):
    with pytest.raises(SystemExit):
        catalog_parser().parse_args(["catalog", "--letters", "a,ç"])
    assert "ç" in capsys.readouterr().err


def test_run_catalog_crawls_writes_the_catalog_and_prints_the_counts(tmp_path, capsys):
    out = tmp_path / "catalog.json"
    args = catalog_parser().parse_args(
        ["catalog", "--letters", "a,m", "--out", str(out), "--cache", str(tmp_path / "cache")]
    )
    site = FakeSite(small_site())

    result = run_catalog(args, fetch=site.fetch, sleep=Pauses())

    assert result.dropped == 1
    record = json.loads(out.read_text(encoding="utf-8"))
    assert [entry["t"] for entry in record["entries"]] == [
        "ANDANÇA",
        "AQUARELA",
        "MULHER DE FASES",
    ]
    printed = capsys.readouterr().out
    assert "3 entries" in printed
    assert "1 dropped" in printed
    assert "0 pages failed" in printed
