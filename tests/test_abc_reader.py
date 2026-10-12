"""Reading ABC lead sheets: melody, chords in effect, form, phrases and the rejected cases."""

from pathlib import Path

import pytest

from leadsheet.abc_reader import read_lead_sheet, read_lead_sheet_text

LEADSHEETS = Path(__file__).resolve().parent.parent / "data" / "leadsheets"


def abc(body: str, meter: str = "M:4/4\n", extra_header: str = "") -> str:
    """Wrap a tune body in a minimal ABC header (one quarter note per letter)."""
    return f"X:1\nT:Test tune\n{meter}L:1/4\n{extra_header}K:C\n{body}\n"


def chords_of(bar) -> list[tuple[str, float, float]]:
    return [(segment.symbol, segment.onset, segment.duration) for segment in bar.chords]


def melody_of(bar) -> list[tuple[int, float, float]]:
    return [(note.pitch, note.onset, note.duration) for note in bar.melody]


@pytest.fixture(scope="module")
def korobeiniki():
    return read_lead_sheet(LEADSHEETS / "korobeiniki.abc")


@pytest.fixture(scope="module")
def ievan_polkka():
    return read_lead_sheet(LEADSHEETS / "ievan_polkka.abc")


# --- Korobeiniki: a 32-bar A A B A tune ---


def test_korobeiniki_has_32_bars_at_150_quarter_notes_per_minute(korobeiniki):
    assert len(korobeiniki.bars) == 32
    assert korobeiniki.tempo_bpm == 150.0
    assert [bar.index for bar in korobeiniki.bars] == list(range(32))


def test_korobeiniki_keeps_its_title_and_key(korobeiniki):
    assert korobeiniki.title == "Korobeiniki (Tetris theme)"
    assert korobeiniki.key == "a minor"
    assert {str(bar.meter) for bar in korobeiniki.bars} == {"4/4"}


def test_korobeiniki_labels_follow_the_form_a_a_b_a(korobeiniki):
    assert [bar.label for bar in korobeiniki.bars] == ["A"] * 16 + ["B"] * 8 + ["A"] * 8


def test_part_b_is_the_chorus_and_part_a_is_the_verse(korobeiniki):
    assert [bar.role for bar in korobeiniki.bars] == ["verse"] * 16 + ["chorus"] * 8 + ["verse"] * 8


