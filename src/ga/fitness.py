"""Fitness: how good an arrangement plan is, as a weighted mean of seven music-theory criteria.

Each criterion turns one arranging heuristic into a score from 0 (bad) to 1 (good):

1. complementarity: P2 is calm when the melody is busy and active when the melody rests.
2. register: P2 sounds below the melody, so the melody stays on top.
3. coherence: bars inside a phrase keep the same choices (a drum fill may break the pattern).
4. contrast: the chorus is denser than the verse.
5. bass_smoothness: the bass moves by small leaps across bar lines.
6. idiom: NES habits: fast arpeggios on bars with a single chord, drum fills at phrase ends.
7. fidelity: the melody stays at its written octave.

A criterion that does not apply to the tune (contrast in a tune without a chorus) scores NaN
and is left out of the mean.

The GA calls the fitness thousands of times, so every score is a lookup in the precomputed
`ScoreTables`, done for the whole population at once with numpy fancy indexing. With
bars = arange(n_bars) and a gene column `genes` of shape (m, n_bars), `table[bars, genes]` has
shape (m, n_bars), and its entry [i, b] is table[b, genes[i, b]]: the value of bar b under the
choice that plan i makes for bar b.
"""

import numpy as np

from ga.genome import NO, NO_PATTERNS, OCT, P1_OCTAVES, P2, P2_TEXTURES, TR
from ga.tables import ScoreTables

CRITERIA = (
    "complementarity",
    "register",
    "coherence",
    "contrast",
    "bass_smoothness",
    "idiom",
    "fidelity",
)

FILL = NO_PATTERNS.index("fill")
ARPEGGIOS = (P2_TEXTURES.index("arp16"), P2_TEXTURES.index("arp32"))
WRITTEN_OCTAVE = P1_OCTAVES.index(0)


