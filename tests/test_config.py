import pytest

from config import config_hash, load_config


def test_defaults_come_from_the_default_config_file():
    cfg = load_config()
    assert cfg["population_size"] == 60
    assert cfg["mutation_rate"] == 0.01
    assert cfg["weights"]["fidelity"] == 0.5
    assert cfg["tempo_bpm"] is None


def test_set_overrides_parse_values_as_json():
    cfg = load_config(overrides=["weights.contrast=3", "mutation_rate=0.05", "tempo_bpm=120"])
    assert cfg["weights"]["contrast"] == 3
    assert cfg["mutation_rate"] == 0.05
    assert cfg["tempo_bpm"] == 120


def test_role_map_accepts_new_labels_and_plain_strings():
    cfg = load_config(overrides=["role_map.A=chorus"])
    assert cfg["role_map"] == {"A": "chorus"}


def test_unknown_keys_are_rejected():
    with pytest.raises(ValueError, match="unknown"):
        load_config(overrides=["populaton_size=10"])
    with pytest.raises(ValueError, match="unknown"):
        load_config(overrides=["weights.loudness=1"])


def test_an_override_without_equals_sign_is_rejected():
    with pytest.raises(ValueError):
        load_config(overrides=["mutation_rate"])


def test_a_config_file_overrides_the_defaults(tmp_path):
    path = tmp_path / "fast.json"
    path.write_text('{"max_generations": 5, "weights": {"idiom": 2.0}}')
    cfg = load_config(path)
    assert cfg["max_generations"] == 5
    assert cfg["weights"]["idiom"] == 2.0
    assert cfg["weights"]["contrast"] == 1.0


def test_hash_ignores_key_order_and_follows_values():
    a = {"x": 1, "y": {"b": 2, "a": 1}}
    b = {"y": {"a": 1, "b": 2}, "x": 1}
    assert config_hash(a) == config_hash(b)
    assert config_hash(a) != config_hash({**a, "x": 2})
    assert len(config_hash(a)) == 8
