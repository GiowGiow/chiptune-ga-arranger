# Listening notes: aquarela-s1

Run `aquarela-s1-d9735b16`: "Aquarela" (Toquinho), bars 4–36 of a fan-made MIDI file from BitMidi (file 7390, a Soft Karaoke file with the melody on a clarinet track), at
80 BPM (file grid). The melody is track 3 (clarinet (track named "Fretless 2")): the file has no lyrics; it is the monophonic line that plays throughout. Chords are detected from
the other tracks. Form: two 16-bar parts (A, B). Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.895 after 1325 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–16 (A): P2 third ×8, echo ×8; TR root ×16; NO none ×9, fill ×4, half time ×3.
  - bars 17–32 (B): P2 32nd arpeggio ×12, third ×2, echo ×2; TR walking ×8, octave pump ×6, root–fifth ×2; NO sixteenth beat ×12, fill ×4; melody as written ×14, an octave up ×2.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- What works: to be written by the student after listening.
- What does not work: to be written by the student after listening.
