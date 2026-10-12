# Listening notes: voa-voa-s1

Run `voa_voa-s1-ccca2416`: "Voa Voa" (Chiclete com Banana), bars 8–56 of a fan-made MIDI file
recorded live. The file says 120 BPM, but the reader re-estimated the beat grid from the drums at
110.1 BPM. The melody is track 3 (tenor sax), and the chords are detected from the other tracks.
The sections are: verse (A) bars 8–23, pre-chorus bars 24–39, and chorus bars 40–55, which
modulates to G#m–D#m–C#m. Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.839 after 3953 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–16 (A): P2 third ×7, echo ×5, 16th arpeggio ×2, 32nd arpeggio ×2; TR root ×12, root–fifth ×2, walking ×2; NO none ×11, fill ×3, half time ×2; an octave up ×8, melody as written ×8.
  - bars 17–32 (Pre): P2 third ×8, 32nd arpeggio ×5, 16th arpeggio ×3; TR root ×7, walking ×6, octave pump ×3; NO none ×10, fill ×4, half time ×2; melody as written ×14, an octave up ×2.
  - bars 33–48 (Chorus): P2 16th arpeggio ×14, 32nd arpeggio ×2; TR octave pump ×16; NO sixteenth beat ×10, fill ×4, eighth beat ×2.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
- Listening notes (the student's own evaluation, 2026-10-11, translated from Portuguese; they describe the earlier arrangement, made before the 2026-10-12 fix that keeps staccato melody notes): It did not turn out very well: sometimes the arpeggios stop out of nowhere, and the harmony follows the melody in a strange way.
- Note: The arpeggios stop where the GA switches P2 to `third` (a chord tone under each melody note) inside a part.
