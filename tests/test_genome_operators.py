"""Behavior of the genotype and of the genetic operators (selection, crossover, mutation)."""

import numpy as np
import pytest

from ga.genome import GENE_SIZES, OCT, P2, decode, random_population
from ga.operators import elite_indices, mutate, one_point_crossover, roulette_select


def rng(seed: int = 0) -> np.random.Generator:
    return np.random.default_rng(seed)


# --- random_population ------------------------------------------------------------------------


def test_random_population_holds_four_genes_per_bar_for_every_individual():
    population = random_population(rng(), m=6, n_bars=8)

    assert population.shape == (6, 8, 4)
    assert np.issubdtype(population.dtype, np.integer)


def test_random_population_draws_every_valid_value_of_every_gene_and_nothing_else():
    population = random_population(rng(), m=200, n_bars=8)

    for column, size in enumerate(GENE_SIZES):
        assert set(np.unique(population[:, :, column])) == set(range(size))


def test_random_population_is_the_same_for_the_same_seed():
    first = random_population(rng(7), m=5, n_bars=4)
    second = random_population(rng(7), m=5, n_bars=4)

    np.testing.assert_array_equal(first, second)


def test_random_population_differs_for_different_seeds():
    first = random_population(rng(1), m=5, n_bars=4)
    second = random_population(rng(2), m=5, n_bars=4)

    assert not np.array_equal(first, second)


# --- decode -----------------------------------------------------------------------------------


def test_decode_names_the_choice_of_every_channel_in_each_bar():
    genome = np.array([[0, 0, 0, 0], [1, 3, 4, 2]])

    assert decode(genome) == [
        {"p2": "hold", "tr": "root", "no": "none", "p1_octave": 0},
        {"p2": "arp16", "tr": "walking", "no": "fill", "p1_octave": -12},
    ]


# --- roulette_select --------------------------------------------------------------------------


def test_roulette_returns_the_requested_number_of_valid_indices():
    picks = roulette_select(rng(), np.array([0.1, 0.4, 0.3]), n=50)

    assert picks.shape == (50,)
    assert picks.min() >= 0
    assert picks.max() <= 2


def test_roulette_with_windowing_never_picks_the_single_lowest_individual():
    fitness = np.array([0.2, 0.9, 0.85, 0.95])

    picks = roulette_select(rng(), fitness, n=2000)

    assert 0 not in picks
    assert set(picks) == {1, 2, 3}


def test_roulette_slices_are_proportional_to_fitness_minus_the_lowest_fitness():
    # Windowed slices are 0, 1 and 3 out of 4.
    fitness = np.array([0.5, 0.6, 0.8])

    picks = roulette_select(rng(), fitness, n=8000)

    shares = np.bincount(picks, minlength=3) / len(picks)
    np.testing.assert_allclose(shares, [0.0, 0.25, 0.75], atol=0.02)


def test_roulette_is_uniform_when_all_fitness_values_are_equal():
    picks = roulette_select(rng(), np.full(4, 0.7), n=8000)

    shares = np.bincount(picks, minlength=4) / len(picks)
    np.testing.assert_allclose(shares, [0.25] * 4, atol=0.02)


def test_roulette_is_uniform_when_fitness_differs_only_by_rounding():
    # The same weighted mean summed in another order can differ in the last bit. Windowing would
    # give the whole wheel to the plan that happens to be one rounding step higher.
    fitness = np.array([0.7, 0.7, 0.7 + 1e-15, 0.7])

    picks = roulette_select(rng(), fitness, n=8000)

    shares = np.bincount(picks, minlength=4) / len(picks)
    np.testing.assert_allclose(shares, [0.25] * 4, atol=0.02)


def test_roulette_is_the_same_for_the_same_seed():
    fitness = np.array([0.1, 0.5, 0.9])

    np.testing.assert_array_equal(
        roulette_select(rng(3), fitness, n=20), roulette_select(rng(3), fitness, n=20)
    )


# --- elite_indices ----------------------------------------------------------------------------


