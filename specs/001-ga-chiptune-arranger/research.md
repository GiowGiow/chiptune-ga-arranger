# Research: GA Chiptune Arranger

Short decisions for the 2026-10-11 deadline. Each entry gives the decision, the rationale and the
alternatives that were rejected.

## R1. Reading part labels from ABC

- **Decision**: parse the notes and chord symbols with music21, and read the `P:` labels from the
  ABC text. A `P:` line sets the current label. Each `|` on a music line closes one bar, which
  takes the current label. The reader checks that the number of labelled bars equals the number of
  music21 measures.
- **Rationale**: music21 drops `P:` fields (verified on `data/leadsheets/ievan_polkka.abc`). The
  two lead sheets put one or more complete bars on each line, with no repeat signs.
- **Alternatives**: parsing each part as its own tune (the chord in effect is lost between parts);
  writing an ABC parser (too much work).

## R2. Numbers and units

- **Decision**: durations and onsets are floats in quarter-note beats. Every value in the inputs and
  textures is a multiple of 1/8 beat, so the values are exact in binary floating point. Comparisons
  use a tolerance of 1e-9.
- **Rationale**: simpler than `Fraction`, and exact for this material. Triplets are not used.
- **Alternatives**: `fractions.Fraction` (slower and noisier code for no gain here).

## R3. Fitness speed

- **Decision**: each realization depends only on (bar, channel, gene value). `ga/tables.py`
  computes every realization once, then builds per-bar score tables: complementarity
  `C1[bar, oct, p2]`, register counts `C2[bar, oct, p2]`, density per channel, and bass-transition
  scores `C5[bar, tr, tr_next]`. The fitness of a whole population is computed with numpy fancy
  indexing.
- **Rationale**: 60 × 200 genotypes × 32 bars evaluate in milliseconds, not minutes (SC-001).
- **Alternatives**: realizing every genotype in full on every evaluation (around 100× slower).

## R4. Echo and third textures ignore the P1 octave gene

- **Decision**: the P2 *echo* and *third* textures use the melody as written, not the octave-shifted
  P1.
- **Rationale**: this keeps every realization dependent on one gene only, which the cache in R3
  needs. The register criterion (C2) still penalizes a P2 above P1 after an octave shift, so the GA
  learns to avoid it.
- **Alternatives**: making P2 depend on the P1 gene (breaks the separable cache).

## R5. Roulette selection details

- **Decision**: parents are drawn with `rng.choice(m, size, p=w/Σw)`, where `w = f − min(f)`
  (windowing). When every fitness is equal, the draw is uniform. The elite (the k best) is copied unchanged first. The other m − k children come from
  pairs of parents, through one-point crossover with the cut between bars and then per-gene
  mutation. A mutated gene takes `(old + rng.integers(1, size)) % size`, which is a different valid
  value drawn uniformly.
- **Rationale**: this follows the course slides (A09 p. 18–21). The professor used the same roulette
  with elitism in `ferreira2019learning`. Windowing answers the warning in
  `references/tp1/ga-arranjo-nes.md` §3.3: a weighted mean of criteria in [0, 1] gives close
  fitness values, and plain roulette then draws almost uniformly. The Nature of Code reading also
  suggests rescaling the fitness. The default mutation rate is 0.01 per gene, close to 1/L (L = 4 ×
  bars): 0.1, as in the slide, would change about 10 genes per child and break phrase coherence
  (`ozcan2008genetic` p. 4; `scirea2017affective` p. 15).
- **Alternatives**: tournament selection, which most music GAs use and which did better than roulette
  in `kaliakatsos2012interactive` p. 8, but which is not the one shown in class. Plain roulette was
  rejected because of the weak selection pressure.

## R6. Audio rendering

- **Decision**: `fluidsynth -ni -q -g 0.4 -r 44100 -F piece.wav FluidR3_GM.sf2 piece.mid`, then
  `ffmpeg -codec:a libmp3lame -qscale:a 4`, then the WAV is deleted. The GM programs are 80
  (Lead 1 square) for P1 and P2 and 38 (Synth Bass 1) for TR. NO goes to the drum channel with kick
  36, snare 38 and closed hi-hat 42. A missing program or soundfont skips the audio with a message.
- **Rationale**: the constitution requires FluidSynth with a GM soundfont. A gain of 0.4 kept the
  peaks at −4.6 dB in the lead-sheet previews, while 0.7 clipped.
- **Alternatives**: a numpy chip synth (would need a constitution amendment).

## R7. Run identity and configuration

- **Decision**: the run id is `<input-stem>-s<seed>-<first 8 hex of SHA-256 of the canonical JSON
  config>`. The configuration is `configs/default.json`, an optional `--config` file and repeated
  `--set dotted.key=json_value` overrides. The resolved configuration goes into `config.json`.
- **Rationale**: the same run maps to the same folder, and any hyperparameter can change without
  editing code (FR-020).
- **Alternatives**: timestamped run ids (two identical runs land in different folders).

## R8. Literature for the abstract (GA in music, three or more)

- **Decision**: use the kit in `references/tp1/ga-arranjo-nes.md` §5. The GA references are
  `tuohy2006gabased`, `carpentier2010solving`, `freitas2011melody`, `phonamnuaisuk1999evolving`,
  `biles1994genjam`, `ozcan2008genetic` and `kaliakatsos2012interactive`. The NES and chiptune
  context comes from `donahue2018nes`, `driscoll2009endless` and `collins2007loop`, plus
  `donahue2019lakhnes` or `cardoso2024nes`. Export the BibTeX with `refs.py bib`. Call the fitness
  a weighted sum, not multi-objective, and give Pareto optimization as future work
  (`fernandez2013ai` p. 50).
- **Rationale**: the library already holds entries, page-cited notes and ready-made English
  sentences for each of these papers. No GA for the NES chip was found, so the contribution is the
  NES idiom as the stylistic constraint of a GA arranger.
- **Alternatives**: none needed.
