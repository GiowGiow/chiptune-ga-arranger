"""Experiments for the Results section of the abstract.

Three questions, each answered on one lead sheet with the GA settings of the configuration:

1. Does the same configuration give different pieces? Five seeds, with the mean Hamming distance
   (share of genes that differ) between their final plans.
2. Is the GA better than chance? A random search that scores as many random plans as the GA
   scored during its run, keeping the best one.
3. What does each criterion do? An ablation: one run per criterion with its weight set to 0. The
   table reports every criterion, so the effect of removing one is visible.
"""

import csv
import itertools
from pathlib import Path

import numpy as np

from config import config_hash
from export.figures import plot_seed_curves
from ga.evolution import GAParams, evolve
from ga.fitness import CRITERIA, criterion_scores, fitness
from ga.genome import random_population
from ga.tables import build_tables
from leadsheet.model import LeadSheet

SEED_COUNT = 5


def mean_hamming_distance(genomes: list[np.ndarray]) -> float:
    """Mean share of genes that differ between every pair of plans.

    >>> a = np.zeros((1, 4), dtype=int)
    >>> mean_hamming_distance([a, a + 1])
    1.0
    """
    pairs = list(itertools.combinations(genomes, 2))
    if not pairs:
        return 0.0
    return float(np.mean([np.mean(a != b) for a, b in pairs]))


def run_experiments(
    lead_sheet: LeadSheet, config: dict, seed: int, out_dir: Path | str, name: str
) -> Path:
    """Run the seed, random-search and ablation experiments; write their table and figure."""
    folder = Path(out_dir) / f"experiment-{name}-s{seed}-{config_hash(config)}"
    folder.mkdir(parents=True, exist_ok=True)
    tables = build_tables(lead_sheet)
    n_bars = len(lead_sheet.bars)
    weights = config["weights"]
    params = GAParams(
        population_size=config["population_size"],
        max_generations=config["max_generations"],
        stagnation_window=config["stagnation_window"],
        mutation_rate=config["mutation_rate"],
        elite_count=config["elite_count"],
    )
    rows = []

    def row(experiment: str, setting: str, genome: np.ndarray, generations: object) -> dict:
        scores = criterion_scores(tables, genome[np.newaxis])
        total = float(fitness(tables, genome[np.newaxis], weights)[0])
        criteria = {c: round(float(scores[c][0]), 3) for c in CRITERIA}
        return {
            "experiment": experiment,
            "setting": setting,
            "fitness": round(total, 4),
            "generations": generations,
            **criteria,
        }

    seed_runs = []
    for run_seed in range(seed, seed + SEED_COUNT):
        result = evolve(np.random.default_rng(run_seed), tables, n_bars, params, weights)
        seed_runs.append((run_seed, result))
        rows.append(row("seed", f"seed={run_seed}", result.best_genome, len(result.log) - 1))
    distance = mean_hamming_distance([result.best_genome for _, result in seed_runs])

    # Random search gets as many fitness evaluations as the first seed's GA run.
    evaluations = len(seed_runs[0][1].log) * params.population_size
    rng = np.random.default_rng(seed)
    best_random, best_value = None, -np.inf
    for start in range(0, evaluations, params.population_size):
        batch = random_population(rng, min(params.population_size, evaluations - start), n_bars)
        values = fitness(tables, batch, weights)
        if values.max() > best_value:
            best_value, best_random = float(values.max()), batch[int(values.argmax())]
    rows.append(row("random search", f"{evaluations} plans", best_random, "-"))

    for criterion in CRITERIA:
        ablated = {**weights, criterion: 0.0}
        result = evolve(np.random.default_rng(seed), tables, n_bars, params, ablated)
        rows.append(row("ablation", f"{criterion}=0", result.best_genome, len(result.log) - 1))

    with open(folder / "results.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    header = list(rows[0])
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(str(r[h]) for h in header) + " |" for r in rows]
    lines.append("")
    lines.append(f"Mean Hamming distance between the {SEED_COUNT} seed plans: {distance:.3f}")
    (folder / "results.md").write_text("\n".join(lines) + "\n")
    plot_seed_curves([(s, r.log) for s, r in seed_runs], best_value, folder / "seeds.pdf")
    plot_seed_curves([(s, r.log) for s, r in seed_runs], best_value, folder / "seeds.png")
    print("\n".join(lines))
    print(folder)
    return folder
