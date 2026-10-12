# Listening notes: mulher-de-fases-s1

Run `mulher_de_fases-s1-7de7248c`: "Mulher de Fases" (Raimundos), bars 8–40 of a fan-made MIDI file from beakauffmann.com, at
132.5 BPM (file grid). The melody is track 6 (harmonica): it matches 100% of the lyric syllables embedded in the file. Chords are detected from
the other tracks. Form: two verse/chorus pairs (8 bars each). Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.896 after 1227 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–8 (A): P2 32nd arpeggio ×4, third ×3, 16th arpeggio ×1; TR walking ×5, octave pump ×3; NO none ×6, fill ×2.
  - bars 9–16 (Chorus): P2 16th arpeggio ×8; TR octave pump ×8; NO sixteenth beat ×6, fill ×2.
  - bars 17–24 (A): P2 16th arpeggio ×4, 32nd arpeggio ×2, hold ×2; TR root ×8; NO none ×4, fill ×2, half time ×2.
  - bars 25–32 (Chorus): P2 16th arpeggio ×4, 32nd arpeggio ×4; TR octave pump ×4, root ×4; NO sixteenth beat ×6, fill ×2.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- Listening notes (the student's own evaluation, 2026-10-11, translated from Portuguese): The song's own bass line and the way it is sung make it a very good candidate for this conversion. The arpeggios turned out very well overall, stopping and coming back when needed.
