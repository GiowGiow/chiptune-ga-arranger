"""Writing a lead sheet as ABC: the ABC reader must read back the very same lead sheet."""

import json
from dataclasses import replace
from pathlib import Path

import pretty_midi
import pytest

import main
from config import load_config
from leadsheet.abc_reader import read_lead_sheet, read_lead_sheet_text
from leadsheet.abc_writer import lead_sheet_to_abc
from leadsheet.chords import chord_tones
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote
from leadsheet.sources import file_sha256, load_sources

ROOT = Path(__file__).resolve().parent.parent
LEADSHEETS = ROOT / "data" / "leadsheets"


def chord(symbol: str, onset: float = 0.0, duration: float = 4.0) -> ChordSegment:
    root, tones = chord_tones(symbol)
    return ChordSegment(symbol, root, tones, onset, duration)


def bar(melody, chords=None, index=0, label="A", phrase=0, phrase_end=True) -> Bar:
    """One bar; melody is a list of (pitch, onset, duration)."""
    notes = tuple(MelodyNote(*note) for note in melody)
    return Bar(index, notes, tuple(chords or [chord("C")]), label, "verse", phrase, phrase_end)


def sheet(*bars: Bar, key="C major", tempo=120.0, title="Test") -> LeadSheet:
    return LeadSheet(title=title, key=key, tempo_bpm=tempo, bars=bars)


def tune(melody, chords=None, key="C major", tempo=120.0, title="Test") -> LeadSheet:
    """A bar with this melody, then a bar holding middle C: music21 finds the bars of a tune
    only when it has at least two bar lines."""
    first = bar(melody, chords, index=0, phrase_end=False)
    return sheet(first, bar([(60, 0.0, 4.0)], index=1), key=key, tempo=tempo, title=title)


def round_trip(lead_sheet: LeadSheet, phrase_length=4, role_map=None) -> LeadSheet:
    text = lead_sheet_to_abc(lead_sheet, phrase_length)
    return read_lead_sheet_text(text, phrase_length, role_map)


# --- Melody and rhythm ---


def test_a_bar_of_quarter_notes_reads_back_unchanged():
    lead_sheet = tune([(60, 0.0, 1.0), (62, 1.0, 1.0), (64, 2.0, 1.0), (65, 3.0, 1.0)])

    assert round_trip(lead_sheet) == lead_sheet


def test_the_header_declares_four_four_sixteenth_units_tempo_and_key():
    text = lead_sheet_to_abc(tune([(60, 0.0, 4.0)]))

    assert "M:4/4" in text.splitlines()
    assert "L:1/16" in text.splitlines()
    assert "Q:1/4=120" in text.splitlines()
    assert "K:C" in text.splitlines()


def test_sixteenths_dotted_lengths_and_rests_read_back_unchanged():
    melody = [(60, 0.25, 0.5), (62, 0.75, 1.25), (64, 2.5, 0.25), (65, 3.0, 0.75)]
    lead_sheet = tune(melody)

    assert round_trip(lead_sheet) == lead_sheet


def test_a_bar_without_notes_is_one_rest():
    lead_sheet = sheet(
        bar([], index=0, phrase_end=False), bar([(67, 0.0, 4.0)], index=1, phrase_end=True)
    )

    assert round_trip(lead_sheet) == lead_sheet
    assert "z16" in lead_sheet_to_abc(lead_sheet)


def test_a_chord_change_inside_a_note_is_written_as_a_tie_and_reads_back_as_one_note():
    lead_sheet = tune([(67, 1.0, 2.0)], chords=[chord("C", 0.0, 2.0), chord("G", 2.0, 2.0)])

    text = lead_sheet_to_abc(lead_sheet)

    assert '"C"z4 G4- "G"G4 z4 |' in text
    assert round_trip(lead_sheet) == lead_sheet


def test_a_chord_change_during_a_rest_splits_the_rest():
    lead_sheet = tune([(60, 0.0, 1.0)], chords=[chord("Am", 0.0, 2.0), chord("E7", 2.0, 2.0)])

    assert '"Am"C4 z4 "E7"z8 |' in lead_sheet_to_abc(lead_sheet)
    assert round_trip(lead_sheet) == lead_sheet


