"""Run configuration: every hyperparameter in one JSON document.

The defaults live in `configs/default.json`. A run can replace them with its own JSON file and
with command-line overrides such as `--set weights.contrast=3`, so no hyperparameter is hidden in
the code (constitution, principle I). The resolved configuration is hashed to name the run folder:
the same configuration always gives the same hash.

A run folder's `config.json` is a *run record*: the configuration plus keys that describe the run
(seed, input hash, git commit, best fitness, ...). The web arranger downloads the same record. A
record can be passed back as the config file: its run keys are skipped, so the hyperparameters
rerun as they were. The seed still comes from `--seed`, never from the file.
"""

import copy
import hashlib
import json
import math
from collections.abc import Sequence
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "configs" / "default.json"

# Sections whose keys are free (part labels), unlike the fixed hyperparameter names.
FREE_KEY_SECTIONS = ("role_map",)

# Top-level keys of a run record that describe the run, not a hyperparameter. The CLI writes all
# but "app"; the web arranger adds "app" (its pace and, for a catalog song, the song page).
RUN_RECORD_KEYS = (
    "seed",
    "input_path",
    "input_sha256",
    "git_commit",
    "git_dirty",
    "created",
    "run_id",
    "best_fitness",
    "stop_reason",
    "generations",
    "audio",
    "app",
)


def load_config(path: Path | str | None = None, overrides: Sequence[str] = ()) -> dict:
    """Return the defaults, updated by an optional JSON file and by `key=value` overrides.

    Dotted keys reach nested values (`weights.contrast=3`). Values are parsed as JSON, and a value
    that is not valid JSON is kept as a string (`role_map.A=chorus`). The file may be a run record
    (a run folder's `config.json`): its RUN_RECORD_KEYS are skipped. A ValueError rejects an
    unknown key, criterion weights that are not finite numbers of at least 0 or that are all 0
    (the fitness is their weighted mean), and `allowed` lists that are empty or hold an unknown or
    repeated value.

    >>> load_config(overrides=["weights.contrast=3"])["weights"]["contrast"]
    3
    """
    config = json.loads(DEFAULT_CONFIG_PATH.read_text())
    if path is not None:
        loaded = json.loads(Path(path).read_text())
        hyperparameters = {k: v for k, v in loaded.items() if k not in RUN_RECORD_KEYS}
        _merge(config, hyperparameters, prefix="")
    for item in overrides:
        key, sep, raw_value = item.partition("=")
        if not sep or not key:
            raise ValueError(f"override {item!r} must look like key=value")
        _set_dotted(config, key.strip(), _parse_value(raw_value.strip()))
    _check_weights(config["weights"])
    _check_allowed(config["allowed"])
    return config


def config_hash(config: dict) -> str:
    """Return 8 hex digits that identify a configuration, independent of key order.

    >>> config_hash({"a": 1, "b": 2}) == config_hash({"b": 2, "a": 1})
    True
    """
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:8]


def _check_weights(weights: dict) -> None:
    """Reject criterion weights that would break the weighted mean of the fitness.

    A NaN weight turns every fitness into NaN (scored as 0), an infinite one makes the roulette
    wheel undefined, a negative one rewards breaking the rule it weighs, and weights that are
    all 0 leave nothing to optimize.
    """
    for name, weight in weights.items():
        if isinstance(weight, bool) or not isinstance(weight, int | float):
            raise ValueError(f"weights.{name} must be a number, got {weight!r}")
        if not math.isfinite(weight) or weight < 0:
            raise ValueError(f"weights.{name} must be finite and at least 0, got {weight!r}")
    if sum(weights.values()) == 0:
        raise ValueError("the weights must not all be 0: the fitness would have nothing to score")


# The values each gene may take, in gene order, and how messages name them (spec 003 FR-012).
GENE_VALUES = {
    "p2": (("hold", "arp16", "arp32", "echo", "third"), "P2 textures"),
    "tr": (("root", "octave_pump", "root_fifth", "walking"), "TR textures"),
    "no": (("none", "half_time", "eighth_beat", "sixteenth_beat", "fill"), "NO patterns"),
    "p1_octave": ((0, 12, -12), "P1 octaves"),
}


def _check_allowed(allowed: dict) -> None:
    """Reject `allowed` lists that the GA could not draw from.

    A gene needs at least one value, or its bars would have nothing to play; an unknown or
    repeated value is most likely a typo in a hand-written config.
    """
    for gene, (valid, plural) in GENE_VALUES.items():
        values = allowed[gene]
        if not isinstance(values, list):
            raise ValueError(f"allowed.{gene} must be a list of {plural}")
        if not values:
            raise ValueError(f"allowed.{gene} must keep at least one value")
        for value in values:
            # bool is an int in Python: True would otherwise pass as the octave 1.
            if isinstance(value, bool) or value not in valid:
                listed = ", ".join(str(v) for v in valid)
                raise ValueError(f'allowed.{gene}: unknown value "{value}"; valid values: {listed}')
            if values.count(value) > 1:
                raise ValueError(f'allowed.{gene}: "{value}" is listed twice')


def _parse_value(raw_value: str) -> object:
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return raw_value


def _merge(base: dict, update: dict, prefix: str) -> None:
    for key, value in update.items():
        dotted = f"{prefix}{key}"
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            if key in FREE_KEY_SECTIONS and not prefix:
                base[key] = {**base[key], **copy.deepcopy(value)}
            else:
                _merge(base[key], value, prefix=f"{dotted}.")
        elif key in base or prefix.rstrip(".") in FREE_KEY_SECTIONS:
            base[key] = copy.deepcopy(value)
        else:
            raise ValueError(f"unknown configuration key {dotted!r}")


def _set_dotted(config: dict, dotted_key: str, value: object) -> None:
    parts = dotted_key.split(".")
    node = config
    for depth, part in enumerate(parts[:-1]):
        if part not in node or not isinstance(node[part], dict):
            raise ValueError(f"unknown configuration key {'.'.join(parts[: depth + 1])!r}")
        node = node[part]
    leaf = parts[-1]
    # Part labels are free keys; every other key must already exist in the defaults.
    if leaf not in node and parts[0] not in FREE_KEY_SECTIONS:
        raise ValueError(f"unknown configuration key {dotted_key!r}")
    node[leaf] = value
