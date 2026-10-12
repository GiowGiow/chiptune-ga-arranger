# Listening notes: korobeiniki-s2

Run `korobeiniki-s2-39aaf0de`: Korobeiniki, seed 2, same configuration as `korobeiniki-s1`. Best fitness 0.936 after 1986 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–16 (A): P2 32nd arpeggio ×12, 16th arpeggio ×4; TR root ×12, walking ×4; NO none ×12, fill ×4.
  - bars 17–24 (B): P2 32nd arpeggio ×8; TR octave pump ×8; NO sixteenth beat ×7, fill ×1.
  - bars 25–32 (A): P2 16th arpeggio ×4, 32nd arpeggio ×4; TR walking ×4, root ×4; NO none ×6, fill ×2.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- Listening notes (the student's own evaluation, 2026-10-11, translated from Portuguese): I could not hear any difference from seed 1.
- Note: the two plans differ in 27% of the genes, almost all between close textures: P2 changes in 75% of the bars, mostly 16th against 32nd-note arpeggios, and the bass in 31% (root against walking); the drums and the melody octave are nearly the same, which is why the seeds sound alike.