def test_notes_from_two_octaves_below_to_two_octaves_above_middle_c_read_back_unchanged():
    melody = [(36, 0.0, 0.5), (47, 0.5, 0.5), (48, 1.0, 0.5), (59, 1.5, 0.5)]
    melody += [(60, 2.0, 0.5), (71, 2.5, 0.5), (84, 3.0, 0.5), (96, 3.5, 0.5)]
    lead_sheet = tune(melody)

    assert round_trip(lead_sheet) == lead_sheet


# --- Accidentals and keys ---


@pytest.mark.parametrize("key", ["C major", "a minor", "e- minor", "b minor", "C# major", ""])
def test_every_chromatic_pitch_reads_back_unchanged_in_any_key(key):
    # Two bars of twelve semitones, rising then falling, so letters repeat with and without
    # accidentals inside one bar.
    rising = [(60 + step, step * 0.25, 0.25) for step in range(12)] + [(72, 3.0, 1.0)]
    falling = [(72 - step, step * 0.25, 0.25) for step in range(12)] + [(60, 3.0, 1.0)]
    lead_sheet = sheet(
        bar(rising, index=0, phrase_end=False), bar(falling, index=1, phrase_end=True), key=key
    )

    assert round_trip(lead_sheet) == lead_sheet


def test_the_melody_reads_the_same_whether_accidentals_carry_through_the_bar_or_not():
    # ABC 2.1 carries an accidental to the end of the bar; older ABC applies it to one note.
    melody = [(66, 0.0, 1.0), (65, 1.0, 1.0), (78, 2.0, 1.0), (66, 3.0, 1.0)]
    lead_sheet = tune(melody)
    text = lead_sheet_to_abc(lead_sheet)
    older_abc = "\n".join(line for line in text.splitlines() if not line.startswith("%abc-"))

    assert text.startswith("%abc-2.1\n")
    assert read_lead_sheet_text(older_abc) == lead_sheet


def test_a_lead_sheet_without_key_is_written_with_k_none():
    lead_sheet = tune([(61, 0.0, 2.0), (70, 2.0, 2.0)], key="")

    assert "K:none" in lead_sheet_to_abc(lead_sheet).splitlines()
    assert round_trip(lead_sheet) == lead_sheet


def test_a_minor_key_is_written_as_an_abc_minor_key():
    lead_sheet = tune([(63, 0.0, 4.0)], chords=[chord("Ebm")], key="e- minor")

    assert "K:Ebm" in lead_sheet_to_abc(lead_sheet).splitlines()
    assert round_trip(lead_sheet).key == "e- minor"


# --- Form: labels, roles and phrases ---


def form_sheet(parts: list[tuple[str | None, int]], phrase_length: int = 4) -> LeadSheet:
    """A lead sheet read from parts (label or None for no part line, number of bars), so its
    phrases are those the reader computes."""
    lines = ["X:1", "T:Form", "M:4/4", "L:1/4", "Q:1/4=100", "K:C"]
    for number, (label, bar_count) in enumerate(parts):
        if label is not None:
            lines.append(f"P:{label}")
        bars = ["CDEF|"] * bar_count
        if number == 0:
            bars[0] = '"C"CDEF|'
        lines.append("".join(bars))
    return read_lead_sheet_text("\n".join(lines) + "\n", phrase_length)


def part_lines(lead_sheet: LeadSheet) -> list[str]:
    return [line for line in lead_sheet_to_abc(lead_sheet).splitlines() if line.startswith("P:")]


def test_part_labels_roles_and_phrases_read_back_for_the_same_phrase_length():
    lead_sheet = form_sheet([("A", 6), ("B", 4), ("A", 6)])
    as_chorus = tuple(
        replace(b, role="chorus" if b.label == "A" else b.role) for b in lead_sheet.bars
    )

    assert round_trip(lead_sheet) == lead_sheet
    assert round_trip(lead_sheet, role_map={"A": "chorus"}) == replace(lead_sheet, bars=as_chorus)


def test_a_part_that_repeats_its_label_after_a_short_phrase_gets_its_own_part_line():
    lead_sheet = form_sheet([("A", 6), ("A", 4)])

    assert part_lines(lead_sheet) == ["P:A", "P:A"]
    assert round_trip(lead_sheet) == lead_sheet


