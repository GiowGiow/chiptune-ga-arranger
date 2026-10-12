import json
import math
from pathlib import Path

import pytest

from config import load_config
from export.fixtures import plan_json, write_fixtures
from leadsheet.abc_reader import read_lead_sheet


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
    assert len(realized["bars"][0]["no"]) == 5
    assert sheet["bars"][0]["meter"] == "4/4" and "beats_per_bar" not in sheet
    assert len(tables["act_no"]) == 32 and len(tables["act_no"][0]) == 5
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


def test_a_sample_whose_rerun_fitness_differs_is_reported_and_its_plan_is_the_rerun():
    # A short GA, so the rerun is quick; the record claims a fitness the rerun cannot reach,
    # as when a sample's lead sheet changed after the sample was made.
    config = load_config(overrides=["population_size=10", "max_generations=3"])
    record = {"seed": 1, "best_fitness": -1.0}
    sheet = read_lead_sheet("data/leadsheets/korobeiniki.abc")
    notices: list[str] = []

    plan = plan_json("stale-s1", "korobeiniki", sheet, config, record, log=notices.append)

    assert len(notices) == 1
    assert "stale-s1" in notices[0] and "-1.0" in notices[0] and str(plan["fitness"]) in notices[0]
    assert plan["fitness"] != record["best_fitness"]
    assert len(plan["best_plan"]) == 32


def test_fixtures_hold_the_meter_tunes_and_the_synthetic_midi_songs(small_fixtures):
    out, _ = small_fixtures

    waltz = json.loads((out / "leadsheets/waltz.json").read_text())
    assert {bar["meter"] for bar in waltz["bars"]} == {"3/4"}
    changes = json.loads((out / "leadsheets/changes.json").read_text())
    assert [bar["meter"] for bar in changes["bars"]][:5] == ["4/4", "4/4", "2/4", "2/4", "3/4"]
    tables = json.loads((out / "tables/waltz.json").read_text())
    assert len(tables["act_no"]) == 16
    plan = json.loads((out / "plans/meters-jig.json").read_text())
    assert plan["best_plan"][7] == [2, 3, 2, 1]  # bar 7: 7 mod 5, 7 mod 4, 7 mod 5, 7 mod 3
    assert 0.0 <= plan["fitness"] <= 1.0
    assert "[M:2/4]" in (out / "abc/changes.abc").read_text()

    count_in = json.loads((out / "midi-songs/synthetic-count-in.json").read_text())
    assert (out / "midi-songs/synthetic-count-in.mid").exists()
    meters = [bar["meter"] for bar in count_in["leadsheet"]["bars"]]
    assert meters == ["4/4"] * 4  # the drum-only count-in is left out
    twelve = json.loads((out / "midi-songs/synthetic-twelve-eight.json").read_text())
    first_bar = twelve["leadsheet"]["bars"][0]
    assert first_bar["meter"] == "12/8"
    assert [(c["onset"], c["duration"]) for c in first_bar["chords"]] == [(0.0, 3.0), (3.0, 3.0)]
