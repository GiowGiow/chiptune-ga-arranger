"""Run configuration: every hyperparameter in one JSON document.

The defaults live in `configs/default.json`. A run can replace them with its own JSON file and
with command-line overrides such as `--set weights.contrast=3`, so no hyperparameter is hidden in
the code (constitution, principle I). The resolved configuration is hashed to name the run folder:
the same configuration always gives the same hash.
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


def load_config(path: Path | str | None = None, overrides: Sequence[str] = ()) -> dict:
    """Return the defaults, updated by an optional JSON file and by `key=value` overrides.

    Dotted keys reach nested values (`weights.contrast=3`). Values are parsed as JSON, and a value
    that is not valid JSON is kept as a string (`role_map.A=chorus`). A ValueError rejects an
    unknown key and criterion weights that are not finite numbers of at least 0, or that are all
    0, since the fitness is their weighted mean.

    >>> load_config(overrides=["weights.contrast=3"])["weights"]["contrast"]
    3
    """
    config = json.loads(DEFAULT_CONFIG_PATH.read_text())
    if path is not None:
        _merge(config, json.loads(Path(path).read_text()), prefix="")
    for item in overrides:
        key, sep, raw_value = item.partition("=")
        if not sep or not key:
            raise ValueError(f"override {item!r} must look like key=value")
        _set_dotted(config, key.strip(), _parse_value(raw_value.strip()))
    _check_weights(config["weights"])
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
