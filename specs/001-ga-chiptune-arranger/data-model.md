# Data Model: GA Chiptune Arranger

Units everywhere in the core: pitches are MIDI numbers (0–127); onsets and durations are floats in
quarter-note beats; a bar has 4 beats (4/4 only). Seconds and MIDI ticks exist only in `export/`.

## Lead sheet (`src/leadsheet/model.py`, frozen dataclasses)

| Entity | Fields | Rules |
|---|---|---|
| `MelodyNote` | `pitch: int`, `onset: float`, `duration: float` | onset from the bar start; `0 <= onset < 4`; `duration > 0`; `onset + duration <= 4`. Chords in the melody keep the highest note; grace notes are dropped; tied notes stay as separate notes. |
| `ChordSegment` | `symbol: str`, `root: int` (pitch class), `tones: tuple[int, ...]` (pitch classes ordered root, third, fifth, seventh when present), `onset: float`, `duration: float` | The segments of a bar cover `[0, 4)` without gaps or overlaps. The chord in effect carries over from the previous bar. Before the first symbol of the piece, the first symbol applies. |
| `Bar` | `index: int`, `melody: tuple[MelodyNote, ...]`, `chords: tuple[ChordSegment, ...]`, `label: str`, `role: str` (`"verse"` or `"chorus"`), `phrase: int`, `phrase_end: bool` | `role` comes from the role map, by default a label that contains "chorus" (any case) or equals "B" maps to chorus. A section is one `P:` occurrence. Phrases are chunks of `phrase_length` bars from each section start, and `phrase_end` marks the last bar of a chunk. |
| `LeadSheet` | `title: str`, `key: str`, `tempo_bpm: float`, `bars: tuple[Bar, ...]` | The meter must be 4/4. Every bar must be complete. Repeat signs (`|:`, `:|`, `::`, `[1`, `[2`) are rejected. At least one chord symbol must exist. |

Chord helpers (`src/leadsheet/chords.py`): `chord_tones(symbol) -> (root, tones)` and
`place_in_register(pitch_class, low) -> int`, which returns the only MIDI pitch with that
pitch class in `[low, low + 11]`.

## Arrangement (`src/arrangement/model.py`)

| Entity | Fields | Rules |
|---|---|---|
| `ChannelNote` | `pitch: int`, `onset: float`, `duration: float`, `velocity: int` | The realizers return onsets relative to the bar; `Arrangement` stores absolute onsets (`bar.index * 4 + onset`). |
| `Arrangement` | `title: str`, `tempo_bpm: float`, `genome: tuple[tuple[int, int, int, int], ...]`, `channels: dict[str, tuple[ChannelNote, ...]]` | Keys are exactly `P1`, `P2`, `TR`, `NO`. |

Constants: `CHANNELS = ("P1", "P2", "TR", "NO")`; ranges `P1, P2: 33–108`, `TR: 21–108`;
registers `P2_ROOT_LOW = 48` (root placed in 48–59) and `TR_ROOT_LOW = 28` (root placed in 28–39);
velocities `P1 100`, `P2 80`, echo `60`, `TR 90`; drums `kick 36 (vel 100)`, `snare 38 (90)`,
`closed hi-hat 42 (60)`.

## Genotype (`src/ga/genome.py`)

A genotype is a `numpy` int array with shape `(n_bars, 4)`. A population has shape
`(m, n_bars, 4)`. The columns are:

| Column | Gene | Values (index → name) |
|---|---|---|
| 0 | P2 texture | 0 hold, 1 arp16, 2 arp32, 3 echo, 4 third |
| 1 | TR texture | 0 root, 1 octave_pump, 2 root_fifth, 3 walking |
| 2 | NO pattern | 0 none, 1 half_time, 2 eighth_beat, 3 sixteenth_beat, 4 fill |
| 3 | P1 octave | 0 as written, 1 up 12, 2 down 12 |

`GENE_SIZES = (5, 4, 5, 3)`.

## Realizers (`src/arrangement/textures.py`, pure functions)

- `realize_p1(bar, octave_gene)`: the melody shifted by 0, +12 or −12, and each note folded by
  octaves into 33–108.
- `realize_p2(bar, texture_gene)`:
  - *hold*: the root of each chord segment, sustained for the segment;
  - *arp16* / *arp32*: the chord tones cycled upward from the root (root in 48–59), with a step of
    0.25 or 0.125 beats, restarting at each segment, the last note clipped at the segment end;
  - *echo*: the written melody shifted by +0.5 beats, clipped at 4, with velocity 60 and a rest
    before 0.5;
  - *third*: for each written melody note, the highest chord tone at least 3 semitones below it,
    with the same onset and duration.
- `realize_tr(bar, texture_gene, next_bar)`, with the root placed in 28–39:
  - *root*: the root, sustained for each segment;
  - *octave_pump*: eighth notes alternating the root and the root + 12;
  - *root_fifth*: quarter notes, the root on beats 1 and 3 and the fifth on beats 2 and 4;
  - *walking*: quarter notes with the root, the third and the fifth on beats 1 to 3, and on beat 4
    the next bar's first root minus 1 semitone (the fifth in the last bar).
  - Each note uses the chord in effect at its onset.
