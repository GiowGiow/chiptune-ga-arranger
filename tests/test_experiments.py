import csv

import numpy as np

from config import load_config
from export.experiments import mean_hamming_distance, run_experiments
from leadsheet.abc_reader import read_lead_sheet


def test_hamming_distance_is_the_share_of_genes_that_differ():
    a = np.zeros((2, 4), dtype=int)
    b = a.copy()
    b[0, 0] = 1
    assert mean_hamming_distance([a, a]) == 0.0
    assert mean_hamming_distance([a, b]) == 1 / 8


def test_experiments_write_seeds_baseline_and_ablation_tables(tmp_path):
    config = load_config(overrides=["population_size=10", "max_generations=5"])
    lead_sheet = read_lead_sheet("data/leadsheets/korobeiniki.abc")
    folder = run_experiments(lead_sheet, config, seed=1, out_dir=tmp_path, name="korobeiniki")
    with open(folder / "results.csv") as handle:
        rows = list(csv.DictReader(handle))
    experiments = [row["experiment"] for row in rows]
    assert experiments.count("seed") == 5
    assert experiments.count("random search") == 1
    assert experiments.count("ablation") == 7
    assert (folder / "results.md").read_text().startswith("|")
    assert (folder / "seeds.pdf").stat().st_size > 1000
