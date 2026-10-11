# Listening notes: voa-voa-s1

Run `voa_voa-s1-a4ef6256`: "Voa Voa" (Chiclete com Banana), bars 8–56 of a fan-made MIDI file
recorded live. The file says 120 BPM, but the reader re-estimated the beat grid from the drums at
110.1 BPM. The melody is track 3 (tenor sax), and the chords are detected from the other tracks.
The sections are: verse (A) bars 8–23, pre-chorus bars 24–39, and chorus bars 40–55, which
modulates to G#m–D#m–C#m. Seed 1, with up to 4000 generations. Best fitness 0.802 after 1784
generations.

- What to listen for:
  - The verse starts sparse: P2 holds the root, there are no drums, and the melody is one octave
    up.
  - It then moves to echoes and arpeggios.
  - The chorus switches to an octave-pump or walking bass with a sixteenth-note beat and fast
    arpeggios.
- What works: the chorus is clearly the climax, and the chip rendering (`piece-chip.mp3`)
  sounds like an NES cover.
- What does not work:
  - The sax melody sits low (around B3), so P2 often has to stay above it or the GA moves the
    melody up an octave. Register (0.93) and fidelity (0.73) are lower than for the ABC tunes.
  - Detected chords are spelled with flats (Ebm7 for D#m7).
- Original for comparison: `input.mp3`, the same bars of the band MIDI file.
