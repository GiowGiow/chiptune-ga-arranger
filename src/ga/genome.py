"""The genotype: one arrangement plan as four integer genes per bar.

A plan is a numpy integer array of shape (n_bars, 4). Row b holds the choices for bar b:

- column P2: the harmony texture of the second pulse channel (an index into P2_TEXTURES);
- column TR: the bass texture of the triangle channel (an index into TR_TEXTURES);
- column NO: the drum pattern of the noise channel (an index into NO_PATTERNS);
- column OCT: the octave of the melody on P1 (an index into P1_OCTAVES, in semitones).

A population stacks m plans into an array of shape (m, n_bars, 4).
"""

import numpy as np

P2_TEXTURES = ("hold", "arp16", "arp32", "echo", "third")
TR_TEXTURES = ("root", "octave_pump", "root_fifth", "walking")
NO_PATTERNS = ("none", "half_time", "eighth_beat", "sixteenth_beat", "fill")
P1_OCTAVES = (0, 12, -12)

# Number of possible values of each gene, in column order.
GENE_SIZES = (len(P2_TEXTURES), len(TR_TEXTURES), len(NO_PATTERNS), len(P1_OCTAVES))

# Column indices of the genes.
P2, TR, NO, OCT = 0, 1, 2, 3


def random_population(rng: np.random.Generator, m: int, n_bars: int) -> np.ndarray:
    """Draw m random plans of n_bars bars, every gene uniform over its valid values.

    This is generation 0 of the GA: no plan is preferred, so the search starts from an unbiased
    sample of the space.

    >>> population = random_population(np.random.default_rng(0), m=3, n_bars=2)
    >>> population.shape
    (3, 2, 4)
    >>> bool((population < np.array(GENE_SIZES)).all())
    True
    """
    # The upper bound broadcasts over the last axis, one size per gene column.
    return rng.integers(0, GENE_SIZES, size=(m, n_bars, len(GENE_SIZES)))


def decode(genome: np.ndarray) -> list[dict[str, object]]:
    """Translate a plan of shape (n_bars, 4) into readable choices, one dictionary per bar.

    >>> decode(np.array([[1, 3, 4, 2]]))
    [{'p2': 'arp16', 'tr': 'walking', 'no': 'fill', 'p1_octave': -12}]
    """
    return [
        {
            "p2": P2_TEXTURES[bar[P2]],
            "tr": TR_TEXTURES[bar[TR]],
            "no": NO_PATTERNS[bar[NO]],
            "p1_octave": P1_OCTAVES[bar[OCT]],
        }
        for bar in genome
    ]
