import mido
import pretty_midi
import pytest

from leadsheet.midi_reader import detect_chord, read_lead_sheet_midi, skyline


def write_song(path, tempo=120.0):
    """Four bars: melody C5 quarters; C major then G major chords per half bar; bass; drums."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    beat = 60.0 / tempo
    melody = pretty_midi.Instrument(program=66, name="sax")
    chords = pretty_midi.Instrument(program=27, name="guitar")
    bass = pretty_midi.Instrument(program=33, name="bass")
    drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    for b in range(16):
        # Slightly early onsets (humanized), as in hand-played MIDI files.
        melody.notes.append(
            pretty_midi.Note(90, 72 + (b % 2) * 2, b * beat - 0.01, (b + 0.9) * beat)
        )
        drums.notes.append(pretty_midi.Note(90, 36, b * beat, b * beat + 0.1))
    for half in range(8):
        pitches = (60, 64, 67) if half % 2 == 0 else (55, 59, 62)
        start, end = half * 2 * beat, (half + 1) * 2 * beat
        for p in pitches:
            chords.notes.append(pretty_midi.Note(70, p, start, end))
        bass.notes.append(pretty_midi.Note(80, pitches[0] - 24, start, end))
    midi.instruments += [melody, chords, bass, drums]
    midi.write(str(path))
    return path


def test_skyline_keeps_the_highest_note_and_cuts_overlaps():
    notes = [(0.0, 2.0, 60), (0.0, 1.0, 64), (1.0, 2.0, 62)]
    assert skyline(notes) == [(0.0, 1.0, 64), (1.0, 2.0, 62)]


def test_detect_chord_matches_triads_and_sevenths():
    weights = [0.0] * 12
    for pc in (7, 11, 2):
        weights[pc] = 1.0
    assert detect_chord(weights, bass_pc=7)[0] == "G"
    weights[5] = 0.8
    assert detect_chord(weights, bass_pc=7)[0] == "G7"
    minor = [0.0] * 12
    for pc in (9, 0, 4):
        minor[pc] = 1.0
    assert detect_chord(minor, bass_pc=9)[0] == "Am"


def test_midi_lead_sheet_has_quantized_melody_and_detected_chords(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_song(tmp_path / "song.mid"), melody_track=0)
    assert len(lead_sheet.bars) == 4
    assert lead_sheet.tempo_bpm == pytest.approx(120.0)
    first = lead_sheet.bars[0]
    assert [n.onset for n in first.melody] == [0.0, 1.0, 2.0, 3.0]
    assert [n.pitch for n in first.melody] == [72, 74, 72, 74]
    assert [c.symbol for c in first.chords] == ["C", "G"]
    assert [(c.onset, c.duration) for c in first.chords] == [(0.0, 2.0), (2.0, 2.0)]
    assert first.chords[0].tones == (0, 4, 7)


def write_staccato_song(path, tempo=120.0):
    """One bar: four staccato sixteenths (0.1 beat each), a 0.3-beat note on beat 2, a bass."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    beat = 60.0 / tempo
    voice = pretty_midi.Instrument(program=73, name="voice")
    bass = pretty_midi.Instrument(program=33, name="bass")
    for sixteenth, pitch in enumerate((72, 74, 72, 74)):
        start = sixteenth * 0.25 * beat
        voice.notes.append(pretty_midi.Note(90, pitch, start, start + 0.1 * beat))
    voice.notes.append(pretty_midi.Note(90, 76, 2 * beat, 2.3 * beat))
    bass.notes.append(pretty_midi.Note(80, 36, 0.0, 4 * beat))
    midi.instruments += [voice, bass]
    midi.write(str(path))
    return path


def test_staccato_sixteenths_shorter_than_half_a_sixteenth_keep_one_sixteenth_each(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_staccato_song(tmp_path / "song.mid"), melody_track=0)
    melody = [(n.pitch, n.onset, n.duration) for n in lead_sheet.bars[0].melody]
    assert melody[:4] == [(72, 0.0, 0.25), (74, 0.25, 0.25), (72, 0.5, 0.25), (74, 0.75, 0.25)]


def test_a_note_of_0_3_beats_still_snaps_its_end_to_the_nearest_sixteenth(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_staccato_song(tmp_path / "song.mid"), melody_track=0)
    # 2.0 to 2.3 beats snaps to 2.0 to 2.25, as before staccato notes kept their sixteenth.
    late = [(n.pitch, n.onset, n.duration) for n in lead_sheet.bars[0].melody if n.onset >= 1.0]
    assert late == [(76, 2.0, 0.25)]


