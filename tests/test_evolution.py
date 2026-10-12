"""Behavior of the GA loop on a tiny arrangement problem whose best plan is known."""

import dataclasses
from pathlib import Path

import numpy as np
import pytest

from ga.evolution import EvolutionResult, GAParams, evolve
from ga.fitness import CRITERIA, fitness
from ga.genome import OCT, P2, random_population
from ga.tables import ScoreTables

N_BARS = 3


def busy_melody_tables() -> ScoreTables:
    """Three bars of a busy melody (activity 1 in every octave).

    Complementarity then wants the calmest P2 texture, hold (activity 0), and fidelity wants the
    written octave, so the best plan has P2 = hold and octave = as written in every bar, and
    scores exactly 1.
    """
    n = N_BARS
    return ScoreTables(
        act_p1=np.ones((n, 3)),
        act_p2=np.tile([0.0, 1.0, 1.0, 0.5, 0.5], (n, 1)),
        act_tr=np.zeros((n, 4)),
        act_no=np.zeros((n, 5)),
        reg_both=np.zeros((n, 3, 5)),
        reg_ok=np.zeros((n, 3, 5)),
        bass_inner=np.full((n, 4), np.nan),
        bass_inner_leaps=np.zeros((n, 4), dtype=int),
        bass_across=np.ones((n - 1, 4, 4)),
        single_chord=np.zeros(n, dtype=bool),
        phrase_end=np.zeros(n, dtype=bool),
        phrase=np.zeros(n, dtype=int),
        is_chorus=np.zeros(n, dtype=bool),
    )


WEIGHTS = {name: 0.0 for name in CRITERIA} | {"complementarity": 1.0, "fidelity": 1.0}
PARAMS = GAParams(
    population_size=20,
    max_generations=60,
    stagnation_window=100,
    mutation_rate=0.05,
    elite_count=2,
)


def run(seed: int = 0, params: GAParams = PARAMS, weights=WEIGHTS) -> EvolutionResult:
    return evolve(np.random.default_rng(seed), busy_melody_tables(), N_BARS, params, weights)


def test_the_same_seed_gives_the_same_result():
    first, second = run(seed=4), run(seed=4)

    np.testing.assert_array_equal(first.best_genome, second.best_genome)
    assert first.best_fitness == second.best_fitness
    assert first.log == second.log
    assert first.stop_reason == second.stop_reason


def test_the_ga_finds_the_known_best_plan_of_a_tiny_problem():
    result = run()

    assert result.best_fitness == pytest.approx(1.0)
    assert (result.best_genome[:, P2] == 0).all()
    assert (result.best_genome[:, OCT] == 0).all()


def test_the_best_fitness_never_decreases_with_elitism():
    result = run(params=dataclasses.replace(PARAMS, elite_count=1, mutation_rate=0.2))

    best_per_generation = np.array([stats.best for stats in result.log])
    assert (np.diff(best_per_generation) >= 0).all()


def test_the_best_genome_is_the_best_plan_ever_seen():
    result = run(params=dataclasses.replace(PARAMS, elite_count=0, mutation_rate=0.3))

    assert result.best_fitness == pytest.approx(max(stats.best for stats in result.log))
    recomputed = fitness(busy_melody_tables(), result.best_genome[np.newaxis], WEIGHTS)[0]
    assert recomputed == pytest.approx(result.best_fitness)
    assert result.best_genome.shape == (N_BARS, 4)


def test_generation_zero_is_the_random_population_and_is_logged():
    result = run(seed=9)

    generation_zero = random_population(np.random.default_rng(9), PARAMS.population_size, N_BARS)
    scores = fitness(busy_melody_tables(), generation_zero, WEIGHTS)
    np.testing.assert_array_equal(result.initial_best_genome, generation_zero[np.argmax(scores)])
    assert result.log[0].generation == 0
    assert result.log[0].best == pytest.approx(scores.max())
    assert result.log[0].mean == pytest.approx(scores.mean())


def test_it_stops_after_max_generations_and_logs_every_generation():
    result = run(params=dataclasses.replace(PARAMS, max_generations=7, stagnation_window=50))

    assert result.stop_reason == "max_generations"
    assert [stats.generation for stats in result.log] == list(range(8))


