"""The browser arranger's MIDI download reads back in the CLI like the CLI's own export.

`arranger/tests/fixtures/web/korobeiniki-s1.mid` is written by the JavaScript writer
(`arranger/src/core/midi-export.js`; in `arranger/`, run
`WRITE_WEB_FIXTURES=1 node --test tests/midi-export.test.js`) from the best plan of the sample
korobeiniki-s1 (contracts/files.md, `.mid`). pretty_midi, the CLI's MIDI reader, must find the four
NES channels with the notes that `arrangement_to_midi` builds from the same plan.
"""

import json
from pathlib import Path

import numpy as np
import pretty_midi
import pytest

from arrangement.assemble import assemble
from export.midi import arrangement_to_midi
from leadsheet.abc_reader import read_lead_sheet

ROOT = Path(__file__).resolve().parent.parent
WEB_MIDI = ROOT / "arranger" / "tests" / "fixtures" / "web" / "korobeiniki-s1.mid"
PLAN = ROOT / "arranger" / "tests" / "fixtures" / "plans" / "korobeiniki-s1.json"
LEAD_SHEET = ROOT / "data" / "leadsheets" / "korobeiniki.abc"

# One tick (480 per quarter note at 150 BPM) lasts 60 / 150 / 480 s = 0.83 ms. Every onset and
# duration of this arrangement is a whole number of eighths of a beat (60 ticks) and the tempo is
# exactly 400,000 us per quarter note, so the file loses nothing: times agree to float rounding,
# far inside 1e-6 s.
TIME_TOLERANCE = 1e-6


@pytest.fixture(scope="module")
def web_midi() -> pretty_midi.PrettyMIDI:
    return pretty_midi.PrettyMIDI(str(WEB_MIDI))


@pytest.fixture(scope="module")
def cli_midi() -> pretty_midi.PrettyMIDI:
    best_plan = json.loads(PLAN.read_text())["best_plan"]
    return arrangement_to_midi(assemble(read_lead_sheet(LEAD_SHEET), np.array(best_plan)))


def _rows(instrument: pretty_midi.Instrument) -> list[tuple[float, float, int, int]]:
    """Notes as (start, end, pitch, velocity), sorted so that file order does not matter.

    The sort key rounds times to the microsecond, so float noise cannot swap two drum hits that
    share an onset.
    """
    notes = [(n.start, n.end, n.pitch, n.velocity) for n in instrument.notes]
    return sorted(notes, key=lambda row: (round(row[0], 6), round(row[1], 6), row[2], row[3]))


def test_pretty_midi_reads_the_web_midi_as_the_four_nes_channels(web_midi):
    assert [i.name for i in web_midi.instruments] == ["P1", "P2", "TR", "NO"]
    assert [i.program for i in web_midi.instruments] == [80, 80, 38, 0]
    assert [i.is_drum for i in web_midi.instruments] == [False, False, False, True]
    assert web_midi.resolution == 480
    assert web_midi.get_tempo_changes()[1].tolist() == [150.0]
    assert [(ts.numerator, ts.denominator) for ts in web_midi.time_signature_changes] == [(4, 4)]


def test_every_web_note_equals_the_cli_export_of_the_same_plan(web_midi, cli_midi):
    assert [i.name for i in web_midi.instruments] == [i.name for i in cli_midi.instruments]
    for web, cli in zip(web_midi.instruments, cli_midi.instruments, strict=True):
        web_rows, cli_rows = _rows(web), _rows(cli)
        assert len(web_rows) == len(cli_rows), web.name
        assert [row[2:] for row in web_rows] == [row[2:] for row in cli_rows], web.name
        times = np.array([row[:2] for row in web_rows]) - np.array([row[:2] for row in cli_rows])
        assert np.abs(times).max() < TIME_TOLERANCE, web.name