def test_bar_excerpt_and_sections_set_labels_roles_and_phrases(tmp_path):
    path = write_song(tmp_path / "song.mid")
    lead_sheet = read_lead_sheet_midi(
        path, melody_track=0, bars=(1, 4), sections=[(0, "A"), (2, "B")], phrase_length=2
    )
    assert len(lead_sheet.bars) == 3
    assert [b.label for b in lead_sheet.bars] == ["A", "A", "B"]
    assert [b.role for b in lead_sheet.bars] == ["verse", "verse", "chorus"]
    assert [b.phrase_end for b in lead_sheet.bars] == [False, True, True]
    assert [b.index for b in lead_sheet.bars] == [0, 1, 2]


def test_a_drum_track_cannot_be_the_melody(tmp_path):
    with pytest.raises(ValueError, match="drum"):
        read_lead_sheet_midi(write_song(tmp_path / "song.mid"), melody_track=3)


def test_several_melody_tracks_merge_into_one_line(tmp_path):
    path = write_song(tmp_path / "song.mid")
    lead_sheet = read_lead_sheet_midi(path, melody_track=[0, 1])
    # The chord track is higher than nothing but lower than the melody: the skyline keeps 72/74.
    assert [n.pitch for n in lead_sheet.bars[0].melody] == [72, 74, 72, 74]


def write_off_grid_song(path, real_bpm=110.0, file_bpm=120.0, offset=0.3):
    """A live recording: the music runs at real_bpm but the file says file_bpm."""
    midi = pretty_midi.PrettyMIDI(initial_tempo=file_bpm)
    beat = 60.0 / real_bpm
    melody = pretty_midi.Instrument(program=66, name="sax")
    chords = pretty_midi.Instrument(program=27, name="guitar")
    bass = pretty_midi.Instrument(program=33, name="bass")
    drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    for b in range(32):
        start = offset + b * beat
        drums.notes.append(pretty_midi.Note(90, 36, start, start + 0.1))
        drums.notes.append(pretty_midi.Note(60, 42, start + beat / 2, start + beat / 2 + 0.05))
        melody.notes.append(pretty_midi.Note(90, 72, start, start + 0.9 * beat))
    for bar in range(8):
        start = offset + bar * 4 * beat
        for p in (60, 64, 67):
            chords.notes.append(pretty_midi.Note(70, p, start, start + 4 * beat))
        # The bass plays a long root on beat 1 and a short note on beat 3.
        bass.notes.append(pretty_midi.Note(80, 36, start, start + 1.5 * beat))
        bass.notes.append(pretty_midi.Note(80, 43, start + 2 * beat, start + 2.4 * beat))
    midi.instruments += [melody, chords, bass, drums]
    midi.write(str(path))
    return path


def test_beat_grid_is_estimated_when_the_file_tempo_is_wrong(tmp_path):
    from leadsheet.midi_reader import estimate_beat_grid

    midi = pretty_midi.PrettyMIDI(str(write_off_grid_song(tmp_path / "live.mid")))
    bpm, downbeat, strength = estimate_beat_grid(midi)
    assert bpm == pytest.approx(110.0, abs=0.1)
    assert downbeat == pytest.approx(0.3, abs=0.02)
    assert strength > 0.9


def test_an_off_grid_file_is_read_on_its_real_grid(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_off_grid_song(tmp_path / "live.mid"), melody_track=0)
    assert lead_sheet.tempo_bpm == pytest.approx(110.0, abs=0.1)
    assert lead_sheet.source_grid[0] == pytest.approx(110.0, abs=0.1)
    assert len(lead_sheet.bars) == 8
    assert [n.onset for n in lead_sheet.bars[0].melody] == [0.0, 1.0, 2.0, 3.0]
    assert [c.symbol for c in lead_sheet.bars[0].chords] == ["C"]


def test_a_file_on_its_own_grid_keeps_the_file_tempo(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_song(tmp_path / "song.mid"), melody_track=0)
    assert lead_sheet.source_grid == (pytest.approx(120.0), 0.0)