def test_every_fourth_bar_ends_a_phrase(korobeiniki):
    phrase_ends = [bar.index for bar in korobeiniki.bars if bar.phrase_end]

    assert phrase_ends == [3, 7, 11, 15, 19, 23, 27, 31]
    assert [bar.phrase for bar in korobeiniki.bars] == [i // 4 for i in range(32)]


def test_korobeiniki_first_bar_holds_one_e_major_chord_for_the_whole_bar(korobeiniki):
    (segment,) = korobeiniki.bars[0].chords

    assert (segment.symbol, segment.onset, segment.duration) == ("E", 0.0, 4.0)
    assert (segment.root, segment.tones) == (4, (4, 8, 11))


def test_korobeiniki_first_melody_note_is_e5_on_the_downbeat_for_one_beat(korobeiniki):
    first = korobeiniki.bars[0].melody[0]

    assert (first.pitch, first.onset, first.duration) == (76, 0.0, 1.0)


@pytest.mark.parametrize("tune", ["korobeiniki", "ievan_polkka"])
def test_chord_segments_cover_every_bar_without_gaps_or_overlaps(tune, request):
    for bar in request.getfixturevalue(tune).bars:
        onsets = [segment.onset for segment in bar.chords]
        ends = [segment.onset + segment.duration for segment in bar.chords]
        assert onsets[0] == 0.0
        assert onsets[1:] == ends[:-1]
        assert ends[-1] == 4.0


@pytest.mark.parametrize("tune", ["korobeiniki", "ievan_polkka"])
def test_melody_notes_stay_inside_their_bar(tune, request):
    for bar in request.getfixturevalue(tune).bars:
        for note in bar.melody:
            assert 0.0 <= note.onset < 4.0
            assert note.duration > 0.0
            assert note.onset + note.duration <= 4.0 + 1e-9


# --- Ievan Polkka: two chords per bar ---


def test_ievan_polkka_has_24_bars_at_110_quarter_notes_per_minute(ievan_polkka):
    assert len(ievan_polkka.bars) == 24
    assert ievan_polkka.tempo_bpm == 110.0
    assert ievan_polkka.key == "e- minor"


def test_ievan_polkka_first_bar_changes_chord_on_beat_three(ievan_polkka):
    first_bar = ievan_polkka.bars[0]

    assert chords_of(first_bar) == [("Ebm", 0.0, 2.0), ("Bbm", 2.0, 2.0)]
    assert first_bar.chords[0].tones == (3, 6, 10)


# --- Chord in effect ---


def test_a_bar_without_a_chord_symbol_keeps_the_last_chord_of_the_previous_bar():
    sheet = read_lead_sheet_text(abc('"C"CD "G"EF|GABc|'))

    assert chords_of(sheet.bars[1]) == [("G", 0.0, 4.0)]


def test_a_bar_that_changes_chord_mid_bar_starts_with_the_carried_chord():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GA "F"Bc|'))

    assert chords_of(sheet.bars[1]) == [("C", 0.0, 2.0), ("F", 2.0, 2.0)]


def test_before_the_first_chord_symbol_the_first_symbol_applies():
    sheet = read_lead_sheet_text(abc('CDEF|GA "Dm"Bc|'))

    assert chords_of(sheet.bars[0]) == [("Dm", 0.0, 4.0)]
    assert chords_of(sheet.bars[1]) == [("Dm", 0.0, 2.0), ("Dm", 2.0, 2.0)]


def test_text_annotations_in_quotes_are_not_chord_symbols():
    sheet = read_lead_sheet_text(abc('"C"CDEF|"^Fine"GABc|'))

    assert chords_of(sheet.bars[1]) == [("C", 0.0, 4.0)]


# --- Melody ---


def test_a_chord_in_the_melody_keeps_its_highest_note():
    sheet = read_lead_sheet_text(abc('"C"[CEG]DEF|GABc|'))

    assert melody_of(sheet.bars[0])[0] == (67, 0.0, 1.0)


def test_grace_notes_are_dropped_from_the_melody():
    sheet = read_lead_sheet_text(abc('"C"C{d}DEF|GABc|'))

    assert [note.pitch for note in sheet.bars[0].melody] == [60, 62, 64, 65]


def test_a_tie_inside_a_bar_joins_the_tied_notes_into_one_note():
    sheet = read_lead_sheet_text(abc('"C"CD-DE|GABc|'))

    assert melody_of(sheet.bars[0]) == [(60, 0.0, 1.0), (62, 1.0, 2.0), (64, 3.0, 1.0)]


def test_a_chain_of_ties_inside_a_bar_is_one_note():
    sheet = read_lead_sheet_text(abc('"C"C-C-C D|GABc|'))

    assert melody_of(sheet.bars[0]) == [(60, 0.0, 3.0), (62, 3.0, 1.0)]


def test_a_chord_symbol_on_a_tied_note_changes_the_chord_but_not_the_note():
    sheet = read_lead_sheet_text(abc('"C"C D- "G"D E|GABc|'))

    assert melody_of(sheet.bars[0]) == [(60, 0.0, 1.0), (62, 1.0, 2.0), (64, 3.0, 1.0)]
    assert chords_of(sheet.bars[0]) == [("C", 0.0, 2.0), ("G", 2.0, 2.0)]


def test_a_tie_across_a_bar_line_leaves_one_note_in_each_bar():
    # Every bar holds only its own notes, as when a MIDI song is cut at its bar lines.
    sheet = read_lead_sheet_text(abc('"C"CDEF-|FGAB|'))

    assert melody_of(sheet.bars[0])[-1] == (65, 3.0, 1.0)
    assert melody_of(sheet.bars[1])[0] == (65, 0.0, 1.0)


def test_rests_leave_no_melody_note():
    sheet = read_lead_sheet_text(abc('"C"z2 E2|z4|'))

    assert melody_of(sheet.bars[0]) == [(64, 2.0, 2.0)]
    assert sheet.bars[1].melody == ()


# --- Form: labels, roles and phrases ---


def test_bars_before_any_part_label_get_an_empty_label():
    sheet = read_lead_sheet_text(abc('"C"CDEF|\nP:A\nGABc|'))

    assert [bar.label for bar in sheet.bars] == ["", "A"]


def test_a_label_containing_chorus_in_any_case_is_a_chorus():
    sheet = read_lead_sheet_text(abc('P:Verse 1\n"C"CDEF|\nP:CHORUS\nGABc|'))

    assert [bar.role for bar in sheet.bars] == ["verse", "chorus"]


def test_the_role_map_overrides_the_default_roles():
    body = 'P:A\n"C"CDEF|\nP:B\nGABc|\nP:C\ncBAG|'

    sheet = read_lead_sheet_text(abc(body), role_map={"A": "chorus", "B": "verse"})

    assert [bar.role for bar in sheet.bars] == ["chorus", "verse", "verse"]


def test_phrases_restart_at_each_part_label():
    body = 'P:A\n"C"CDEF|CDEF|CDEF|CDEF|CDEF|CDEF|\nP:B\nGABc|GABc|'

    sheet = read_lead_sheet_text(abc(body))

    assert [bar.phrase for bar in sheet.bars] == [0, 0, 0, 0, 1, 1, 2, 2]
    assert [bar.index for bar in sheet.bars if bar.phrase_end] == [3, 5, 7]


def test_phrase_length_sets_the_number_of_bars_per_phrase():
    sheet = read_lead_sheet(LEADSHEETS / "korobeiniki.abc", phrase_length=8)

    assert [bar.index for bar in sheet.bars if bar.phrase_end] == [7, 15, 23, 31]
    assert [bar.phrase for bar in sheet.bars] == [i // 8 for i in range(32)]


def test_bar_lines_in_comments_and_chord_symbols_do_not_count_as_bars():
    sheet = read_lead_sheet_text(abc('P:A\n"C"CDEF|GABc| % only two bars | here |'))

    assert len(sheet.bars) == 2


def test_a_double_bar_line_and_a_final_bar_line_close_one_bar_each():
    sheet = read_lead_sheet_text(abc('P:A\n"C"CDEF|GABc||cBAG|CDEF|]'))

    assert [bar.label for bar in sheet.bars] == ["A", "A", "A", "A"]


# --- Metadata ---


def test_only_the_first_tune_of_a_file_is_read():
    first = abc('"C"CDEF|GABc|')
    second = 'X:2\nT:Second tune\nM:4/4\nL:1/4\nK:C\n"G"GABc|\n'

    sheet = read_lead_sheet_text(first + "\n" + second)

    assert sheet.title == "Test tune"
    assert len(sheet.bars) == 2


def test_tempo_override_replaces_the_tempo_of_the_tune():
    sheet = read_lead_sheet(LEADSHEETS / "korobeiniki.abc", tempo_override=90)

    assert sheet.tempo_bpm == 90.0


def test_a_tune_without_tempo_plays_at_140_quarter_notes_per_minute():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GABc|'))

    assert sheet.tempo_bpm == 140.0


def test_the_tempo_is_converted_to_quarter_notes_per_minute():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GABc|', extra_header="Q:3/8=60\n"))

    assert sheet.tempo_bpm == 90.0


def test_k_none_declares_no_key_so_the_key_is_empty():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GABc|').replace("K:C", "K:none"))

    assert sheet.key == ""
    assert [note.pitch for note in sheet.bars[0].melody] == [60, 62, 64, 65]


def test_common_time_is_accepted_as_four_four():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GABc|', meter="M:C\n"))

    assert len(sheet.bars) == 2


# --- Rejected lead sheets ---


@pytest.mark.parametrize(
    "body",
    [
        '|:"C"CDEF|GABc:|',
        '"C"CDEF|GABc:|',
        '"C"CDEF::GABc|',
        '"C"CDEF|[1GABc:|[2cBAG|]',
        '"C"CDEF|1GABc:|2cBAG|]',
    ],
)
def test_repeat_signs_and_endings_are_rejected_naming_the_bar(body):
    with pytest.raises(ValueError, match="bar"):
        read_lead_sheet_text(abc(body))


def test_the_repeat_error_names_the_bar_where_the_sign_is():
    with pytest.raises(ValueError, match="bar 2"):
        read_lead_sheet_text(abc('"C"CDEF|GABc:|'))


@pytest.mark.parametrize("meter", ["11/16", "3/8", "none"])
def test_an_unsupported_meter_is_rejected_naming_the_meter_and_the_bar(meter):
    with pytest.raises(ValueError) as error:
        read_lead_sheet_text(abc('"C"CDE|', meter=f"M:{meter}\n"))

    assert str(error.value).startswith(f"bar 1: the meter {meter} is not supported")


def test_a_tune_without_a_meter_field_is_rejected():
    with pytest.raises(ValueError, match="no M: "):
        read_lead_sheet_text(abc('"C"CDEF|', meter=""))


# --- meters other than 4/4 (spec 003) -------------------------------------------------------

METER_TUNES = Path(__file__).resolve().parent / "data" / "meters"


def test_a_waltz_has_sixteen_bars_of_three_beats():
    waltz = read_lead_sheet(METER_TUNES / "waltz.abc")

    assert len(waltz.bars) == 16
    assert {str(bar.meter) for bar in waltz.bars} == {"3/4"}
    assert waltz.bars[0].chords[0].duration == 3.0
    assert sum(note.duration for note in waltz.bars[7].melody) == 3.0
    assert [bar.label for bar in waltz.bars] == ["A"] * 8 + ["B"] * 8
    assert [bar.phrase_end for bar in waltz.bars[:8]] == [False, False, False, True] * 2


def test_two_four_bars_are_read_as_two_beat_bars_not_joined_in_pairs():
    polka = read_lead_sheet(METER_TUNES / "polka.abc")

    assert len(polka.bars) == 16
    assert {bar.meter.bar_beats for bar in polka.bars} == {2.0}
    # A phrase of 4 bars lasts 8 beats.
    first_phrase = [bar for bar in polka.bars if bar.phrase == 0]
    assert sum(bar.meter.bar_beats for bar in first_phrase) == 8.0


def test_a_chord_change_inside_a_two_four_bar_splits_its_two_beats():
    polka = read_lead_sheet(METER_TUNES / "polka.abc")

    segments = [(s.symbol, s.onset, s.duration) for s in polka.bars[14].chords]

    assert segments == [("G", 0.0, 1.0), ("D7", 1.0, 1.0)]


def test_cut_time_is_read_as_two_two():
    sheet = read_lead_sheet_text(abc('"C"CDEF|GABc|', meter="M:C|\n"))

    assert {str(bar.meter) for bar in sheet.bars} == {"2/2"}


def test_inline_and_line_meter_changes_set_the_meter_of_the_following_bars():
    changes = read_lead_sheet(METER_TUNES / "changes.abc")
    body_line = read_lead_sheet_text(abc('"C"CDEF|\nM:3/4\n"G"GAB|cBA|'))

    assert [str(bar.meter) for bar in changes.bars] == [
        "4/4", "4/4", "2/4", "2/4", "3/4", "3/4", "4/4", "4/4"
    ]  # fmt: skip
    assert [str(bar.meter) for bar in body_line.bars] == ["4/4", "3/4", "3/4"]


def test_a_bar_that_does_not_fill_its_own_meter_is_rejected_naming_the_bar():
    with pytest.raises(ValueError, match=r"bar 2 lasts 2 beats instead of 3 \(3/4\)"):
        read_lead_sheet_text(abc('"C"CDE|GA|', meter="M:3/4\n"))


def test_a_pickup_is_rejected_in_any_meter():
    with pytest.raises(ValueError, match="bar 1"):
        read_lead_sheet_text(abc('C|"C"CDE|GAB|', meter="M:3/4\n"))


@pytest.mark.parametrize("name", ["jig", "slow_twelve", "five", "seven"])
def test_every_meter_test_tune_reads_with_bars_of_its_meter(name):
    sheet = read_lead_sheet(METER_TUNES / f"{name}.abc")

    for bar in sheet.bars:
        assert sum(note.duration for note in bar.melody) <= bar.meter.bar_beats
        assert sum(segment.duration for segment in bar.chords) == bar.meter.bar_beats


def test_a_pickup_bar_is_rejected_naming_bar_1():
    with pytest.raises(ValueError, match="bar 1"):
        read_lead_sheet_text(abc('C|"C"CDEF|GABc|'))


def test_an_incomplete_bar_is_rejected_naming_the_bar():
    with pytest.raises(ValueError, match="bar 2"):
        read_lead_sheet_text(abc('"C"CDEF|GAB|'))


def test_an_overfull_bar_is_rejected():
    with pytest.raises(ValueError, match="bar"):
        read_lead_sheet_text(abc('"C"CDEF|GABcd|'))


def test_a_tune_without_any_chord_symbol_is_rejected():
    with pytest.raises(ValueError, match="chord symbol"):
        read_lead_sheet_text(abc("CDEF|GABc|"))


def test_an_unknown_chord_symbol_is_rejected_naming_the_bar():
    with pytest.raises(ValueError, match="bar 2.*Xyz"):
        read_lead_sheet_text(abc('"C"CDEF|"Xyz"GABc|'))


def test_a_tune_with_fewer_than_two_plain_bar_lines_is_rejected():
    # music21 splits a tune into bars only when it finds at least two plain "|" bar lines.
    with pytest.raises(ValueError, match="at least two plain"):
        read_lead_sheet_text(abc('"C"CDEF||GABc|]'))


def test_a_phrase_length_below_one_is_rejected():
    with pytest.raises(ValueError, match="phrase_length"):
        read_lead_sheet_text(abc('"C"CDEF|'), phrase_length=0)
