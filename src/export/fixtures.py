"""Parity fixtures: the Python reference values that the web arranger's tests compare against.

The web arranger (`arranger/`) reimplements the lead-sheet readers, the realizers, the score
tables and the fitness in JavaScript. Its random generator differs from numpy's, so a seed gives a
different arrangement in the browser (spec 002, FR-028), but everything that does not draw random
numbers must agree with this Python code, which stays the reference implementation (constitution,
principle I). This module writes that reference as JSON files, one concern per folder:

- `chords.json`: the root and tones of every chord symbol the lead sheets use, plus common ones;
- `leadsheets/<id>.json`: each committed ABC lead sheet as the Python reader reads it;
- `realizations/<id>.json`: the notes of every (bar, channel, gene value) choice;
- `tables/<id>.json`: the score tables the fitness looks up;
- `plans/<sample>.json`: each sample's best plan (rerun from its seed), its criterion scores,
  its fitness and its arrangement (see "Samples that no longer match" below);
- `midi-songs/<id>.json`: how pretty_midi lists a MIDI song's instruments, and the lead sheet the
  MIDI reader reduces from it (only for songs whose file is in `data/raw/`);
- `abc/<id>.abc`: the ABC writer's text of each MIDI-song lead sheet.

Meters (spec 003). The project's own test tunes in `tests/data/meters/` (a waltz, a polka, a jig,
a 12/8, 5/4 and 7/8 tune, and one whose meter changes) get a lead sheet, realizations, tables, the
writer's text and a fixed plan (`plans/meters-<id>.json`), and four small synthetic MIDI songs
built here (`midi-songs/synthetic-*.mid`, in 3/4, 12/8, with meter changes and with a drum-only
count-in) get their reduction. Both are the project's own, so they are committed.

JSON has no NaN, so a NaN (a criterion or a bass leap that does not apply) is written as null.
Field names stay the Python ones (`phrase_end`, `tempo_bpm`); the JavaScript tests translate them.

Samples that no longer match. A plan is rerun from the sample's `config.json` (seed and
hyperparameters) on the lead sheet committed today. When the reduction of a MIDI song changes,
its ABC lead sheet changes, and the rerun no longer reaches the best fitness the sample recorded.
The command then prints a notice that names the sample and writes the rerun's plan anyway: the
parity tests only need a plan scored by Python on the current lead sheet, and the notice says the
sample itself is stale until it is made again. The test suite still checks that a sample whose
lead sheet did not change (korobeiniki-s1) reruns to its recorded fitness.
"""

import dataclasses
import json
import math
import re
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import pretty_midi

from arrangement.assemble import assemble
from arrangement.textures import realize_no, realize_p1, realize_p2, realize_tr
from config import load_config
from ga.evolution import evolve, ga_params
from ga.fitness import CRITERIA, criterion_scores, fitness
from ga.genome import GENE_SIZES, NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES
from ga.tables import build_tables
from leadsheet.abc_reader import read_lead_sheet
from leadsheet.abc_writer import lead_sheet_to_abc
from leadsheet.chords import chord_tones
from leadsheet.meter import Meter, groups
from leadsheet.midi_reader import read_lead_sheet_midi
from leadsheet.model import LeadSheet
from leadsheet.sources import load_sources

PHRASE_LENGTH = 4
REALIZATION_IDS = ("korobeiniki", "mulher_de_fases")
METER_TUNES_DIR = Path("tests/data/meters")