def test_it_stops_when_the_best_fitness_stagnates():
    # With all weights at 0 every plan scores 0, so the best never improves after generation 0.
    flat = dict.fromkeys(CRITERIA, 0.0)

    result = run(params=dataclasses.replace(PARAMS, stagnation_window=5), weights=flat)

    assert result.stop_reason == "stagnation"
    assert [stats.generation for stats in result.log] == list(range(6))


def test_the_ga_runs_when_no_weighted_criterion_applies_to_the_tune():
    # One bar per phrase: coherence finds no pair of bars to compare and scores NaN for every
    # plan. Every plan then has fitness 0, selection draws uniformly and the run stagnates.
    tables = dataclasses.replace(busy_melody_tables(), phrase=np.arange(N_BARS))
    coherence_only = dict.fromkeys(CRITERIA, 0.0) | {"coherence": 1.0}
    params = dataclasses.replace(PARAMS, stagnation_window=5)

    result = evolve(np.random.default_rng(0), tables, N_BARS, params, coherence_only)

    assert result.best_fitness == 0.0
    assert result.stop_reason == "stagnation"
    assert all(np.isfinite([stats.best, stats.mean]).all() for stats in result.log)


def test_diversity_is_the_share_of_distinct_plans_in_the_population():
    result = run()

    assert all(0 < stats.diversity <= 1 for stats in result.log)
    # 20 random plans of 3 bars from 300 options per bar are almost surely all different.
    assert result.log[0].diversity == 1.0
    # Selection makes copies of good plans, so the population grows less diverse.
    assert result.log[-1].diversity < 1.0


def test_ga_params_refuse_an_elite_that_fills_the_whole_population():
    with pytest.raises(ValueError, match="elite_count"):
        GAParams(
            population_size=4,
            max_generations=10,
            stagnation_window=5,
            mutation_rate=0.01,
            elite_count=4,
        )


# --- allowed values (spec 003, US3) ---------------------------------------------------------

ECHO = 3


def test_the_ga_uses_only_allowed_values_even_when_a_disallowed_one_would_score_best():
    # Hold would win complementarity in every bar, but only echo and third are allowed.
    allowed = ((ECHO, 4), (0, 1, 2, 3), (0, 1, 2, 3, 4), (0, 1, 2))
    params = dataclasses.replace(PARAMS, allowed=allowed)

    result = run(params=params)

    assert set(result.best_genome[:, P2]) <= {ECHO, 4}
    assert set(result.initial_best_genome[:, P2]) <= {ECHO, 4}


def test_ga_params_from_a_config_carry_the_allowed_values():
    from config import load_config
    from ga.evolution import ga_params

    config = load_config(overrides=['allowed.p2=["hold","arp16","echo","third"]'])

    params = ga_params(config)

    assert params.allowed[P2] == (0, 1, 3, 4)
    assert params.population_size == config["population_size"]


def test_ga_params_refuse_a_gene_without_allowed_values():
    with pytest.raises(ValueError, match="every gene needs at least one allowed value"):
        dataclasses.replace(PARAMS, allowed=((), (0,), (0,), (0,)))


LEAD_SHEETS = sorted((Path(__file__).resolve().parent.parent / "data" / "leadsheets").glob("*.abc"))


@pytest.mark.parametrize("path", LEAD_SHEETS, ids=[path.stem for path in LEAD_SHEETS])
def test_with_arp32_disallowed_no_run_uses_it_on_any_committed_lead_sheet(path):
    # Spec 003 SC-004: 0% of the bars use arp32, on every committed lead sheet and seeds 1-3.
    from config import load_config
    from ga.evolution import ga_params
    from ga.tables import build_tables
    from leadsheet.abc_reader import read_lead_sheet

    config = load_config(overrides=['allowed.p2=["hold","arp16","echo","third"]'])
    params = dataclasses.replace(ga_params(config), max_generations=40)
    lead_sheet = read_lead_sheet(path)
    tables = build_tables(lead_sheet)
    for seed in (1, 2, 3):
        result = evolve(
            np.random.default_rng(seed), tables, len(lead_sheet.bars), params, config["weights"]
        )
        assert not (result.best_genome[:, P2] == 2).any()
        assert not (result.initial_best_genome[:, P2] == 2).any()
