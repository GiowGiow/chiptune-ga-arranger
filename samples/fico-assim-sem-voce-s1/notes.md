# Listening notes: fico-assim-sem-voce-s1

Run `fico_assim_sem_voce-s1-d4fbaf8e`: "Fico Assim Sem Você" (Adriana Calcanhotto; song by Abdullah and Cacá Moraes), bars 10–58 of a fan-made MIDI file from beakauffmann.com, at
122 BPM (file grid). The melody is track 1 (flute): it matches 100% of the lyric syllables embedded in the file. Chords are detected from
the other tracks. Form: two verses (A) and the chorus. Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.872 after 1900 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–32 (A): P2 16th arpeggio ×13, 32nd arpeggio ×11, third ×6, hold ×2; TR root ×15, octave pump ×11, walking ×6; NO none ×12, half time ×8, fill ×7, sixteenth beat ×3, eighth beat ×2.
  - bars 33–48 (Chorus): P2 32nd arpeggio ×8, 16th arpeggio ×8; TR octave pump ×14, root ×2; NO sixteenth beat ×12, fill ×4.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