# Synthetic MIDI songs: (numerator, denominator, bars, plays music) segments. A segment that
# plays no music is a drum-only count-in.
SYNTHETIC_SONGS = {
    "synthetic-waltz": ((3, 4, 8, True),),
    "synthetic-twelve-eight": ((12, 8, 4, True),),
    "synthetic-changes": ((4, 4, 2, True), (2, 4, 2, True), (4, 4, 2, True)),
    "synthetic-count-in": ((3, 4, 2, False), (4, 4, 4, True)),
}
SYNTHETIC_SETTINGS = {"melody_track": 0, "bars": None, "sections": None, "grid": "auto"}
# Chord qualities that arbitrary ABC tunes use, beyond the ones in the committed lead sheets.
EXTRA_CHORD_SYMBOLS = (
    "Cmaj7",
    "Cdim",
    "Cdim7",
    "Cm7b5",
    "Caug",
    "Csus2",
    "Csus4",
    "C6",
    "Cm6",
    "C9",
    "Cadd9",
    "F#m7",
    "Ebmaj7",
    "H7",
    "Cxyz",
)
CHORD_SYMBOL = re.compile(r'"([^"]+)"')


def write_fixtures(
    out: Path | str,
    samples_dir: Path | str = "samples",
    sources_path: Path | str = "data/sources.json",
    leadsheets_dir: Path | str = "data/leadsheets",
    sample_names: Sequence[str] | None = None,
    leadsheet_ids: Sequence[str] | None = None,
    realization_ids: Sequence[str] = REALIZATION_IDS,
    meter_tunes_dir: Path | str | None = METER_TUNES_DIR,
    log: Callable[[str], None] = print,
) -> None:
    """Write every parity fixture into `out` (see the module docstring for the files).

    Args:
        out: fixture folder, `arranger/tests/fixtures` by default on the command line.
        samples_dir: folder of the samples whose plans are rerun.
        sources_path: manifest of the MIDI songs (`data/sources.json`).
        leadsheets_dir: folder of the committed ABC lead sheets.
        sample_names: samples to rerun; all folders of `samples_dir` by default.
        leadsheet_ids: lead sheets to export; every `*.abc` of `leadsheets_dir` by default.
        realization_ids: lead sheets whose realizations are exported (they are large).
        meter_tunes_dir: folder of the meter test tunes (spec 003); None skips them and the
            synthetic MIDI songs.
        log: where notices go: the missing MIDI files and the samples whose rerun does not reach
            their recorded best fitness.
    """
    out, samples_dir, leadsheets_dir = Path(out), Path(samples_dir), Path(leadsheets_dir)
    songs = load_sources(sources_path)
    if leadsheet_ids is None:
        leadsheet_ids = sorted(path.stem for path in leadsheets_dir.glob("*.abc"))
    sheets = {i: read_lead_sheet(leadsheets_dir / f"{i}.abc") for i in leadsheet_ids}

    abc_texts = [(leadsheets_dir / f"{i}.abc").read_text() for i in leadsheet_ids]
    _write_json(out / "chords.json", chord_fixture(abc_texts))
    for sheet_id, sheet in sheets.items():
        _write_json(out / "leadsheets" / f"{sheet_id}.json", lead_sheet_json(sheet))
        _write_json(out / "tables" / f"{sheet_id}.json", tables_json(sheet))
    for sheet_id in realization_ids:
        sheet = sheets.get(sheet_id) or read_lead_sheet(leadsheets_dir / f"{sheet_id}.abc")
        _write_json(out / "realizations" / f"{sheet_id}.json", realizations_json(sheet))

    abc_for_sample = {song.sample: song.abc.stem for song in songs}
    if sample_names is None:
        sample_names = sorted(path.parent.name for path in samples_dir.glob("*/config.json"))
    for name in sample_names:
        record_path = samples_dir / name / "config.json"
        record = json.loads(record_path.read_text())
        sheet_id = abc_for_sample.get(name, Path(record["input_path"]).stem)
        sheet = sheets.get(sheet_id) or read_lead_sheet(leadsheets_dir / f"{sheet_id}.abc")
        plan = plan_json(name, sheet_id, sheet, load_config(record_path), record, log)
        _write_json(out / "plans" / f"{name}.json", plan)

    for song in songs:
        abc_text = lead_sheet_to_abc(read_lead_sheet(song.abc), PHRASE_LENGTH)
        (out / "abc").mkdir(parents=True, exist_ok=True)
        (out / "abc" / f"{song.id}.abc").write_text(abc_text)
        if not song.path.exists():
            log(f"{song.id}: {song.path} is missing; run `uv run src/main.py fetch` first")
            continue
        _write_json(out / "midi-songs" / f"{song.id}.json", midi_song_json(song.path, song.midi))

    if meter_tunes_dir is None:
        return
    for path in sorted(Path(meter_tunes_dir).glob("*.abc")):
        sheet = read_lead_sheet(path, PHRASE_LENGTH)
        _write_json(out / "leadsheets" / f"{path.stem}.json", lead_sheet_json(sheet))
        _write_json(out / "tables" / f"{path.stem}.json", tables_json(sheet))
        _write_json(out / "realizations" / f"{path.stem}.json", realizations_json(sheet))
        _write_json(out / "plans" / f"meters-{path.stem}.json", meter_plan_json(path.stem, sheet))
        (out / "abc" / f"{path.stem}.abc").write_text(lead_sheet_to_abc(sheet, PHRASE_LENGTH))
    for name, segments in SYNTHETIC_SONGS.items():
        midi_path = out / "midi-songs" / f"{name}.mid"
        midi_path.parent.mkdir(parents=True, exist_ok=True)
        synthetic_song(segments).write(str(midi_path))
        _write_json(midi_path.with_suffix(".json"), midi_song_json(midi_path, SYNTHETIC_SETTINGS))


