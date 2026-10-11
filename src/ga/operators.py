"""Genetic operators: how parents are chosen and how children are made from them.

The GA follows the scheme taught in the course:

- **Roulette selection** gives each plan a slice of a wheel proportional to its fitness and
  spins the wheel once per parent. Here the slices use *windowing*: the lowest fitness of the
  generation is subtracted first. A weighted mean of seven criteria gives fitness values that
  are close to each other (say 0.70 to 0.80), and plain proportional slices would then be almost
  equal, so selection would barely prefer the better plans.
- **Elitism** copies the best plans unchanged into the next generation, so the best fitness never
  goes down.
- **One-point crossover** cuts both parents at the same bar line and swaps the tails, so each
  child keeps whole bars of its parents.
- **Mutation** replaces each gene, with a small probability, by a different valid value, which
  brings back choices that selection has lost.

Every function that draws random numbers takes the `numpy.random.Generator` as its first
argument, so a run is reproducible from its seed.
"""

import numpy as np

from ga.genome import GENE_SIZES


def roulette_select(rng: np.random.Generator, fitness: np.ndarray, n: int) -> np.ndarray:
    """Pick n parent indices with probability proportional to fitness minus the lowest fitness.

    The worst plan of the generation gets an empty slice. When all fitness values are equal,
    every plan gets the same slice.

    >>> rng = np.random.default_rng(0)
    >>> picks = roulette_select(rng, np.array([0.2, 0.9, 0.9]), n=1000)
    >>> bool((picks == 0).any())  # the worst plan is never picked
    False
    """
    window = fitness - fitness.min()
    if window.sum() == 0:
        return rng.choice(len(fitness), size=n)  # all plans equally fit: equal slices
    return rng.choice(len(fitness), size=n, p=window / window.sum())


def elite_indices(fitness: np.ndarray, k: int) -> np.ndarray:
    """Return the indices of the k highest fitness values, best first.

    Ties keep the lower index first, so the choice does not depend on chance.

    >>> elite_indices(np.array([0.3, 0.9, 0.1, 0.9]), 2)
    array([1, 3])
    """
    # A stable sort of the negated values orders from best to worst and keeps ties in index order.
    return np.argsort(-fitness, kind="stable")[:k]


def one_point_crossover(
    rng: np.random.Generator, a: np.ndarray, b: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Cut two parent plans at the same random bar line and swap their tails.

    The cut c is drawn from 1 to n_bars - 1, so each child takes at least one bar from each
    parent: child 1 = a[:c] + b[c:], child 2 = b[:c] + a[c:]. Parents of one bar cannot be cut,
    and the children are copies of them.

    >>> a, b = np.zeros((4, 4), dtype=int), np.ones((4, 4), dtype=int)
    >>> child1, child2 = one_point_crossover(np.random.default_rng(0), a, b)
    >>> child1[:, 0], child2[:, 0]  # the cut fell after bar 3
    (array([0, 0, 0, 1]), array([1, 1, 1, 0]))
    """
    n_bars = len(a)
    if n_bars == 1:
        return a.copy(), b.copy()
    cut = rng.integers(1, n_bars)
    return np.concatenate([a[:cut], b[cut:]]), np.concatenate([b[:cut], a[cut:]])


def mutate(
    rng: np.random.Generator,
    population: np.ndarray,
    rate: float,
    gene_sizes: tuple[int, ...] = GENE_SIZES,
) -> np.ndarray:
    """Return a copy where each gene, with probability rate, takes a different valid value.

    Adding a random shift from 1 to size - 1 and wrapping around (modulo the number of values)
    never gives back the old value, and reaches each of the other values with equal probability.
    The input can be one plan or a whole population: the genes are always on the last axis.

    >>> plan = np.zeros((2, 4), dtype=int)
    >>> bool((mutate(np.random.default_rng(0), plan, rate=0.0) == plan).all())
    True
    >>> bool((mutate(np.random.default_rng(0), plan, rate=1.0) != plan).all())
    True
    """
    sizes = np.asarray(gene_sizes)
    mutating = rng.random(population.shape) < rate
    shift = rng.integers(1, sizes, size=population.shape)
    return np.where(mutating, (population + shift) % sizes, population)