def write_count_in_song(path, tempo=120.0, pickup=True):
    """Two 3/4 bars of count-in, then four 4/4 bars (C, G, C, G) from 3 s on, at 120 BPM.

    Drums play every beat. With `pickup`, a G4 sounds on the last count-in beat; without it the
    count-in is drums only. The melody plays C5 or D5 for two beats on each 4/4 downbeat.
    """
    beat = 60.0 / tempo
    lead_in = 2 * 3 * beat
    midi = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    midi.time_signature_changes = [
        pretty_midi.TimeSignature(3, 4, 0.0),
        pretty_midi.TimeSignature(4, 4, lead_in),
    ]
    melody = pretty_midi.Instrument(program=66, name="sax")
    chords = pretty_midi.Instrument(program=27, name="guitar")
    bass = pretty_midi.Instrument(program=33, name="bass")
    drums = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    if pickup:
        melody.notes.append(pretty_midi.Note(90, 67, lead_in - beat, lead_in))
    for b in range(6 + 16):
        drums.notes.append(pretty_midi.Note(90, 36, b * beat, b * beat + 0.1))
    for bar in range(4):
        start, end = lead_in + bar * 4 * beat, lead_in + (bar + 1) * 4 * beat
        melody.notes.append(pretty_midi.Note(90, 72 + (bar % 2) * 2, start, start + 2 * beat))
        pitches = (60, 64, 67) if bar % 2 == 0 else (55, 59, 62)
        for p in pitches:
            chords.notes.append(pretty_midi.Note(70, p, start, end))
        bass.notes.append(pretty_midi.Note(80, pitches[0] - 24, start, end))
    midi.instruments += [melody, chords, bass, drums]
    midi.write(str(path))
    return path


def with_meters(path, meters):
    """Rewrite a MIDI file with other time signatures: (numerator, denominator, seconds)."""
    midi = pretty_midi.PrettyMIDI(str(path))
    midi.time_signature_changes = [pretty_midi.TimeSignature(n, d, t) for n, d, t in meters]
    midi.write(str(path))
    return path


def write_waltz_song(path, tempo=120.0, meter=(3, 4), bars=4):
    """`bars` bars in one meter: a melody note on every beat, one chord per bar (C, F, G, C)."""
    from leadsheet.meter import Meter

    bar_meter = Meter(*meter)
    beat = 60.0 / tempo
    midi = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    midi.time_signature_changes = [pretty_midi.TimeSignature(*meter, 0.0)]
    melody = pretty_midi.Instrument(program=73, name="flute")
    pad = pretty_midi.Instrument(program=89, name="pad")
    bass = pretty_midi.Instrument(program=33, name="bass")
    triads = [(60, 64, 67), (65, 69, 72), (67, 71, 74), (60, 64, 67)]
    position = 0.0
    for bar in range(bars):
        for length in bar_meter.beats:
            start = position * beat
            melody.notes.append(pretty_midi.Note(90, 76, start, start + length * beat * 0.9))
            position += length
        bar_start, bar_end = (position - bar_meter.bar_beats) * beat, position * beat
        triad = triads[bar % 4]
        for pitch in triad:
            pad.notes.append(pretty_midi.Note(70, pitch, bar_start, bar_end))
        bass.notes.append(pretty_midi.Note(80, triad[0] - 24, bar_start, bar_end))
    midi.instruments += [melody, pad, bass]
    midi.write(str(path))
    return path


# --- the time-signature map (spec 003, research R8) -----------------------------------------


def test_the_bar_map_lists_every_bar_of_the_file_with_its_meter(tmp_path):
    from leadsheet.midi_reader import bar_map

    count_in = pretty_midi.PrettyMIDI(str(write_count_in_song(tmp_path / "count_in.mid")))
    four_four = pretty_midi.PrettyMIDI(str(write_song(tmp_path / "song.mid")))

    assert [(bar.start, str(bar.meter)) for bar in bar_map(count_in)] == [
        (0.0, "3/4"),
        (3.0, "3/4"),
        (6.0, "4/4"),
        (10.0, "4/4"),
        (14.0, "4/4"),
        (18.0, "4/4"),
    ]
    assert [bar.start for bar in bar_map(four_four)] == [0.0, 4.0, 8.0, 12.0]


def test_a_file_without_time_signatures_is_four_four():
    from leadsheet.midi_reader import bar_map

    midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    piano = pretty_midi.Instrument(program=0)
    piano.notes.append(pretty_midi.Note(90, 60, 0.0, 3.9))  # 7.8 beats: two bars
    midi.instruments.append(piano)

    assert [(bar.start, str(bar.meter)) for bar in bar_map(midi)] == [(0.0, "4/4"), (4.0, "4/4")]


