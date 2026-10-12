# Data Model: Meters and Allowed Textures

This extends the data model of spec 002 ([../002-browser-arranger/data-model.md](../002-browser-arranger/data-model.md)).
Units follow constitution principle III: times are quarter-note beats, pitches are MIDI numbers.
Python names are snake_case and JavaScript names camelCase. JSON keeps the Python names.

## Meter (new)

`src/leadsheet/meter.py` (`Meter`, frozen dataclass); `arranger/src/core/meter.js` (frozen
object).

| Field | Type | Rule |
|---|---|---|
| `numerator` | int | as written: 2, 3, 4, 5, 6, 7, 9 or 12 |
| `denominator` | int | 2, 4 or 8 |
| `bar_beats` | float | `numerator × 4 / denominator` quarter notes |
| `beats` | tuple of float | beat lengths in quarters; they sum to `bar_beats` |
| `strong` | tuple of int | indices into `beats` of the strong beats; always starts with 0 |
| `steps` | int | `round(4 × bar_beats)`, the sixteenth steps of one bar |

Derived helpers:
- `beat_onsets(meter)`: the running sum of `beats`, starting at 0;
- `strong_onsets(meter)`: the onsets of the strong beats;
- `groups(meter)`: the `(onset, length)` spans from each strong beat to the next or to the bar
  end. They are the chord spans of the MIDI reader (research R9).

Supported values (research R2):

| Text | `beats` | `strong` |
|---|---|---|
| `2/2`, `C\|` | 2, 2 | 0 |
| `2/4` | 1, 1 | 0 |
| `3/4` | 1, 1, 1 | 0 |
| `4/4`, `C` | 1, 1, 1, 1 | 0, 2 |
| `6/8` | 1.5, 1.5 | 0 |
| `9/8` | 1.5, 1.5, 1.5 | 0 |
| `12/8` | 1.5, 1.5, 1.5, 1.5 | 0, 2 |
| `5/4` | 1, 1, 1, 1, 1 | 0, 3 |
| `7/8` | 1, 1, 1.5 | 0 |

`parse_meter(text, bar_number)` (`parseMeter`):
- returns the Meter;
- raises `ValueError` (JavaScript: `Error`) "bar N: the meter 11/16 is not supported; supported
  meters: 2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8, 5/4, 7/8".

`str(meter)` gives `"3/4"`. `FOUR_FOUR` is the 4/4 constant.

**JSON** (fixtures, `metrics.json`): a meter is the string `"3/4"`.

## Bar (extended)

| Field | Change |
|---|---|
| `meter` | **new**, a Meter. It defaults to `FOUR_FOUR` and is the last field, so positional constructors stay valid. |
| `melody` | `0 ≤ onset < meter.bar_beats` and `onset + duration ≤ meter.bar_beats` |
| `chords` | cover `[0, meter.bar_beats)` without gaps |

The other fields (index, label, role, phrase, phrase_end) are unchanged. Phrases still count
bars, whatever their length.

## LeadSheet (changed)

| Field | Change |
|---|---|
| `beats_per_bar` | **removed**; each bar has its own meter |

Helpers in `meter.py` and `meter.js`:
- `bar_starts(bars)` gives the onset of each bar in beats from the piece start, as a running sum
  of `bar_beats`;
- `total_beats(bars)` gives the length of the piece.

Every computation that used `4 × bar.index` uses them.

## Bar map (new, MIDI reader)

`bar_map(midi)` (`barMap`): a list of `(start_beat, meter)`, one per bar of the file, on the
file's tick grid (beats = ticks / resolution).

- It starts at beat 0, in 4/4 until the first time signature.
- A time signature starts a new bar at its tick. A bar cut short by a change is marked short.
- It ends with the bar that holds the end of the last note.

**Excerpt.**
- `midi.bars = [first, end]` selects bars `first … end − 1` of the map.
- With `null`, the excerpt runs from the first bar that holds a pitched note to the bar where the
  last pitched note ends.
- A short bar inside the excerpt is an error that names it.

**Estimated grid.** On an estimated or explicit grid (`midi.grid` not `"file"`), every bar has
the same meter: the one that lasts longest in the map (4/4 when there is none). The bars start at
the downbeat and follow each other with no gap.

## Arrangement (extended)

| Field | Change |
|---|---|
| `meters` | **new**, one Meter per bar, in bar order. `assemble` copies them from the lead sheet. Python defaults to `()`, which means every bar is 4/4, for arrangements built by hand in doctests. |

## Allowed values (new setting)

The config key `allowed` (see [contracts/config.md](contracts/config.md)):

| Key | Values | Default |
|---|---|---|
| `allowed.p2` | subset of `hold`, `arp16`, `arp32`, `echo`, `third` | all 5 |
| `allowed.tr` | subset of `root`, `octave_pump`, `root_fifth`, `walking` | all 4 |
| `allowed.no` | subset of `none`, `half_time`, `eighth_beat`, `sixteenth_beat`, `fill` | all 5 |
| `allowed.p1_octave` | subset of `0`, `12`, `-12` | all 3 |

Rules:
- Each list is non-empty, with no duplicates and no unknown value.
- Its order does not matter.

**Allowed genes** (internal): `allowed_genes(allowed)` gives, per gene column (P2, TR, NO, OCT),
the sorted tuple of allowed gene values (indices into `P2_TEXTURES`, …). For example,
`((0, 1, 3, 4), (0, 1, 2, 3), (0, 1, 2, 3, 4), (0, 1, 2))` disallows arp32.

**GA parameters.**
- `GAParams.allowed` (Python) holds the allowed genes, with every value as the default.
- JavaScript: `createGAParams({…, allowed})` holds the same tuples as arrays.

**Draw rules** (research R12), for a gene with allowed tuple `values` of length `k`:
- Initial value: `values[rng.integers(0, k)]` (Python vectorised over the population;
  JavaScript `values[rng.integer(0, k)]` in storage order).
- Mutation of a gene that holds `values[p]`: with probability `rate`, the new value is
  `values[(p + s) % k]`, where `s` is drawn from 1 … `max(k, 2) − 1`.
  - When `k = 1`, the value stays.
  - Python draws `s` for every gene, as today. JavaScript draws it only for a mutating gene with
    `k ≥ 2`.

## Score tables (changed)

| Field | Change |
|---|---|
| `act_no` | shape (n, 5) instead of (5,): the NO activity of each pattern in each bar |
| `act_*`, `reg_*` | measured on the bar's own `steps` grid |

The fitness reads `act_no[bar, NO gene]` in the contrast criterion. No other criterion changes.

In the JavaScript flattened layout, `actNo` is a `Float64Array` of n × 5 values, row-major,
like `actTr`.

## Validation (changed rules)

A note's bar is the last bar whose start is ≤ the note onset (with a tolerance of 1e-9). In that
bar:
- complete bars: `offset + duration ≤ bar_beats` (with the same tolerance);
- chord tones: P2 and TR notes whose offset equals one of `strong_onsets(meter)` must be chord
  tones (the echo texture is still exempt).

## Run record

Both the command line and the app write `allowed` in the run's `config.json`, as they write
every hyperparameter. The input's meters are not settings: the lead sheet records them, and the
arrangement's MIDI file carries them as time signatures. `metrics.json` is unchanged.