def test_bars_without_a_label_get_no_part_line():
    lead_sheet = form_sheet([(None, 2), ("B", 2)])

    assert part_lines(lead_sheet) == ["P:B"]
    assert round_trip(lead_sheet) == lead_sheet


def test_each_phrase_is_written_on_its_own_line():
    lead_sheet = form_sheet([("A", 8)])
    body = lead_sheet_to_abc(lead_sheet).split("P:A\n", 1)[1]

    assert len(body.strip().splitlines()) == 2


def test_a_phrase_longer_than_the_phrase_length_cannot_be_written():
    lead_sheet = form_sheet([("A", 8)], phrase_length=8)

    with pytest.raises(ValueError, match="phrase"):
        lead_sheet_to_abc(lead_sheet, phrase_length=4)


# --- Metadata ---


def test_title_and_comment_lines_are_written_in_the_header_and_ignored_by_the_reader():
    lead_sheet = tune([(60, 0.0, 4.0)], title="Por Você")

    text = lead_sheet_to_abc(lead_sheet, comments=["Our reduction.", "For academic use."])

    assert "% Our reduction.\n% For academic use.\n" in text
    assert text.index("% Our reduction.") < text.index("X:1")
    assert round_trip(lead_sheet).title == "Por Você"
    assert read_lead_sheet_text(text) == lead_sheet


def test_a_tempo_with_more_than_six_decimals_is_rounded_and_kept_exact_in_a_comment():
    lead_sheet = tune([(60, 0.0, 4.0)], tempo=110.09999999999715)

    text = lead_sheet_to_abc(lead_sheet)

    assert "Q:1/4=110.1" in text.splitlines()
    assert "110.09999999999715" in text
    assert round_trip(lead_sheet) == replace(lead_sheet, tempo_bpm=110.1)


# --- Lead sheets that ABC cannot hold ---


def test_a_note_off_the_sixteenth_grid_is_refused():
    with pytest.raises(ValueError, match="sixteenth"):
        lead_sheet_to_abc(tune([(60, 0.0, 1 / 3)]))


def test_overlapping_melody_notes_are_refused():
    with pytest.raises(ValueError, match="overlap"):
        lead_sheet_to_abc(tune([(60, 0.0, 2.0), (64, 1.0, 1.0)]))


def test_chords_that_leave_a_gap_in_the_bar_are_refused():
    with pytest.raises(ValueError, match="chord"):
        lead_sheet_to_abc(tune([(60, 0.0, 4.0)], chords=[chord("C", 0.0, 2.0)]))


# --- The project's lead sheets ---


@pytest.mark.parametrize("name", ["korobeiniki", "ievan_polkka"])
def test_the_hand_written_lead_sheets_read_back_unchanged(name):
    lead_sheet = read_lead_sheet(LEADSHEETS / f"{name}.abc")

    assert round_trip(lead_sheet) == lead_sheet


def sample_config(song) -> dict:
    """The configuration of the sample made from a song (only the keys of the defaults)."""
    recorded = json.loads((ROOT / "samples" / song.sample / "config.json").read_text())
    config = load_config()
    config.update({key: recorded[key] for key in config if key in recorded})
    return config


SONGS = load_sources(ROOT / "data" / "sources.json")


@pytest.mark.parametrize("song", SONGS, ids=[song.id for song in SONGS])
def test_every_midi_song_reads_back_unchanged_from_its_abc(song):
    if not (ROOT / song.path).exists():
        pytest.skip(f"{song.path} is not downloaded (uv run src/main.py fetch)")
    config = sample_config(song)
    lead_sheet = main.load_lead_sheet(ROOT / song.path, config)

    read_back = round_trip(lead_sheet, config["phrase_length"], config["role_map"])

    # ABC keeps the tempo to 6 decimals and has no beat grid of a recording.
    assert read_back == replace(
        lead_sheet, tempo_bpm=round(lead_sheet.tempo_bpm, 6), source_grid=None
    )