def test_elite_indices_returns_the_k_best_individuals_best_first():
    fitness = np.array([0.3, 0.8, 0.1, 0.95, 0.5])

    np.testing.assert_array_equal(elite_indices(fitness, 3), [3, 1, 4])


def test_elite_indices_breaks_ties_by_lower_index_first():
    fitness = np.array([0.4, 0.9, 0.2, 0.9])

    np.testing.assert_array_equal(elite_indices(fitness, 2), [1, 3])


def test_elite_indices_is_empty_without_elitism():
    assert elite_indices(np.array([0.4, 0.9]), 0).size == 0


# --- one_point_crossover ----------------------------------------------------------------------


def parents(n_bars: int) -> tuple[np.ndarray, np.ndarray]:
    """Two parents whose bars are easy to tell apart: every gene of a is 0, of b is 1."""
    return np.zeros((n_bars, 4), dtype=int), np.ones((n_bars, 4), dtype=int)


@pytest.mark.parametrize("seed", range(20))
def test_crossover_cuts_between_bars_and_swaps_the_tails(seed):
    a, b = parents(n_bars=5)

    child1, child2 = one_point_crossover(rng(seed), a, b)

    # The cut is the number of leading bars that child 1 took from parent a.
    cut = int(np.argmax(child1[:, 0] != 0))
    assert 1 <= cut < 5
    np.testing.assert_array_equal(child1, np.concatenate([a[:cut], b[cut:]]))
    np.testing.assert_array_equal(child2, np.concatenate([b[:cut], a[cut:]]))


def test_crossover_uses_every_cut_between_bars():
    a, b = parents(n_bars=5)
    generator = rng()

    cuts = {int(np.argmax(one_point_crossover(generator, a, b)[0][:, 0] != 0)) for _ in range(200)}

    assert cuts == {1, 2, 3, 4}


def test_crossover_of_one_bar_parents_returns_copies():
    a, b = parents(n_bars=1)

    child1, child2 = one_point_crossover(rng(), a, b)

    np.testing.assert_array_equal(child1, a)
    np.testing.assert_array_equal(child2, b)
    child1[0, 0] = 4
    assert a[0, 0] == 0


def test_crossover_leaves_the_parents_unchanged():
    a, b = parents(n_bars=4)

    child1, _ = one_point_crossover(rng(), a, b)
    child1[:] = 3

    assert (a == 0).all()
    assert (b == 1).all()


# --- mutate -----------------------------------------------------------------------------------


def test_mutation_with_rate_zero_changes_nothing():
    population = random_population(rng(), m=10, n_bars=6)

    np.testing.assert_array_equal(mutate(rng(1), population, rate=0.0), population)


def test_mutation_with_rate_one_changes_every_gene_to_a_different_valid_value():
    population = random_population(rng(), m=10, n_bars=6)

    mutated = mutate(rng(1), population, rate=1.0)

    assert (mutated != population).all()
    assert (mutated >= 0).all()
    assert (mutated < np.array(GENE_SIZES)).all()


def test_mutation_changes_about_the_requested_share_of_genes():
    population = random_population(rng(), m=200, n_bars=8)

    mutated = mutate(rng(1), population, rate=0.25)

    assert (mutated != population).mean() == pytest.approx(0.25, abs=0.02)


def test_mutation_reaches_every_other_value_of_a_gene():
    # The octave gene has 3 values: from 0, a mutation must lead to 1 or 2, never stay at 0.
    population = np.zeros((500, 1, 4), dtype=int)

    mutated = mutate(rng(), population, rate=1.0)

    assert set(np.unique(mutated[:, 0, OCT])) == {1, 2}
    assert set(np.unique(mutated[:, 0, P2])) == {1, 2, 3, 4}


def test_mutation_returns_a_new_array_and_keeps_the_input():
    population = random_population(rng(), m=4, n_bars=3)
    original = population.copy()

    mutate(rng(1), population, rate=1.0)

    np.testing.assert_array_equal(population, original)


def test_mutation_is_the_same_for_the_same_seed():
    population = random_population(rng(), m=8, n_bars=4)

    np.testing.assert_array_equal(
        mutate(rng(5), population, rate=0.3), mutate(rng(5), population, rate=0.3)
    )
