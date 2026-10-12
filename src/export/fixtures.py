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
from ga.evolution import GAParams, evolve
from ga.fitness import CRITERIA, criterion_scores, fitness
from ga.genome import NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES
from ga.tables import build_tables
from leadsheet.abc_reader import read_lead_sheet
from leadsheet.abc_writer import lead_sheet_to_abc
from leadsheet.chords import chord_tones
from leadsheet.midi_reader import read_lead_sheet_midi
from leadsheet.model import LeadSheet
from leadsheet.sources import load_sources

PHRASE_LENGTH = 4
REALIZATION_IDS = ("korobeiniki", "mulher_de_fases")
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
    """The lead sheet as nested dictionaries with the Python field names."""
    return _plain(dataclasses.asdict(lead_sheet))


def tables_json(lead_sheet: LeadSheet) -> dict:
    """Every array of the lead sheet's score tables, as nested lists (NaN as None)."""
    tables = build_tables(lead_sheet)
    return {field.name: _plain(getattr(tables, field.name)) for field in dataclasses.fields(tables)}


def realizations_json(lead_sheet: LeadSheet) -> dict:
    """The notes of every gene value of every channel in every bar, as [pitch, onset, dur, vel].

    TR realizations read the next bar (the walking bass leads into its root), so they are taken
    with the same neighbor as in the tables. NO patterns do not depend on the bar and are listed
    once.
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
            }
        )
    no = [_notes(realize_no(gene)) for gene in range(len(NO_PATTERNS))]
    return {"bars": realized, "no": no}


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
    params = GAParams(
        population_size=config["population_size"],
        max_generations=config["max_generations"],
        stagnation_window=config["stagnation_window"],
        mutation_rate=config["mutation_rate"],
        elite_count=config["elite_count"],
    )
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
