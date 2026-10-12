# Listening notes: aquarela-s1

Run `aquarela-s1-d9735b16`: "Aquarela" (Toquinho), bars 4–36 of a fan-made MIDI file from BitMidi (file 7390, a Soft Karaoke file with the melody on a clarinet track), at
80 BPM (file grid). The melody is track 3 (clarinet (track named "Fretless 2")): the file has no lyrics; it is the monophonic line that plays throughout. Chords are detected from
the other tracks. Form: two 16-bar parts (A, B). Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.871 after 1183 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–16 (A): P2 third ×11, hold ×4, 32nd arpeggio ×1; TR root ×9, octave pump ×5, walking ×2; NO none ×10, fill ×4, eighth beat ×2.
  - bars 17–32 (B): P2 32nd arpeggio ×11, 16th arpeggio ×5; TR octave pump ×10, walking ×6; NO sixteenth beat ×5, fill ×4, eighth beat ×4, half time ×3.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
