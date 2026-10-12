# Listening notes: amor-i-love-you-s1

Run `amor_i_love_you-s1-e24d1066`: "Amor I Love You" (Marisa Monte), bars 0–56 of a fan-made MIDI file from beakauffmann.com, at
114 BPM (file grid). The melody is track 2 (flute): it matches 100% of the lyric syllables embedded in the file. Chords are detected from
the other tracks. Form: verse (A), bridge (B), verse and chorus. Seed 1, with up to 4000 generations and a stagnation window of 400. Best fitness 0.833 after 2935 generations.

- The plan per part (bar counts of each texture, from `metrics.json`):
  - bars 1–16 (A): P2 32nd arpeggio ×8, 16th arpeggio ×5, third ×3; TR root ×10, octave pump ×5, walking ×1; NO none ×7, half time ×6, fill ×3; melody as written ×12, an octave up ×4.
  - bars 17–24 (B): P2 16th arpeggio ×5, 32nd arpeggio ×3; TR octave pump ×8; NO sixteenth beat ×5, fill ×2, eighth beat ×1.
  - bars 25–40 (A): P2 16th arpeggio ×6, third ×4, 32nd arpeggio ×4, echo ×2; TR root ×11, walking ×3, octave pump ×2; NO none ×10, fill ×3, half time ×2, eighth beat ×1; melody as written ×12, an octave up ×4.
  - bars 41–56 (Chorus): P2 16th arpeggio ×10, 32nd arpeggio ×6; TR octave pump ×11, walking ×3, root ×2; NO sixteenth beat ×7, fill ×4, eighth beat ×3, none ×2; melody as written ×10, an octave up ×6.
- What to listen for: compare `input.mp3` (the input), `piece.mp3` (the arrangement with General
  MIDI timbres) and `piece-chip.mp3` (the same arrangement on the chip synthesizer); `piece.mp4`
  shows the four channels.