@pytest.mark.parametrize("song", SONGS, ids=[song.id for song in SONGS])
def test_every_committed_abc_lead_sheet_is_the_reduction_of_its_midi_song(song):
    if not (ROOT / song.path).exists():
        pytest.skip(f"{song.path} is not downloaded (uv run src/main.py fetch)")
    config = sample_config(song)
    from_midi = main.load_lead_sheet(ROOT / song.path, config)

    from_abc = main.load_lead_sheet(ROOT / song.abc, config)

    assert from_abc == replace(
        from_midi, title=song.title, tempo_bpm=round(from_midi.tempo_bpm, 6), source_grid=None
    )


@pytest.mark.parametrize("song", SONGS, ids=[song.id for song in SONGS])
def test_every_committed_abc_lead_sheet_holds_the_bars_of_its_excerpt(song):
    # Runs on a fresh clone, without the MIDI files.
    lead_sheet = read_lead_sheet(ROOT / song.abc)
    first_bar, end_bar = song.midi["bars"]

    assert len(lead_sheet.bars) == end_bar - first_bar
    assert lead_sheet.title == song.title
    assert "fan-made MIDI" in (ROOT / song.abc).read_text(encoding="utf-8")


# --- The abc command ---


def write_song(path: Path) -> None:
    """Four bars at 120 BPM: a melody track, a C-G chord track and a bass."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    melody = pretty_midi.Instrument(program=73, name="flute")
    chords = pretty_midi.Instrument(program=0, name="piano")
    bass = pretty_midi.Instrument(program=33, name="bass")
    for beat in range(16):
        melody.notes.append(pretty_midi.Note(90, 72 + beat % 3, beat * 0.5, beat * 0.5 + 0.45))
    for half in range(8):
        pitches = (60, 64, 67) if half % 2 == 0 else (55, 59, 62)
        for pitch in pitches:
            chords.notes.append(pretty_midi.Note(70, pitch, half, half + 1.0))
        bass.notes.append(pretty_midi.Note(80, pitches[0] - 24, half, half + 1.0))
    midi.instruments += [melody, chords, bass]
    path.parent.mkdir(parents=True, exist_ok=True)
    midi.write(str(path))


@pytest.fixture
def song_project(tmp_path, monkeypatch):
    """A folder with one MIDI song, its manifest entry and the sample made from it."""
    monkeypatch.chdir(tmp_path)
    write_song(Path("data/raw/song.mid"))
    midi = {"melody_track": 0, "bars": [0, 4], "sections": [[0, "A"], [2, "B"]], "grid": "auto"}
    config = {**load_config(), "midi": midi, "input_path": "data/raw/song.mid"}
    Path("samples/song-s1").mkdir(parents=True)
    Path("samples/song-s1/config.json").write_text(json.dumps(config))
    entry = {
        "id": "song",
        "title": "A Song",
        "artist": "A Band",
        "composers": [],
        "page_url": "https://example.org/song.html",
        "url": "https://example.org/song.mid",
        "sha256": file_sha256("data/raw/song.mid"),
        "path": "data/raw/song.mid",
        "abc": "data/leadsheets/song.abc",
        "sample": "song-s1",
        "midi": midi,
        "note": "",
    }
    Path("data/sources.json").write_text(json.dumps({"songs": [entry]}))
    return config


def test_the_abc_command_writes_the_reduction_of_a_sample_song(song_project, capsys):
    assert main.main(["abc", "samples/song-s1"]) == 0

    text = Path("data/leadsheets/song.abc").read_text(encoding="utf-8")
    assert "data/leadsheets/song.abc" in capsys.readouterr().out
    assert "fan-made MIDI" in text and "uv run src/main.py abc samples/song-s1" in text
    from_midi = main.load_lead_sheet(Path("data/raw/song.mid"), song_project)
    from_abc = main.load_lead_sheet(Path("data/leadsheets/song.abc"), song_project)
    assert from_abc == replace(from_midi, title="A Song", source_grid=None)


def test_the_abc_command_with_all_writes_every_song_of_the_manifest(song_project):
    assert main.main(["abc", "--all"]) == 0

    assert Path("data/leadsheets/song.abc").exists()


def test_the_abc_command_refuses_a_midi_file_that_is_not_the_one_of_the_manifest(
    song_project, capsys
):
    Path("data/raw/song.mid").write_bytes(b"MThd another sequence")

    assert main.main(["abc", "samples/song-s1"]) == 1
    assert "sha256" in capsys.readouterr().err
