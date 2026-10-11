import json
import re

from config import load_config
from export.run_folder import make_run_id, write_config_json


def test_run_id_names_input_seed_and_configuration():
    cfg = load_config()
    run_id = make_run_id("data/leadsheets/korobeiniki.abc", 7, cfg)
    assert re.fullmatch(r"korobeiniki-s7-[0-9a-f]{8}", run_id)
    assert make_run_id("data/leadsheets/korobeiniki.abc", 7, cfg) == run_id
    other = load_config(overrides=["weights.contrast=3"])
    assert make_run_id("data/leadsheets/korobeiniki.abc", 7, other) != run_id


def test_config_record_holds_seed_hyperparameters_input_hash_commit_and_date(tmp_path):
    cfg = load_config()
    leadsheet = tmp_path / "song.abc"
    leadsheet.write_text("X:1\n")
    folder = tmp_path / "run"
    folder.mkdir()
    write_config_json(folder, cfg, 3, leadsheet, extra={"best_fitness": 0.5})
    record = json.loads((folder / "config.json").read_text())
    assert record["seed"] == 3
    assert record["weights"] == cfg["weights"]
    assert len(record["input_sha256"]) == 64
    assert "git_commit" in record and "git_dirty" in record
    assert record["created"][:4].isdigit()
    assert record["run_id"] == "run"
    assert record["best_fitness"] == 0.5


def test_evolution_csv_has_one_row_per_generation(tmp_path):
    from collections import namedtuple

    from export.run_folder import write_evolution_csv

    stats = namedtuple("Stats", "generation best mean diversity")
    write_evolution_csv(tmp_path, [stats(0, 0.5, 0.4, 1.0), stats(1, 0.6, 0.45, 0.9)])
    lines = (tmp_path / "evolution.csv").read_text().splitlines()
    assert lines[0] == "generation,best,mean,diversity"
    assert lines[1:] == ["0,0.5,0.4,1.0", "1,0.6,0.45,0.9"]


def test_metrics_json_holds_channels_criteria_and_genome_with_nan_as_null(tmp_path):
    from test_midi_export import small_arrangement

    from export.run_folder import write_metrics_json

    criteria = {"contrast": float("nan"), "idiom": 0.5}
    write_metrics_json(
        tmp_path, small_arrangement(), 4.0, criteria, {"contrast": 0.7, "idiom": 1.0}
    )
    record = json.loads((tmp_path / "metrics.json").read_text())
    assert set(record["channels"]) == {"P1", "P2", "TR", "NO"}
    assert record["criteria_initial_best"] == {"contrast": None, "idiom": 0.5}
    assert record["criteria_final"]["idiom"] == 1.0
    assert record["genome"] == [[0, 0, 0, 0]]
