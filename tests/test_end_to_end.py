import csv
import json

import music21
import pretty_midi
import pytest

import main

KOROBEINIKI = "data/leadsheets/korobeiniki.abc"
FAST = ["--set", "population_size=20", "--set", "max_generations=15", "--no-audio"]


def arrange(tmp_path, *extra):
    out = tmp_path / "outputs"
    assert main.main(["arrange", KOROBEINIKI, "--seed", "1", "--out", str(out), *FAST, *extra]) == 0
    (folder,) = out.iterdir()
    return folder


def notes_of(folder):
    midi = pretty_midi.PrettyMIDI(str(folder / "piece.mid"))
    return {i.name: [(n.pitch, n.start, n.end) for n in i.notes] for i in midi.instruments}


def test_arrange_writes_a_run_folder_with_the_piece_and_its_records(tmp_path):
    folder = arrange(tmp_path)
    for name in ("piece.mid", "pianoroll.png", "pianoroll.pdf", "config.json", "metrics.json"):
        assert (folder / name).exists(), name
    for name in ("evolution.csv", "evolution.png", "evolution.pdf"):
        assert (folder / name).exists(), name
    score = music21.converter.parse(folder / "piece.mid")
    assert sorted(p.partName for p in score.parts) == ["NO", "P1", "P2", "TR"]
    record = json.loads((folder / "config.json").read_text())
    assert record["seed"] == 1 and record["population_size"] == 20


def test_the_same_seed_and_configuration_give_identical_notes(tmp_path):
    first = arrange(tmp_path / "a")
    second = arrange(tmp_path / "b")
    assert notes_of(first) == notes_of(second)


def test_the_best_fitness_never_drops_and_metrics_hold_all_criteria(tmp_path):
    folder = arrange(tmp_path)
    with open(folder / "evolution.csv") as handle:
        best = [float(row["best"]) for row in csv.DictReader(handle)]
    assert all(b >= a - 1e-12 for a, b in zip(best, best[1:], strict=False))
    metrics = json.loads((folder / "metrics.json").read_text())
    assert len(metrics["criteria_final"]) == 7 and len(metrics["criteria_initial_best"]) == 7
    assert len(metrics["genome"]) == 32


def test_a_run_without_seed_is_refused(tmp_path):
    with pytest.raises(SystemExit) as stop:
        main.main(["arrange", KOROBEINIKI, "--out", str(tmp_path)])
    assert stop.value.code == 2


def test_an_invalid_lead_sheet_exits_with_an_error_message(tmp_path, capsys):
    bad = tmp_path / "bad.abc"
    bad.write_text('X:1\nT:bad\nM:3/4\nL:1/4\nK:C\n"C"C D E |\n')
    assert main.main(["arrange", str(bad), "--seed", "1", "--out", str(tmp_path), *FAST]) == 1
    assert capsys.readouterr().err.startswith("error:")


def test_sample_copies_the_run_and_the_vector_figures(tmp_path):
    folder = arrange(tmp_path)
    samples, figures = tmp_path / "samples", tmp_path / "figures"
    code = main.main(
        ["sample", str(folder), "demo", "--samples", str(samples), "--figures", str(figures)]
    )
    assert code == 0
    assert (samples / "demo" / "piece.mid").exists()
    assert (samples / "demo" / "notes.md").exists()
    assert (figures / "demo-evolution.pdf").exists()
    assert (figures / "demo-pianoroll.pdf").exists()
