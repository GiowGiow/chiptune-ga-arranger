"""The MIDI songs used as inputs: the manifest, the download with hash check, the provenance."""

import hashlib
import json
from pathlib import Path

import pytest

import main
from leadsheet.sources import (
    SongSource,
    fetch_song,
    file_sha256,
    load_sources,
    provenance_comments,
    require_song_file,
    song_for_input,
)

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "sources.json"
MIDI_BYTES = b"MThd\x00\x00\x00\x06\x00\x01\x00\x01\x01\xe0fake song"


def song_with(tmp_path, url: str | None, payload: bytes = MIDI_BYTES, **changes) -> SongSource:
    """A song whose file would be saved under tmp_path/raw/song.mid."""
    fields = {
        "id": "song",
        "title": "Song",
        "artist": "Band",
        "composers": ("Someone",),
        "page_url": None if url is None else "https://example.org/song.html",
        "url": url,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "path": Path("raw/song.mid"),
        "abc": Path("leadsheets/song.abc"),
        "sample": "song-s1",
        "midi": {"melody_track": 1, "bars": [0, 8], "sections": [[0, "A"]], "grid": "auto"},
        "note": "",
    }
    return SongSource(**{**fields, **changes})


def served_file(tmp_path, payload: bytes = MIDI_BYTES) -> str:
    """Put a file on disk and return its file:// URL, so the download needs no network."""
    path = tmp_path / "server" / "song.mid"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path.as_uri()


def refuse_network(request, timeout=None):
    raise AssertionError(f"no download expected, got {request.full_url}")


# --- The manifest ---


@pytest.fixture(scope="module")
def songs():
    return load_sources(MANIFEST)


def test_the_manifest_lists_the_six_midi_songs(songs):
    assert sorted(song.id for song in songs) == [
        "amor_i_love_you",
        "aquarela",
        "fico_assim_sem_voce",
        "mulher_de_fases",
        "por_voce",
        "voa_voa",
    ]


def test_every_song_names_its_file_in_data_raw_and_its_lead_sheet_in_data_leadsheets(songs):
    for song in songs:
        assert song.path.parts[:2] == ("data", "raw"), song.id
        assert song.path.suffix == ".mid", song.id
        assert song.abc.parent == Path("data/leadsheets"), song.id
        assert song.abc.suffix == ".abc", song.id
        assert len(song.sha256) == 64 and int(song.sha256, 16) >= 0, song.id


def test_every_song_but_voa_voa_has_a_page_and_a_direct_download(songs):
    for song in songs:
        if song.id == "voa_voa":
            assert song.url is None and song.page_url is None
            assert "YouTube" in song.note
        else:
            assert song.url.startswith(("http://", "https://")), song.id
            assert song.url.endswith(".mid"), song.id
            assert song.page_url.startswith(("http://", "https://")), song.id


def test_the_manifest_settings_are_those_of_the_sample_that_used_the_song(songs):
    for song in songs:
        recorded = json.loads((ROOT / "samples" / song.sample / "config.json").read_text())
        assert recorded["input_path"] == song.path.as_posix(), song.id
        assert recorded["input_sha256"] == song.sha256, song.id
        assert recorded["midi"] == song.midi, song.id


def test_a_sample_input_path_finds_its_song(songs):
    assert song_for_input(songs, "data/raw/mpb/aquarela.mid").id == "aquarela"
    with pytest.raises(ValueError, match="not listed"):
        song_for_input(songs, "data/raw/unknown.mid")


# --- The download ---


def test_fetch_downloads_a_missing_file_and_checks_its_hash(tmp_path):
    song = song_with(tmp_path, served_file(tmp_path))

    status = fetch_song(song, root=tmp_path)

    assert status == "downloaded"
    assert (tmp_path / "raw" / "song.mid").read_bytes() == MIDI_BYTES
    assert file_sha256(tmp_path / "raw" / "song.mid") == song.sha256


def test_fetch_skips_a_file_already_present_with_the_right_hash(tmp_path):
    song = song_with(tmp_path, "https://example.org/song.mid")
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "song.mid").write_bytes(MIDI_BYTES)

    assert fetch_song(song, root=tmp_path, opener=refuse_network) == "present"


def test_fetch_refuses_a_download_with_another_hash_and_keeps_no_file(tmp_path):
    song = song_with(tmp_path, served_file(tmp_path, b"MThd another file"))

    with pytest.raises(ValueError, match="sha256"):
        fetch_song(song, root=tmp_path)
    assert not (tmp_path / "raw" / "song.mid").exists()