def chord_fixture(abc_texts: Sequence[str]) -> dict:
    """Root and tones of every chord symbol in the ABC texts and in EXTRA_CHORD_SYMBOLS.

    Symbols that music21 does not know go to "rejected", so the JavaScript reader can be checked
    to refuse them too.

    >>> fixture = chord_fixture(['K:C\\n"Am"A4 "Bbm7"B4|'])
    >>> fixture["symbols"]["Am"], fixture["symbols"]["Bbm7"], fixture["rejected"]
    ([9, [9, 0, 4]], [10, [10, 1, 5, 8]], ['Cxyz', 'H7'])
    """
    symbols: set[str] = set(EXTRA_CHORD_SYMBOLS)
    for text in abc_texts:
        body = "\n".join(line for line in text.splitlines() if not line.startswith("%"))
        symbols.update(CHORD_SYMBOL.findall(body))
    known, rejected = {}, []
    for symbol in sorted(symbols):
        try:
            root, tones = chord_tones(symbol)
        except ValueError:
            rejected.append(symbol)
            continue
        known[symbol] = [root, list(tones)]
    return {"symbols": known, "rejected": rejected}


def lead_sheet_json(lead_sheet: LeadSheet) -> dict:
    """The lead sheet as nested dictionaries with the Python field names; a meter is "3/4"."""
    content = _plain(dataclasses.asdict(lead_sheet))
    for bar_json, bar in zip(content["bars"], lead_sheet.bars, strict=True):
        bar_json["meter"] = str(bar.meter)
    return content


def tables_json(lead_sheet: LeadSheet) -> dict:
    """Every array of the lead sheet's score tables, as nested lists (NaN as None)."""
    tables = build_tables(lead_sheet)
    return {field.name: _plain(getattr(tables, field.name)) for field in dataclasses.fields(tables)}


def realizations_json(lead_sheet: LeadSheet) -> dict:
    """The notes of every gene value of every channel in every bar, as [pitch, onset, dur, vel].

    TR realizations read the next bar (the walking bass leads into its root), so they are taken
    with the same neighbor as in the tables. NO patterns depend only on the bar's meter.
    """
    bars = lead_sheet.bars
    realized = []
    for index, bar in enumerate(bars):
        next_bar = bars[index + 1] if index + 1 < len(bars) else None
        realized.append(
            {
                "p1": [_notes(realize_p1(bar, gene)) for gene in range(len(P1_OCTAVES))],
                "p2": [_notes(realize_p2(bar, gene)) for gene in range(len(P2_TEXTURES))],
                "tr": [_notes(realize_tr(bar, gene, next_bar)) for gene in range(len(TR_TEXTURES))],
                "no": [_notes(realize_no(gene, bar.meter)) for gene in range(len(NO_PATTERNS))],
            }
        )
    return {"bars": realized}


