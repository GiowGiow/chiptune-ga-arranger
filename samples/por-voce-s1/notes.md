# Listening notes: por-voce-s1

Run `por_voce_bk-s1-c9ff249f`: "Por Você" (Barão Vermelho), bars 4–48 of a fan-made MIDI file from beakauffmann.com, at
about 120 BPM with small tempo changes (file grid). The melody is track 4 (flute): it matches 100% of the lyric syllables embedded in the file. Chords are detected from
the other tracks. Form: verse (A), pre-chorus and chorus. Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.896 after 2896 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–20 (A): P2 32nd arpeggio ×12, third ×4, 16th arpeggio ×4; TR root ×18, walking ×2; NO none ×15, fill ×5.
  - bars 21–28 (Pre): P2 32nd arpeggio ×4, third ×3, 16th arpeggio ×1; TR root ×7, walking ×1; NO half time ×6, fill ×2.
  - bars 29–44 (Chorus): P2 16th arpeggio ×13, 32nd arpeggio ×3; TR octave pump ×12, walking ×4; NO sixteenth beat ×9, fill ×4, eighth beat ×3.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- What works: to be written by the student after listening.
- What does not work: to be written by the student after listening.