def test_fetch_replaces_a_present_file_whose_hash_is_wrong(tmp_path):
    song = song_with(tmp_path, served_file(tmp_path))
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "song.mid").write_bytes(b"truncated")

    assert fetch_song(song, root=tmp_path) == "downloaded"
    assert (tmp_path / "raw" / "song.mid").read_bytes() == MIDI_BYTES


def test_a_song_without_a_public_url_is_reported_and_not_downloaded(tmp_path):
    song = song_with(tmp_path, None)

    assert fetch_song(song, root=tmp_path, opener=refuse_network) == "no url"
    assert not (tmp_path / "raw" / "song.mid").exists()


def test_fetch_identifies_itself_with_a_user_agent(tmp_path):
    # Some sites refuse Python's default user agent (HTTP 406), so the request names the project.
    seen = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return MIDI_BYTES

    def opener(request, timeout=None):
        seen["agent"] = request.get_header("User-agent")
        return Response()

    fetch_song(song_with(tmp_path, "https://example.org/song.mid"), root=tmp_path, opener=opener)

    assert seen["agent"] and "python" not in seen["agent"].lower()


def test_a_failed_download_is_reported_as_an_error_with_the_url(tmp_path):
    song = song_with(tmp_path, (tmp_path / "nowhere.mid").as_uri())

    with pytest.raises(ValueError, match="nowhere.mid"):
        fetch_song(song, root=tmp_path)


# --- Checking the song file before reducing it ---


def test_a_missing_song_file_points_to_the_fetch_command(tmp_path):
    with pytest.raises(ValueError, match="fetch"):
        require_song_file(song_with(tmp_path, "https://example.org/song.mid"), root=tmp_path)


def test_a_missing_song_without_url_points_to_its_committed_lead_sheet(tmp_path):
    with pytest.raises(ValueError, match="leadsheets/song.abc"):
        require_song_file(song_with(tmp_path, None), root=tmp_path)


def test_a_song_file_with_another_hash_is_refused(tmp_path):
    song = song_with(tmp_path, "https://example.org/song.mid")
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "song.mid").write_bytes(b"another sequence")

    with pytest.raises(ValueError, match="sha256"):
        require_song_file(song, root=tmp_path)


def test_a_song_file_with_the_right_hash_is_returned(tmp_path):
    song = song_with(tmp_path, "https://example.org/song.mid")
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "song.mid").write_bytes(MIDI_BYTES)

    assert require_song_file(song, root=tmp_path) == tmp_path / "raw" / "song.mid"


# --- Provenance written into the ABC lead sheet ---


def test_provenance_says_it_is_our_reduction_of_a_fan_made_midi_for_academic_use(tmp_path):
    song = song_with(tmp_path, "https://example.org/song.mid")

    comments = provenance_comments(song, song.midi, "uv run src/main.py abc samples/song-s1")

    text = "\n".join(comments)
    assert "Song" in text and "Band" in text
    assert "reduction" in text and "fan-made MIDI" in text and "academic" in text
    assert "https://example.org/song.mid" in text and song.sha256 in text
    assert "melody track 1" in text and "bars 0-8" in text
    assert "uv run src/main.py abc samples/song-s1" in text
    assert all('"' not in line for line in comments)


def test_provenance_of_a_song_without_url_says_where_it_came_from(tmp_path):
    song = song_with(tmp_path, None, note="Collected from a YouTube video description.")

    command = "uv run src/main.py abc samples/song-s1"
    text = "\n".join(provenance_comments(song, song.midi, command))

    assert "no public download" in text and "YouTube" in text


# --- The fetch command ---


def test_the_fetch_command_reports_each_song(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    online = song_with(tmp_path, served_file(tmp_path))
    offline = song_with(tmp_path, None, id="offline", path=Path("raw/offline.mid"))
    manifest = tmp_path / "sources.json"
    manifest.write_text(json.dumps({"songs": [_as_json(online), _as_json(offline)]}))

    assert main.main(["fetch", "--sources", str(manifest)]) == 0

    output = capsys.readouterr().out
    assert "downloaded raw/song.mid" in output
    assert "offline" in output and "cannot be downloaded" in output
    assert (tmp_path / "raw" / "song.mid").exists()


def test_the_fetch_command_fails_with_a_clear_message_on_a_hash_mismatch(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.chdir(tmp_path)
    song = song_with(tmp_path, served_file(tmp_path, b"MThd changed"), sha256="0" * 64)
    manifest = tmp_path / "sources.json"
    manifest.write_text(json.dumps({"songs": [_as_json(song)]}))

    assert main.main(["fetch", "--sources", str(manifest)]) == 1
    assert "sha256" in capsys.readouterr().err


def _as_json(song: SongSource) -> dict:
    record = {**song.__dict__}
    record["composers"] = list(song.composers)
    record["path"], record["abc"] = song.path.as_posix(), song.abc.as_posix()
    return record