def plan_json(
    name: str,
    sheet_id: str,
    lead_sheet: LeadSheet,
    config: dict,
    record: dict,
    log: Callable[[str], None] = print,
) -> dict:
    """Rerun a sample's GA from its record and return its plan, scores, fitness and arrangement.

    `config` is the record loaded as a configuration (`load_config` skips its run keys) and
    `record` the raw record, for the seed and the recorded best fitness. The rerun reads the
    committed ABC lead sheet, so it needs no MIDI file. When its best fitness differs from the
    recorded one, `log` gets a notice naming the sample, and the plan of the rerun is returned
    anyway (see the module docstring).
    """
    params = ga_params(config)
    tables = build_tables(lead_sheet)
    result = evolve(
        np.random.default_rng(record["seed"]),
        tables,
        len(lead_sheet.bars),
        params,
        config["weights"],
    )
    if abs(result.best_fitness - record["best_fitness"]) > 1e-9:
        log(
            f"{name}: the rerun's best fitness {result.best_fitness} differs from the recorded "
            f"{record['best_fitness']}; its lead sheet changed since the sample was made, or the "
            f"GA did. The fixture holds the rerun's plan; remake the sample to match it again."
        )
    population = result.best_genome[np.newaxis]
    scores = criterion_scores(tables, population)
    arrangement = assemble(lead_sheet, result.best_genome)
    return {
        "sample": name,
        "leadsheet": sheet_id,
        "seed": record["seed"],
        "settings": config,
        "best_plan": result.best_genome.tolist(),
        "scores": {criterion: _plain(scores[criterion][0]) for criterion in CRITERIA},
        "fitness": float(fitness(tables, population, config["weights"])[0]),
        "arrangement": {channel: _notes(notes) for channel, notes in arrangement.channels.items()},
    }


def meter_plan_json(sheet_id: str, lead_sheet: LeadSheet) -> dict:
    """A fixed plan for a meter test tune, with its scores, fitness and arrangement.

    Bar b takes the value b mod (number of values) for every gene, so every texture and pattern
    appears in the tune; the scores use the default weights.
    """
    config = load_config()
    plan = np.array([[b % size for size in GENE_SIZES] for b in range(len(lead_sheet.bars))])
    tables = build_tables(lead_sheet)
    population = plan[np.newaxis]
    scores = criterion_scores(tables, population)
    arrangement = assemble(lead_sheet, plan)
    return {
        "leadsheet": sheet_id,
        "settings": {"weights": config["weights"]},
        "best_plan": plan.tolist(),
        "scores": {criterion: _plain(scores[criterion][0]) for criterion in CRITERIA},
        "fitness": float(fitness(tables, population, config["weights"])[0]),
        "arrangement": {channel: _notes(notes) for channel, notes in arrangement.channels.items()},
    }


