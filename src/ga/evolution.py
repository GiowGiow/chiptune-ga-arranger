"""The GA loop: evolve a population of arrangement plans, one generation at a time.

Generation 0 is a random population. Each later generation is built from the previous one:

1. score every plan with the fitness function;
2. copy the `elite_count` best plans unchanged (elitism);
3. fill the remaining places with children: pick two parents with roulette selection, cut and
   swap them with one-point crossover, then mutate the children gene by gene.

The loop stops after `max_generations` new generations, or earlier when the best fitness has not
improved for `stagnation_window` generations (more generations would most likely not help). Every
generation is logged with its best and mean fitness and its diversity, the share of distinct
plans, which shows how fast selection makes the population converge.
"""

from dataclasses import dataclass

import numpy as np

from ga.fitness import fitness
from ga.genome import random_population
from ga.operators import elite_indices, mutate, one_point_crossover, roulette_select
from ga.tables import ScoreTables

# Improvements this small are floating-point noise, not progress.
IMPROVEMENT_TOLERANCE = 1e-12


@dataclass(frozen=True)
class GAParams:
    """Hyperparameters of one GA run.

    Attributes:
        population_size: number of plans in every generation (m).
        max_generations: number of generations evolved after the random generation 0.
        stagnation_window: generations without improvement of the best fitness before stopping.
        mutation_rate: probability that each gene of a child is mutated.
        elite_count: number of best plans copied unchanged into the next generation.
    """

    population_size: int
    max_generations: int
    stagnation_window: int
    mutation_rate: float
    elite_count: int

    def __post_init__(self) -> None:
        # At least one place must be left for children, or the population could never change.
        if not 0 <= self.elite_count < self.population_size:
            raise ValueError("elite_count must be at least 0 and smaller than population_size")


@dataclass(frozen=True)
class GenerationStats:
    """One row of the fitness log.

    Attributes:
        generation: generation number, 0 for the random population.
        best: highest fitness in the generation.
        mean: mean fitness of the generation.
        diversity: number of distinct plans divided by the population size, in (0, 1].
    """

    generation: int
    best: float
    mean: float
    diversity: float


# eq=False: the genomes are numpy arrays, whose == is element-wise and has no single truth value.
@dataclass(frozen=True, eq=False)
class EvolutionResult:
    """What a GA run returns.

    Attributes:
        best_genome: the best plan seen in any generation, shape (n_bars, 4).
        best_fitness: its fitness.
        log: one GenerationStats per generation, starting with generation 0.
        stop_reason: "max_generations" or "stagnation".
        initial_best_genome: the best plan of the random generation 0, a baseline to compare with.
    """

    best_genome: np.ndarray
    best_fitness: float
    log: list[GenerationStats]
    stop_reason: str
    initial_best_genome: np.ndarray


def diversity(population: np.ndarray) -> float:
    """Share of distinct plans in a population: 1 when all differ, 1/m when all are copies.

    >>> plans = np.array([[[0, 0, 0, 0]], [[0, 0, 0, 0]], [[1, 0, 0, 0]], [[2, 0, 0, 0]]])
    >>> diversity(plans)
    0.75
    """
    flat_plans = population.reshape(len(population), -1)
    return len(np.unique(flat_plans, axis=0)) / len(population)


def next_generation(
    rng: np.random.Generator,
    population: np.ndarray,
    fitness_values: np.ndarray,
    params: GAParams,
) -> np.ndarray:
    """Build the next population: the elite unchanged, then mutated children of roulette parents.

    >>> population = np.zeros((4, 3, 4), dtype=int)
    >>> params = GAParams(population_size=4, max_generations=1, stagnation_window=1,
    ...                   mutation_rate=0.0, elite_count=1)
    >>> next_generation(np.random.default_rng(0), population, np.ones(4), params).shape
    (4, 3, 4)
    """
    elite = population[elite_indices(fitness_values, params.elite_count)]
    n_children = len(population) - len(elite)
    children = []
    while len(children) < n_children:
        mother, father = roulette_select(rng, fitness_values, 2)
        children.extend(one_point_crossover(rng, population[mother], population[father]))
    # When the number of free places is odd, the second child of the last pair is dropped.
    offspring = mutate(rng, np.stack(children[:n_children]), params.mutation_rate)
    return np.concatenate([elite, offspring])


def evolve(
    rng: np.random.Generator,
    tables: ScoreTables,
    n_bars: int,
    params: GAParams,
    weights: dict[str, float],
) -> EvolutionResult:
    """Run the GA on one tune and return the best plan found, with the fitness log.

    >>> from ga.fitness import CRITERIA
    >>> two_bars = ScoreTables(
    ...     act_p1=np.ones((2, 3)), act_p2=np.zeros((2, 5)), act_tr=np.zeros((2, 4)),
    ...     act_no=np.zeros(5), reg_both=np.zeros((2, 3, 5)), reg_ok=np.zeros((2, 3, 5)),
    ...     bass_smooth=np.ones((1, 4, 4)), single_chord=np.zeros(2, dtype=bool),
    ...     phrase_end=np.zeros(2, dtype=bool), phrase=np.array([0, 0]),
    ...     is_chorus=np.zeros(2, dtype=bool))
    >>> params = GAParams(population_size=10, max_generations=30, stagnation_window=10,
    ...                   mutation_rate=0.05, elite_count=1)
    >>> fidelity_only = dict.fromkeys(CRITERIA, 0.0) | {"fidelity": 1.0}
    >>> result = evolve(np.random.default_rng(0), two_bars, 2, params, fidelity_only)
    >>> result.best_fitness, result.best_genome[:, 3]  # both bars at the written octave
    (1.0, array([0, 0]))
    """
    population = random_population(rng, params.population_size, n_bars)
    log: list[GenerationStats] = []
    best_fitness = -np.inf
    generations_without_improvement = 0
    generation = 0
    while True:
        fitness_values = fitness(tables, population, weights)
        log.append(
            GenerationStats(
                generation=generation,
                best=float(fitness_values.max()),
                mean=float(fitness_values.mean()),
                diversity=diversity(population),
            )
        )
        leader = population[np.argmax(fitness_values)]
        if generation == 0:
            initial_best_genome = leader.copy()
        if fitness_values.max() > best_fitness + IMPROVEMENT_TOLERANCE:
            best_fitness, best_genome = float(fitness_values.max()), leader.copy()
            generations_without_improvement = 0
        else:
            generations_without_improvement += 1

        if generations_without_improvement >= params.stagnation_window:
            stop_reason = "stagnation"
            break
        if generation == params.max_generations:
            stop_reason = "max_generations"
            break
        population = next_generation(rng, population, fitness_values, params)
        generation += 1

    return EvolutionResult(
        best_genome=best_genome,
        best_fitness=best_fitness,
        log=log,
        stop_reason=stop_reason,
        initial_best_genome=initial_best_genome,
    )
