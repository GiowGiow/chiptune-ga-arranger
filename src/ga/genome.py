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

# The values each gene may take, per column: by default every value. The setting `allowed`
# narrows them, for example to keep the fast 32nd-note arpeggio out of the arrangement.
AllowedGenes = tuple[tuple[int, ...], ...]
ALL_ALLOWED: AllowedGenes = tuple(tuple(range(size)) for size in GENE_SIZES)

# The config key under `allowed` and the value names of each gene column, in column order.
_GENE_VALUE_NAMES = (
    ("p2", P2_TEXTURES),
    ("tr", TR_TEXTURES),
    ("no", NO_PATTERNS),
    ("p1_octave", P1_OCTAVES),
)


def allowed_genes(allowed: dict[str, list]) -> AllowedGenes:
    """Turn the `allowed` setting (value names per gene) into sorted gene values per column.

    The setting is checked by `config.load_config`; the order of its lists does not matter.

    >>> allowed_genes({"p2": ["third", "hold"], "tr": ["root"], "no": ["fill"], "p1_octave": [0]})
    ((0, 4), (0,), (4,), (0,))
    """
    return tuple(
        tuple(sorted(values.index(name) for name in allowed[key]))
        for key, values in _GENE_VALUE_NAMES
    )


def random_population(
    rng: np.random.Generator, m: int, n_bars: int, allowed: AllowedGenes = ALL_ALLOWED
) -> np.ndarray:
    """Draw m random plans of n_bars bars, every gene uniform over its allowed values.

    This is generation 0 of the GA: no plan is preferred, so the search starts from an unbiased
    sample of the space. Each gene draws a position among its k allowed values and takes the
    value there; with every value allowed, the position is the value itself, so the draws are
    the same as when nothing could be disallowed.

    >>> population = random_population(np.random.default_rng(0), m=3, n_bars=2)
    >>> population.shape
    (3, 2, 4)
    >>> bool((population < np.array(GENE_SIZES)).all())
    True
    >>> no_arp32 = ((0, 1, 3, 4), *ALL_ALLOWED[1:])
    >>> bool((random_population(np.random.default_rng(0), 50, 4, no_arp32)[..., P2] != 2).all())
    True
    """
    counts = [len(values) for values in allowed]
    # The upper bound broadcasts over the last axis, one count per gene column.
    positions = rng.integers(0, counts, size=(m, n_bars, len(GENE_SIZES)))
    return values_at(positions, allowed)


def values_at(positions: np.ndarray, allowed: AllowedGenes) -> np.ndarray:
    """The allowed value at each position (an index into a gene's allowed values), per column.

    >>> values_at(np.array([[1, 0, 0, 0]]), ((0, 3), (1,), (4,), (2,))).tolist()
    [[3, 1, 4, 2]]
    """
    values = np.empty_like(positions)
    for column, column_values in enumerate(allowed):
        values[..., column] = np.asarray(column_values)[positions[..., column]]
    return values


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