def synthetic_song(segments: Sequence[tuple[int, int, int, bool]], tempo: float = 120.0):
    """A small band song in the given meters: melody, pad, bass and drums on every beat.

    Each segment is (numerator, denominator, bars, plays music). The melody (track 0, a flute)
    plays one note per beat, the pad holds a triad and the bass its root for each group of the
    meter (half bars in 4/4 and 12/8, the whole bar in 3/4), cycling C, F, G7, C; a segment
    that plays no music has drums only, like a count-in.

    >>> song = synthetic_song([(3, 4, 2, False), (4, 4, 1, True)])
    >>> [(ts.numerator, ts.denominator, ts.time) for ts in song.time_signature_changes]
    [(3, 4, 0.0), (4, 4, 3.0)]
    >>> [instrument.name for instrument in song.instruments]
    ['flute', 'pad', 'bass', 'drums']
    """
    seconds = 60.0 / tempo
    song = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    melody = pretty_midi.Instrument(program=73, name="flute")
    pad = pretty_midi.Instrument(program=89, name="pad")
    bass = pretty_midi.Instrument(program=33, name="bass")
    drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    triads = ((60, 64, 67), (65, 69, 72), (67, 71, 74, 77), (60, 64, 67))
    scale = (72, 74, 76, 77, 79, 77, 76, 74)
    position, groups_played, beats_played = 0.0, 0, 0
    for numerator, denominator, bars, plays_music in segments:
        meter = Meter(numerator, denominator)
        song.time_signature_changes.append(
            pretty_midi.TimeSignature(numerator, denominator, position * seconds)
        )
        for _ in range(bars):
            beat_start = position
            for length in meter.beats:
                start = beat_start * seconds
                drums.notes.append(pretty_midi.Note(90, 36, start, start + 0.1))
                if plays_music:
                    pitch = scale[beats_played % len(scale)]
                    end = start + 0.9 * length * seconds
                    melody.notes.append(pretty_midi.Note(90, pitch, start, end))
                    beats_played += 1
                beat_start += length
            if plays_music:
                for onset, length in groups(meter):
                    start, end = (position + onset) * seconds, (position + onset + length) * seconds
                    triad = triads[groups_played % len(triads)]
                    pad.notes += [pretty_midi.Note(70, pitch, start, end) for pitch in triad]
                    bass.notes.append(pretty_midi.Note(80, triad[0] - 24, start, end))
                    groups_played += 1
            position += meter.bar_beats
    song.instruments += [melody, pad, bass, drums]
    return song


def midi_song_json(path: Path, midi_settings: dict) -> dict:
    """pretty_midi's instrument summary of a MIDI song and the lead sheet reduced from it.

    The summary lets the JavaScript MIDI reader prove it groups and times notes like pretty_midi:
    per instrument, the name, program, drum flag, note count, sums of pitches and start times,
    and the first and last note in pretty_midi's order.
    """
    midi = pretty_midi.PrettyMIDI(str(path))
    instruments = []
    for index, instrument in enumerate(midi.instruments):
        notes = instrument.notes
        instruments.append(
            {
                "index": index,
                "name": instrument.name,
                "program": instrument.program,
                "is_drum": instrument.is_drum,
                "note_count": len(notes),
                "pitch_sum": sum(note.pitch for note in notes),
                "start_sum": round(sum(note.start for note in notes), 6),
                "first": _midi_note(notes[0]) if notes else None,
                "last": _midi_note(notes[-1]) if notes else None,
            }
        )
    bars = midi_settings.get("bars")
    lead_sheet = read_lead_sheet_midi(
        path,
        melody_track=midi_settings["melody_track"],
        phrase_length=PHRASE_LENGTH,
        bars=tuple(bars) if bars else None,
        sections=[(int(bar), str(label)) for bar, label in midi_settings.get("sections") or []],
        grid=midi_settings.get("grid", "auto"),
    )
    return _plain(
        {
            "settings": midi_settings,
            "resolution": midi.resolution,
            "instruments": instruments,
            "leadsheet": lead_sheet_json(lead_sheet),
        }
    )


def _midi_note(note: pretty_midi.Note) -> list:
    return [round(note.start, 6), round(note.end, 6), note.pitch, note.velocity]


def _notes(notes) -> list[list]:
    return [[note.pitch, note.onset, note.duration, note.velocity] for note in notes]


def _plain(value):
    """Turn numpy values, tuples and NaN into JSON-ready Python values (NaN becomes None)."""
    if isinstance(value, np.ndarray):
        return _plain(value.tolist())
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(item) for item in value]
    if isinstance(value, np.generic):
        return _plain(value.item())
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def _write_json(path: Path, content: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, separators=(",", ":"), ensure_ascii=False) + "\n")
