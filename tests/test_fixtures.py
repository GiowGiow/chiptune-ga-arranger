import json
import math
from pathlib import Path

import pytest

from export.fixtures import write_fixtures


@pytest.fixture(scope="module")
def small_fixtures(tmp_path_factory):
    """One sample, one lead sheet and one missing MIDI song: the GA rerun runs once per module."""
    tmp_path = tmp_path_factory.mktemp("fixtures")
    sources = tmp_path / "sources.json"
    sources.write_text(
        json.dumps(
            {
                "songs": [
                    {
                        "id": "mulher_de_fases",
                        "title": "Mulher de Fases",
                        "artist": "Raimundos",
                        "composers": [],
                        "page_url": None,
                        "url": None,
                        "sha256": "0" * 64,
                        "path": "data/raw/missing/mulher_de_fases.mid",
                        "abc": "data/leadsheets/mulher_de_fases.abc",
                        "sample": "mulher-de-fases-s1",
                        "midi": {"melody_track": 6, "bars": [8, 40], "sections": None},
                        "note": "",
                    }
                ]
            }
        )
    )
    out = tmp_path / "fixtures"
    notices: list[str] = []
    write_fixtures(
        out,
        samples_dir=Path("samples"),
        sources_path=sources,
        leadsheets_dir=Path("data/leadsheets"),
        sample_names=["korobeiniki-s1"],
        leadsheet_ids=["korobeiniki"],
        realization_ids=["korobeiniki"],
        log=notices.append,
    )
    return out, "\n".join(notices)


def test_fixtures_hold_the_python_reference_of_chords_lead_sheets_tables_and_plans(
    small_fixtures,
):
    out, _ = small_fixtures

    chords = json.loads((out / "chords.json").read_text())
    assert chords["symbols"]["Am"] == [9, [9, 0, 4]]
    assert chords["symbols"]["Ebmaj7"] == [3, [3, 7, 10, 2]]  # an extra quality
    assert chords["rejected"] == ["Cxyz", "H7"]

    sheet = json.loads((out / "leadsheets/korobeiniki.json").read_text())
    assert len(sheet["bars"]) == 32
    first_bar = sheet["bars"][0]
    assert {"phrase_end", "role", "label", "phrase", "melody", "chords"} <= set(first_bar)
    assert first_bar["chords"][0]["tones"] == [4, 8, 11]  # E major

    tables = json.loads((out / "tables/korobeiniki.json").read_text())
    assert len(tables["act_p2"]) == 32 and len(tables["act_p2"][0]) == 5
    assert len(tables["bass_across"]) == 31
    # A NaN of numpy (a bar whose bass line has a single note) is written as null.
    flat_inner = [value for row in tables["bass_inner"] for value in row]
    assert all(value is None or math.isfinite(value) for value in flat_inner)

    realized = json.loads((out / "realizations/korobeiniki.json").read_text())
    assert len(realized["bars"]) == 32
    assert len(realized["bars"][0]["p2"]) == 5 and len(realized["bars"][0]["tr"]) == 4
    assert len(realized["no"]) == 5
    pitch, onset, duration, velocity = realized["bars"][0]["p1"][0][0]
    assert (onset, velocity) == (0.0, 100)

    plan = json.loads((out / "plans/korobeiniki-s1.json").read_text())
    record = json.loads(Path("samples/korobeiniki-s1/config.json").read_text())
    assert plan["leadsheet"] == "korobeiniki"
    assert len(plan["best_plan"]) == 32 and len(plan["best_plan"][0]) == 4
    assert abs(plan["fitness"] - record["best_fitness"]) < 1e-9
    assert set(plan["scores"]) == {
        "complementarity",
        "register",
        "coherence",
        "contrast",
        "bass_smoothness",
        "idiom",
        "fidelity",
    }
    assert set(plan["arrangement"]) == {"P1", "P2", "TR", "NO"}

    abc = (out / "abc/mulher_de_fases.abc").read_text()
    assert abc.startswith("%abc-2.1") and "K:none" in abc


def test_a_missing_raw_midi_is_reported_and_writes_no_midi_song_fixture(small_fixtures):
    out, printed = small_fixtures
    assert "mulher_de_fases" in printed and "uv run src/main.py fetch" in printed
    assert not (out / "midi-songs/mulher_de_fases.json").exists()
