# Listening notes: ievan-polkka-s1

Run `ievan_polkka-s1-39aaf0de`: Ievan Polkka, seed 1, default configuration. Best fitness 0.912 after 717 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–4 (A): P2 third ×2, hold ×2; TR root ×4; NO none ×2, half time ×1, fill ×1; melody as written ×2, an octave up ×2.
  - bars 5–8 (B): P2 32nd arpeggio ×2, 16th arpeggio ×2; TR octave pump ×4; NO sixteenth beat ×3, fill ×1.
  - bars 9–16 (A): P2 third ×6, hold ×2; TR root ×6, octave pump ×2; NO none ×6, fill ×2.
  - bars 17–20 (B): P2 32nd arpeggio ×4; TR octave pump ×4; NO sixteenth beat ×3, fill ×1.
  - bars 21–24 (A): P2 hold ×4; TR octave pump ×4; NO half time ×3, fill ×1.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- Listening notes (the student's own evaluation, 2026-10-11, translated from Portuguese): The harmony (P2) follows the melody most of the time. Sometimes the melody jumps up an octave for no reason. The transitions into the arpeggios are abrupt. I would have liked to tune it better.
- Note: P2 following the melody is the `third` texture (a chord tone under each melody note), which the GA picks in half of the A bars; the octave jumps are the two A bars with the octave gene at +12.