def test_by_default_a_drum_only_count_in_is_left_out(tmp_path):
    path = write_count_in_song(tmp_path / "song.mid", pickup=False)

    lead_sheet = read_lead_sheet_midi(path, melody_track=0)

    assert len(lead_sheet.bars) == 4
    assert {str(bar.meter) for bar in lead_sheet.bars} == {"4/4"}
    assert [(n.pitch, n.onset, n.duration) for n in lead_sheet.bars[0].melody] == [(72, 0.0, 2.0)]
    assert [[c.symbol for c in bar.chords] for bar in lead_sheet.bars] == [["C"], ["G"]] * 2
    assert lead_sheet.source_grid == (pytest.approx(120.0), 0.0)


def test_by_default_a_count_in_bar_with_a_pickup_note_is_part_of_the_song(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_count_in_song(tmp_path / "song.mid"), melody_track=0)

    assert [str(bar.meter) for bar in lead_sheet.bars] == ["3/4", "4/4", "4/4", "4/4", "4/4"]
    assert [(n.pitch, n.onset, n.duration) for n in lead_sheet.bars[0].melody] == [(67, 2.0, 1.0)]


def test_an_excerpt_counts_bars_from_the_first_bar_of_the_file(tmp_path):
    path = write_count_in_song(tmp_path / "song.mid")

    lead_sheet = read_lead_sheet_midi(path, melody_track=0, bars=(3, 6))

    # Bars 0 and 1 are the count-in, so bar 3 is the second 4/4 bar.
    assert [[(n.pitch, n.onset) for n in bar.melody] for bar in lead_sheet.bars] == [
        [(74, 0.0)],
        [(72, 0.0)],
        [(74, 0.0)],
    ]
    assert [c.symbol for c in lead_sheet.bars[0].chords] == ["G"]


def test_an_explicit_grid_reads_the_song_in_its_main_meter_from_its_own_downbeat(tmp_path):
    path = write_count_in_song(tmp_path / "song.mid")
    # Bars of 2 s (4/4 lasts longest in the file) from 1 s on: the last note ends at 11 s.
    lead_sheet = read_lead_sheet_midi(path, melody_track=0, grid=(120.0, 1.0))
    assert len(lead_sheet.bars) == 5
    assert {str(bar.meter) for bar in lead_sheet.bars} == {"4/4"}
    assert lead_sheet.source_grid == (120.0, 1.0)


def test_a_meter_change_inside_the_music_moves_the_following_bar_lines(tmp_path):
    path = with_meters(write_song(tmp_path / "song.mid"), [(4, 4, 0.0), (3, 4, 4.0)])

    lead_sheet = read_lead_sheet_midi(path, melody_track=0)

    assert [str(bar.meter) for bar in lead_sheet.bars] == ["4/4", "4/4", "3/4", "3/4", "3/4"]
    assert [n.onset for n in lead_sheet.bars[3].melody] == [0.0, 1.0, 2.0]


def test_a_waltz_has_three_beat_bars_and_one_chord_per_bar(tmp_path):
    lead_sheet = read_lead_sheet_midi(write_waltz_song(tmp_path / "waltz.mid"), melody_track=0)

    assert len(lead_sheet.bars) == 4
    assert {str(bar.meter) for bar in lead_sheet.bars} == {"3/4"}
    assert [[(c.symbol, c.onset, c.duration) for c in bar.chords] for bar in lead_sheet.bars] == [
        [("C", 0.0, 3.0)],
        [("F", 0.0, 3.0)],
        [("G", 0.0, 3.0)],
        [("C", 0.0, 3.0)],
    ]
    assert [n.onset for n in lead_sheet.bars[1].melody] == [0.0, 1.0, 2.0]


def test_a_two_four_song_has_two_beat_bars(tmp_path):
    path = write_waltz_song(tmp_path / "polka.mid", meter=(2, 4))

    lead_sheet = read_lead_sheet_midi(path, melody_track=0)

    assert len(lead_sheet.bars) == 4
    assert {bar.meter.bar_beats for bar in lead_sheet.bars} == {2.0}


def test_an_unsupported_meter_inside_the_excerpt_is_refused_naming_it(tmp_path):
    path = with_meters(write_song(tmp_path / "song.mid"), [(5, 8, 0.0)])

    with pytest.raises(ValueError, match="bar 0: the meter 5/8 is not supported"):
        read_lead_sheet_midi(path, melody_track=0)