- `realize_no(pattern_gene)`, sixteenth grid (step = 0.25 beats), each hit lasting one step. When
  hits fall on the same step, kick beats snare and snare beats hi-hat.
  - *none*: no hits;
  - *half_time*: K at step 0, S at 8, hi-hat at 4 and 12;
  - *eighth_beat*: K at 0 and 8, S at 4 and 12, hi-hat at 2, 6, 10 and 14;
  - *sixteenth_beat*: K at 0, 8 and 11, S at 4 and 12, hi-hat on all the other steps;
  - *fill*: the eighth beat up to step 11, then S at 12, 13, 14 and 15.

## Validation rules (`src/arrangement/validation.py`)

`find_violations(arrangement, lead_sheet) -> list[str]` returns an empty list when every rule
holds:

1. No two notes of the same channel overlap (`onset_i + duration_i <= onset_j + 1e-9`).
2. Pitch ranges: P1 and P2 within 33–108; TR within 21–108.
3. A note of P2 (when the bar's P2 texture is not *echo*) or of TR that starts on beat 1 or 3
   (relative onset 0 or 2) has a pitch class in the chord in effect.
4. No note crosses its bar end, and every onset is at least 0.

## Score tables (`src/ga/tables.py`)

`build_tables(lead_sheet) -> ScoreTables` realizes every (bar, channel, gene value) once and
stores:

| Field | Shape | Meaning |
|---|---|---|
| `act_p1` | `(n, 3)` | P1 activity = min(1, onsets / 16) |
| `act_p2` | `(n, 5)` | P2 activity |
| `act_tr` | `(n, 4)` | TR activity |
| `act_no` | `(5,)` | NO activity per pattern |
| `reg_both`, `reg_ok` | `(n, 3, 5)` | sixteenth steps where P1 and P2 both sound, and where P2 < P1 |
| `bass_smooth` | `(n − 1, 4, 4)` | leap score from the last TR note of bar i to the first of bar i + 1 |
| `single_chord`, `phrase_end`, `is_chorus` | `(n,)` bool | bar facts |
| `phrase` | `(n,)` int | phrase id |

## Fitness (`src/ga/fitness.py`)

`criterion_scores(tables, population) -> dict[str, ndarray(m)]`, where NaN means "not
applicable":

- **complementarity**: mean over bars of `1 − |act_p2 − (1 − act_p1)|`.
- **register**: `Σ reg_ok / Σ reg_both` over bars, or 1 when `Σ reg_both = 0`.
- **coherence**: the share of adjacent pairs inside a phrase with equal P2, TR and P1 genes and with
  NO genes that are equal or include a *fill*. The score is 1 when no pair exists.
- **contrast**: with density = (act_p2 + act_tr + act_no) / 3, the score is
  `clip(0.5 + mean_chorus − mean_verse, 0, 1)`. It is NaN unless both roles exist.
- **bass_smoothness**: the mean of `bass_smooth` over bar pairs. A leap d scores 1 if d ≤ 5,
  0 if d ≥ 12, and (12 − d) / 7 in between. The score is 1 for a single bar.
- **idiom**: the nanmean of two shares: arp16 or arp32 among single-chord bars, and
  `(NO == fill) == phrase_end` among all bars.
- **fidelity**: the share of bars with P1 octave gene 0 (written octave).

`fitness(tables, population, weights) = Σ w·s / Σ w` over the applicable criteria (0 when the
weight sum is 0).

## GA (`src/ga/operators.py`, `src/ga/evolution.py`)

- `GAParams(population_size, max_generations, stagnation_window, mutation_rate, elite_count)`.
- `evolve(rng, tables, n_bars, params, weights) -> EvolutionResult(best_genome, best_fitness,
  log, stop_reason, initial_best_genome)`, where `log` is one `GenerationStats(generation, best,
  mean, diversity)` per generation (diversity = distinct genotypes / population size), and
  generation 0 is the random population.
- Roulette with windowing: `p ∝ f − min(f)`; uniform when `max(f) == min(f)`.
- Stopping: `max_generations` reached, or no best-fitness improvement greater than 1e-12 for
  `stagnation_window` generations.

## Run configuration (`src/config.py`, `configs/default.json`)

```json
{
  "population_size": 60,
  "max_generations": 1000,
  "stagnation_window": 100,
  "mutation_rate": 0.01,
  "elite_count": 2,
  "phrase_length": 4,
  "tempo_bpm": null,
  "role_map": {},
  "weights": {"complementarity": 1.0, "register": 1.0, "coherence": 1.0,
              "contrast": 1.0, "bass_smoothness": 1.0, "idiom": 1.0, "fidelity": 0.5}
}
```

`config.json` in a run folder holds the resolved configuration, plus `seed`, `input_path`,
`input_sha256`, `git_commit`, `git_dirty`, `created` (ISO 8601), `run_id`, `best_fitness` and
`stop_reason`.