def _complementarity(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Mean over bars of 1 - |P2 activity - (1 - melody activity)|."""
    bars = np.arange(population.shape[1])
    melody = tables.act_p1[bars, population[:, :, OCT]]
    harmony = tables.act_p2[bars, population[:, :, P2]]
    return np.mean(1 - np.abs(harmony - (1 - melody)), axis=1)


def _register(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Share of the steps where P1 and P2 sound together in which P2 is lower; 1 if never."""
    bars = np.arange(population.shape[1])
    octave, p2 = population[:, :, OCT], population[:, :, P2]
    # The counts are pooled over bars, so a bar weighs as much as P1 and P2 overlap in it.
    both = tables.reg_both[bars, octave, p2].sum(axis=1)
    p2_below = tables.reg_ok[bars, octave, p2].sum(axis=1)
    return np.divide(p2_below, both, out=np.ones(len(population)), where=both > 0)


def _coherence(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Share of adjacent bar pairs inside a phrase that keep the same choices; 1 if no pair."""
    same_phrase = tables.phrase[:-1] == tables.phrase[1:]
    if not same_phrase.any():
        return np.ones(len(population))
    this_bar, next_bar = population[:, :-1], population[:, 1:]
    same_textures = (this_bar[..., [P2, TR, OCT]] == next_bar[..., [P2, TR, OCT]]).all(axis=-1)
    # A fill is a one-bar break in the groove, so it fits next to any drum pattern.
    drums, next_drums = this_bar[..., NO], next_bar[..., NO]
    drums_fit = (drums == next_drums) | (drums == FILL) | (next_drums == FILL)
    return (same_textures & drums_fit)[:, same_phrase].mean(axis=1)


def _contrast(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """0.5 + mean chorus density - mean verse density, clipped to [0, 1]; NaN without both."""
    chorus = tables.is_chorus
    if chorus.all() or not chorus.any():
        return np.full(len(population), np.nan)
    bars = np.arange(population.shape[1])
    density = (
        tables.act_p2[bars, population[:, :, P2]]
        + tables.act_tr[bars, population[:, :, TR]]
        + tables.act_no[population[:, :, NO]]
    ) / 3
    lift = density[:, chorus].mean(axis=1) - density[:, ~chorus].mean(axis=1)
    # Equal densities score 0.5, so the GA is pushed toward a denser chorus, not just allowed.
    return np.clip(0.5 + lift, 0, 1)


def _bass_smoothness(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Mean score of the bass leaps across bar lines; 1 for a single bar."""
    n_bars = population.shape[1]
    if n_bars < 2:
        return np.ones(len(population))
    bass = population[:, :, TR]
    leaps = tables.bass_smooth[np.arange(n_bars - 1), bass[:, :-1], bass[:, 1:]]
    return leaps.mean(axis=1)


def _idiom(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Mean of two shares: arpeggios on single-chord bars, and fills exactly at phrase ends."""
    fill_matches_phrase_end = ((population[:, :, NO] == FILL) == tables.phrase_end).mean(axis=1)
    # Without single-chord bars the arpeggio share does not apply (the nanmean of the two shares).
    if not tables.single_chord.any():
        return fill_matches_phrase_end
    on_single_chord = population[:, tables.single_chord, P2]
    arpeggio_share = np.isin(on_single_chord, ARPEGGIOS).mean(axis=1)
    return (arpeggio_share + fill_matches_phrase_end) / 2


def _fidelity(tables: ScoreTables, population: np.ndarray) -> np.ndarray:
    """Share of bars where P1 plays the melody at its written octave."""
    return (population[:, :, OCT] == WRITTEN_OCTAVE).mean(axis=1)


_SCORERS = {
    "complementarity": _complementarity,
    "register": _register,
    "coherence": _coherence,
    "contrast": _contrast,
    "bass_smoothness": _bass_smoothness,
    "idiom": _idiom,
    "fidelity": _fidelity,
}


def criterion_scores(tables: ScoreTables, population: np.ndarray) -> dict[str, np.ndarray]:
    """Score every plan of a population on every criterion.

    The population has shape (m, n_bars, 4). The result maps each name in CRITERIA to an array
    of m scores in [0, 1], or of NaN when the criterion does not apply to the tune.

    One bar of a busy melody, with a single chord: hold on P2 suits the melody, but an arpeggio
    suits the NES idiom.

    >>> one_bar = ScoreTables(
    ...     act_p1=np.ones((1, 3)), act_p2=np.array([[0.0, 1.0, 1.0, 0.5, 0.5]]),
    ...     act_tr=np.zeros((1, 4)), act_no=np.zeros(5), reg_both=np.zeros((1, 3, 5)),
    ...     reg_ok=np.zeros((1, 3, 5)), bass_smooth=np.ones((0, 4, 4)),
    ...     single_chord=np.array([True]), phrase_end=np.array([False]),
    ...     phrase=np.array([0]), is_chorus=np.array([False]))
    >>> hold, arp16 = [[0, 0, 0, 0]], [[1, 0, 0, 0]]
    >>> scores = criterion_scores(one_bar, np.array([hold, arp16]))
    >>> scores["complementarity"], scores["idiom"], scores["contrast"]
    (array([1., 0.]), array([0.5, 1. ]), array([nan, nan]))
    """
    return {name: _SCORERS[name](tables, population) for name in CRITERIA}


def fitness(tables: ScoreTables, population: np.ndarray, weights: dict[str, float]) -> np.ndarray:
    """Weighted mean of the criteria that apply, for every plan of a population.

    fitness = sum(w * s) / sum(w) over the criteria whose score is not NaN. A criterion missing
    from weights has weight 0. The fitness is 0 when the weights of the applicable criteria sum
    to 0.

    The same one-bar tune as in criterion_scores, with equal weights: hold wins on
    complementarity and fidelity, arp16 only on idiom.

    >>> one_bar = ScoreTables(
    ...     act_p1=np.ones((1, 3)), act_p2=np.array([[0.0, 1.0, 1.0, 0.5, 0.5]]),
    ...     act_tr=np.zeros((1, 4)), act_no=np.zeros(5), reg_both=np.zeros((1, 3, 5)),
    ...     reg_ok=np.zeros((1, 3, 5)), bass_smooth=np.ones((0, 4, 4)),
    ...     single_chord=np.array([True]), phrase_end=np.array([False]),
    ...     phrase=np.array([0]), is_chorus=np.array([False]))
    >>> hold, arp16_octave_up = [[0, 0, 0, 0]], [[1, 0, 0, 1]]
    >>> weights = dict.fromkeys(CRITERIA, 1.0)
    >>> fitness(one_bar, np.array([hold, arp16_octave_up]), weights).round(3)
    array([0.917, 0.667])
    """
    scores = criterion_scores(tables, population)
    weighted_sum = np.zeros(len(population))
    weight_sum = np.zeros(len(population))
    for name, values in scores.items():
        weight = weights.get(name, 0.0)
        applies = ~np.isnan(values)
        weighted_sum += np.where(applies, weight * values, 0.0)
        weight_sum += np.where(applies, weight, 0.0)
    return np.divide(weighted_sum, weight_sum, out=np.zeros(len(population)), where=weight_sum > 0)
