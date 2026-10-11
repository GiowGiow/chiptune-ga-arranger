# Listening notes: ievan-polkka-s1-contrast0

Run `ievan_polkka-s1-175532e9`: Ievan Polkka, seed 1, with `--set weights.contrast=0`. Best
fitness 0.871 over the six other criteria, after 330 generations.

- What to listen for: compare with `ievan-polkka-s1`. Without the contrast criterion, the GA
  prefers the "third" texture: P2 follows the melody with the chord tone below each note, so most
  of the piece sounds like a harmonized melody. Verse and chorus are no longer set apart by
  density (contrast score 0.52 against 1.00 in the default run).
- What works: the parallel line is consonant and close to how chiptune covers double a vocal
  melody.
- What does not work: the form is less audible, and texture changes inside phrases are more
  frequent (coherence 0.67).
