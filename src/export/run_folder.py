"""Run folders: where each generation run stores its files.

Every run writes `outputs/<run-id>/`. The run id joins the input name, the seed and a hash of the
configuration, so rerunning the same command reuses the same folder. `config.json` records
everything needed to regenerate the run: the seed, every hyperparameter, the input file and its
SHA-256, the code commit and the creation date (constitution, principle I).
"""

import hashlib
import json
import math
import subprocess
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from analysis.metrics import arrangement_metrics
from arrangement.model import Arrangement
from config import config_hash


def make_run_id(input_path: Path | str, seed: int, config: dict) -> str:
    """Return `<input stem>-s<seed>-<config hash>`.

    >>> make_run_id("data/leadsheets/korobeiniki.abc", 1, {"a": 1})[:16]
    'korobeiniki-s1-0'
    """
    return f"{Path(input_path).stem}-s{seed}-{config_hash(config)}"


def git_state(directory: Path | str = ".") -> tuple[str | None, bool | None]:
    """Return (commit hash, has uncommitted changes), or (None, None) outside a git repository."""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=directory, capture_output=True, text=True, check=True
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain"], cwd=directory, capture_output=True, text=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None, None
    return commit, bool(status.strip())


def write_config_json(
    folder: Path | str,
    config: dict,
    seed: int,
    input_path: Path | str,
    extra: dict | None = None,
) -> Path:
    """Write `config.json` with the resolved configuration and the provenance of the run."""
    folder, input_path = Path(folder), Path(input_path)
    commit, dirty = git_state(Path(__file__).resolve().parent)
    record = {
        **config,
        "seed": seed,
        "input_path": str(input_path),
        "input_sha256": hashlib.sha256(input_path.read_bytes()).hexdigest(),
        "git_commit": commit,
        "git_dirty": dirty,
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "run_id": folder.name,
        **(extra or {}),
    }
    path = folder / "config.json"
    path.write_text(json.dumps(record, indent=2) + "\n")
    return path


def write_evolution_csv(folder: Path | str, log: Sequence) -> Path:
    """Write `evolution.csv`: one row per generation with best, mean and diversity."""
    rows = ["generation,best,mean,diversity"]
    rows += [f"{e.generation},{e.best},{e.mean},{e.diversity}" for e in log]
    path = Path(folder) / "evolution.csv"
    path.write_text("\n".join(rows) + "\n")
    return path


def write_metrics_json(
    folder: Path | str,
    arrangement: Arrangement,
    total_beats: float,
    criteria_initial_best: dict[str, float],
    criteria_final: dict[str, float],
) -> Path:
    """Write `metrics.json`: channel metrics, criterion scores (NaN as null) and the genome."""
    record = {
        "channels": arrangement_metrics(arrangement, total_beats),
        "criteria_initial_best": _without_nan(criteria_initial_best),
        "criteria_final": _without_nan(criteria_final),
        "genome": [list(bar_genes) for bar_genes in arrangement.genome],
    }
    path = Path(folder) / "metrics.json"
    path.write_text(json.dumps(record, indent=2) + "\n")
    return path


def _without_nan(scores: dict[str, float]) -> dict[str, float | None]:
    # JSON has no NaN; a criterion that does not apply to the tune is stored as null.
    return {name: (None if math.isnan(value) else float(value)) for name, value in scores.items()}
