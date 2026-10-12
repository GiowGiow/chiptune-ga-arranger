import json
from pathlib import Path

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


@pytest.mark.parametrize(
    "override",
    [
        "weights.contrast=-1",  # a negative weight would reward breaking the rule
        "weights.contrast=NaN",  # NaN makes every weighted mean NaN
        "weights.contrast=Infinity",  # one infinite weight swamps the others
        'weights.contrast="heavy"',  # not a number at all
    ],
)
def test_config_rejects_negative_or_non_finite_weights(override):
    with pytest.raises(ValueError, match="weights.contrast"):
        load_config(overrides=[override])


def test_config_rejects_weights_that_are_all_zero():
    zeros = [f"weights.{name}=0" for name in load_config()["weights"]]

    with pytest.raises(ValueError, match="weights"):
        load_config(overrides=zeros)


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


RUN_KEYS = (
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


def test_load_config_accepts_a_run_record_and_ignores_its_run_keys():
    record_path = Path("samples/korobeiniki-s1/config.json")
    record = json.loads(record_path.read_text())
    cfg = load_config(record_path)
    assert not set(RUN_KEYS) & set(cfg)
    assert cfg["weights"] == record["weights"]
    assert cfg["max_generations"] == record["max_generations"]


def test_load_config_accepts_the_web_app_record_with_an_app_section(tmp_path):
    record = load_config() | {key: None for key in RUN_KEYS}
    record |= {"seed": 3, "population_size": 40, "app": {"pace": "watch"}}
    path = tmp_path / "song-s3-1234abcd.config.json"
    path.write_text(json.dumps(record))
    cfg = load_config(path)
    assert cfg["population_size"] == 40
    assert "app" not in cfg and "seed" not in cfg


def test_load_config_still_rejects_an_unknown_key_in_a_run_record(tmp_path):
    path = tmp_path / "typo.json"
    path.write_text(json.dumps({"seed": 1, "populaton_size": 3}))
    with pytest.raises(ValueError, match="unknown configuration key 'populaton_size'"):
        load_config(path)


ALL_ALLOWED = {
    "p2": ["hold", "arp16", "arp32", "echo", "third"],
    "tr": ["root", "octave_pump", "root_fifth", "walking"],
    "no": ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"],
    "p1_octave": [0, 12, -12],
}


def test_by_default_every_gene_value_is_allowed():
    assert load_config()["allowed"] == ALL_ALLOWED


def test_an_override_replaces_one_gene_list_and_keeps_the_others():
    cfg = load_config(overrides=['allowed.p2=["hold","arp16"]'])

    assert cfg["allowed"]["p2"] == ["hold", "arp16"]
    assert cfg["allowed"]["tr"] == ALL_ALLOWED["tr"]


def test_a_run_record_without_allowed_reruns_with_everything_allowed():
    record = Path(__file__).resolve().parent.parent / "samples" / "korobeiniki-s1" / "config.json"

    assert load_config(record)["allowed"] == ALL_ALLOWED


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ('allowed.p2="hold"', "allowed.p2 must be a list of P2 textures"),
        ("allowed.no=[]", "allowed.no must keep at least one value"),
        (
            'allowed.p2=["arp64"]',
            'allowed.p2: unknown value "arp64"; valid values: hold, arp16, arp32, echo, third',
        ),
        ('allowed.tr=["walking","walking"]', 'allowed.tr: "walking" is listed twice'),
        (
            "allowed.p1_octave=[24]",
            'allowed.p1_octave: unknown value "24"; valid values: 0, 12, -12',
        ),
        ("allowed.p1_octave=0", "allowed.p1_octave must be a list of P1 octaves"),
    ],
)
def test_invalid_allowed_values_are_refused_with_a_message_naming_the_gene(override, message):
    with pytest.raises(ValueError) as error:
        load_config(overrides=[override])

    assert str(error.value) == message


def test_an_unknown_gene_under_allowed_is_an_unknown_key():
    with pytest.raises(ValueError, match="unknown configuration key 'allowed.p3'"):
        load_config(overrides=['allowed.p3=["hold"]'])
