# Listening notes: ievan-polkka-s1-fidelity0

Run `ievan_polkka-s1-5bf5c409`: Ievan Polkka, seed 1, with `--set weights.fidelity=0`. Best fitness
0.903 over the six other criteria, after 915 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - A parts (16 bars): P2 hold ×14, echo ×1, third ×1; TR octave pump ×10, root–fifth ×4, root ×2; NO half time ×5, none ×4, fill ×4, eighth beat ×3.
  - B parts (8 bars): P2 32nd arpeggio ×7, 16th arpeggio ×1; TR octave pump ×8; NO sixteenth beat ×6, fill ×2.
  - Melody: 12 of the 24 bars an octave away from the written octave.
- What to listen for: compare with `ievan-polkka-s1` (same seed, fidelity weight 0.5): without the
  fidelity criterion the GA moves half of the melody bars up an octave to win the register
  criterion, so the melody jumps between registers.
- What works: to be written by the student after listening.
- What does not work: to be written by the student after listening.