def test_a_bar_cut_short_by_a_time_signature_change_is_refused_inside_the_excerpt(tmp_path):
    # 3/4 starts on beat 6, in the middle of bar 1 (beats 4-8): bar 1 lasts only 2 beats.
    path = with_meters(write_song(tmp_path / "song.mid"), [(4, 4, 0.0), (3, 4, 3.0)])

    with pytest.raises(ValueError, match=r"bar 1 \(2\.0 s\) lasts 2 beats instead of 4"):
        read_lead_sheet_midi(path, melody_track=0)
    assert len(read_lead_sheet_midi(path, melody_track=0, bars=(2, 5)).bars) == 3


def write_tempo_change_song(path):
    """A 3/4 count-in at 127 BPM, then 4/4 at 98 BPM from beat 6 (changes on the bar line)."""
    resolution = 480
    song = mido.MidiFile(type=1, ticks_per_beat=resolution)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("time_signature", numerator=3, denominator=4, time=0))
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(127), time=0))
    meta.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=6 * resolution))
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(98), time=0))
    song.tracks.append(meta)
    voice = mido.MidiTrack()
    voice.append(mido.Message("program_change", program=0, time=0))
    voice.append(mido.Message("note_on", note=72, velocity=100, time=6 * resolution))
    voice.append(mido.Message("note_off", note=72, velocity=0, time=4 * resolution))
    song.tracks.append(voice)
    chords = mido.MidiTrack()
    chords.append(mido.Message("program_change", program=0, time=0))
    for pitch in (48, 52, 55):
        chords.append(
            mido.Message(
                "note_on", note=pitch, velocity=80, time=6 * resolution if pitch == 48 else 0
            )
        )
    for index, pitch in enumerate((48, 52, 55)):
        chords.append(
            mido.Message(
                "note_off", note=pitch, velocity=0, time=4 * resolution if index == 0 else 0
            )
        )
    song.tracks.append(chords)
    song.save(path)
    return path


def test_the_tempo_is_the_one_in_effect_where_the_excerpt_starts_not_the_count_in_tempo(tmp_path):
    lead_sheet = read_lead_sheet_midi(
        write_tempo_change_song(tmp_path / "song.mid"), melody_track=0
    )
    assert round(lead_sheet.tempo_bpm, 3) == 98.0
    # The grid itself still reads the file's own ticks: the first tempo names it.
    assert round(lead_sheet.source_grid[0], 3) == 127.0


def test_a_song_whose_meter_changes_has_bars_of_each_meter(tmp_path):
    from export.fixtures import synthetic_song

    path = tmp_path / "changes.mid"
    synthetic_song([(4, 4, 2, True), (2, 4, 2, True), (4, 4, 2, True)]).write(str(path))

    lead_sheet = read_lead_sheet_midi(path, melody_track=0)

    assert [bar.meter.bar_beats for bar in lead_sheet.bars] == [4.0, 4.0, 2.0, 2.0, 4.0, 4.0]
    assert [len(bar.melody) for bar in lead_sheet.bars] == [4, 4, 2, 2, 4, 4]


def test_a_twelve_eight_song_decides_chords_on_half_bars(tmp_path):
    from export.fixtures import synthetic_song

    path = tmp_path / "twelve.mid"
    synthetic_song([(12, 8, 2, True)]).write(str(path))

    lead_sheet = read_lead_sheet_midi(path, melody_track=0)

    assert [bar.meter.bar_beats for bar in lead_sheet.bars] == [6.0, 6.0]
    assert [[(c.symbol, c.onset) for c in bar.chords] for bar in lead_sheet.bars] == [
        [("C", 0.0), ("F", 3.0)],
        [("G7", 0.0), ("C", 3.0)],
    ]


def test_an_estimated_grid_cannot_read_a_seven_eight_song(tmp_path):
    from export.fixtures import synthetic_song

    song = synthetic_song([(7, 8, 4, True)])
    drums = song.instruments[-1]
    # Drums off the file's sixteenth grid make the reader estimate the grid.
    for index, note in enumerate(drums.notes):
        note.start += 0.03 * (index % 3)
        note.end = note.start + 0.1
    path = tmp_path / "seven.mid"
    song.write(str(path))

    with pytest.raises(ValueError, match=r"7/8 song needs the file's own beat grid"):
        read_lead_sheet_midi(path, melody_track=0)
    assert len(read_lead_sheet_midi(path, melody_track=0, grid="file").bars) == 4
