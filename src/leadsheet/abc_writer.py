"""Write a lead sheet in ABC notation, so that the ABC reader reads back the same lead sheet.

A MIDI song reduced to a lead sheet (see `midi_reader`) exists only in memory, and the MIDI file it
comes from belongs to someone else. Written as ABC, the reduction becomes a small text file that
the project can commit and a person can read and correct, and that `abc_reader` turns back into
the very same lead sheet. Each choice below keeps that round trip exact:

- Lengths: the unit note length is a sixteenth (`L:1/16`), so "C4" is a quarter note and every
  onset and duration on the sixteenth-note grid is a whole number of units. Rests (`z`) fill the
  silence between notes.
- Meter: `M:` gives the first bar's meter, and a bar whose meter differs from the bar before it
  starts with an inline field such as `[M:3/4]`, which both readers follow.
- Chords: a chord symbol is written just before the note or rest that starts with the chord. When
  the chord changes while a note sounds, the note is written as two tied pieces (`G4- "G"G4`),
  which the reader joins back into one note.
- Accidentals: the key signature (`K:`) sharpens or flattens some letters. ABC 2.1 says that an
  accidental lasts until the bar line; older ABC applies it to one note only. The writer marks a
  note whenever the key signature does not give its pitch, and marks again every later note of the
  same letter in the bar, so both readings give the same pitches.
- Key: a MIDI song has no key (""), so its lead sheet is written with `K:none`.
- Tempo: `Q:` keeps 6 decimals, the precision the reader keeps after removing music21's float
  noise.
- Form: a `P:` line starts a part, and phrases restart at each part. The writer writes a `P:` line
  where the label changes and where a phrase starts that counting `phrase_length` bars from the
  part start would not start. Each phrase goes on its own line.
"""

from collections.abc import Sequence
from itertools import accumulate

from music21 import key

from leadsheet.abc_reader import phrase_marks
from leadsheet.meter import FOUR_FOUR
from leadsheet.model import Bar, LeadSheet

UNITS_PER_BEAT = 4  # L:1/16: a sixteenth note is the unit, four to a quarter-note beat
TEMPO_DECIMALS = 6
LETTER_PITCH_CLASSES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACCIDENTAL_SIGNS = {-2: "__", -1: "_", 0: "=", 1: "^", 2: "^^"}
# With no sharps or flats in the key, black keys are spelled as in chord symbols: Db Eb F# Ab Bb.
PLAIN_KEY_SPELLING = {1: ("D", -1), 3: ("E", -1), 6: ("F", 1), 8: ("A", -1), 10: ("B", -1)}
# How ABC writes, after the tonic, each mode that music21 reports (K:Ebm, K:Ddor).
ABC_MODES = {
    "major": "",
    "minor": "m",
    "ionian": "Ion",
    "aeolian": "Aeo",
    "dorian": "Dor",
    "phrygian": "Phr",
    "lydian": "Lyd",
    "mixolydian": "Mix",
    "locrian": "Loc",
}


def lead_sheet_to_abc(
    lead_sheet: LeadSheet, phrase_length: int = 4, comments: Sequence[str] = ()
) -> str:
    """Return the lead sheet as an ABC tune that `read_lead_sheet_text` reads back unchanged.

    The reader gives back the same bars, melody, chords, labels, phrases and roles when it is
    called with the same `phrase_length` and role map; the tempo comes back rounded to 6 decimals
    and `source_grid` comes back as None.

    Args:
        lead_sheet: the lead sheet to write (melody and chords on the sixteenth-note grid).
        phrase_length: bars per phrase that the reader will use.
        comments: lines written as `%` comments at the top of the file (for the provenance).

    Raises:
        ValueError: for a lead sheet ABC cannot hold: a note off the sixteenth-note grid,
            overlapping melody notes, chords that leave a gap, or phrases that `phrase_length`
            cannot reproduce. The message names the bar when it can.

    >>> from leadsheet.model import ChordSegment, MelodyNote
    >>> c = ChordSegment("C", 0, (0, 4, 7), onset=0.0, duration=2.0)
    >>> g = ChordSegment("G", 7, (7, 11, 2), onset=2.0, duration=2.0)
    >>> melody = (MelodyNote(60, onset=0.0, duration=1.0), MelodyNote(66, onset=1.0, duration=3.0))
    >>> one_bar = (Bar(0, melody, (c, g), "A", "verse", phrase=0, phrase_end=True),)
    >>> print(lead_sheet_to_abc(LeadSheet("Demo", "C major", 120.0, one_bar)), end="")
    %abc-2.1
    X:1
    T:Demo
    M:4/4
    L:1/16
    Q:1/4=120
    K:C
    P:A
    "C"C4 ^F4- "G"^F8 |
    """
    key_field, signature, sharps = _key(lead_sheet.key)
    bars = lead_sheet.bars
    first_meter = bars[0].meter if bars else FOUR_FOUR
    lines = ["%abc-2.1", *(f"% {line}".rstrip() for line in comments)]
    lines += ["X:1", f"T:{lead_sheet.title}", f"M:{first_meter}", "L:1/16"]
    lines.append(f"Q:1/4={_tempo_text(lead_sheet.tempo_bpm)}")
    if round(lead_sheet.tempo_bpm, TEMPO_DECIMALS) != lead_sheet.tempo_bpm:
        lines.append(
            f"% Exact tempo {lead_sheet.tempo_bpm!r} quarter notes per minute; "
            f"Q: keeps {TEMPO_DECIMALS} decimals."
        )
    lines.append(f"K:{key_field}")

    phrase_line: list[str] = []
    for index, starts_part in enumerate(_part_starts(bars, phrase_length)):
        new_phrase = index == 0 or starts_part or bars[index].phrase != bars[index - 1].phrase
        if new_phrase and phrase_line:
            lines.append(" | ".join(phrase_line) + " |")
            phrase_line = []
        # Bars before the first P: line have the empty label, so they need no P: line.
        if starts_part and (index > 0 or bars[index].label):
            lines.append(f"P:{bars[index].label}")
        meter_change = index > 0 and bars[index].meter != bars[index - 1].meter
        inline_meter = f"[M:{bars[index].meter}]" if meter_change else ""
        phrase_line.append(inline_meter + _bar_text(bars[index], signature, sharps))
    if phrase_line:
        lines.append(" | ".join(phrase_line) + " |")
    return "\n".join(lines) + "\n"


def _key(key_name: str) -> tuple[str, dict[str, int], int]:
    """Return the K: value, the key signature (letter -> alteration) and the number of sharps.

    >>> _key("e- minor")
    ('Ebm', {'B': -1, 'E': -1, 'A': -1, 'D': -1, 'G': -1, 'C': -1}, -6)
    >>> _key("")
    ('none', {}, 0)
    """
    if not key_name:
        return "none", {}, 0
    tonic, _, mode = key_name.partition(" ")
    if mode not in ABC_MODES:
        raise ValueError(f"cannot write the key {key_name!r} in ABC")
    music21_key = key.Key(tonic, mode)
    signature = {p.step: int(p.accidental.alter) for p in music21_key.alteredPitches}
    abc_tonic = tonic[0].upper() + tonic[1:].replace("-", "b")
    return abc_tonic + ABC_MODES[mode], signature, music21_key.sharps


def _tempo_text(tempo_bpm: float) -> str:
    """Write a tempo with at most 6 decimals and no trailing zeros.

    >>> _tempo_text(120.0), _tempo_text(110.09999999999715), _tempo_text(132.50005520835634)
    ('120', '110.1', '132.500055')
    """
    return f"{round(tempo_bpm, TEMPO_DECIMALS):.{TEMPO_DECIMALS}f}".rstrip("0").rstrip(".")


def _part_starts(bars: Sequence[Bar], phrase_length: int) -> list[bool]:
    """Mark the bars where a `P:` line must start a part so the reader finds the same phrases."""
    starts, position = [], 0
    for index, bar in enumerate(bars):
        if index == 0:
            starts_part = True
        else:
            position += 1
            previous = bars[index - 1]
            # Counting from the part start, the reader begins a phrase every phrase_length bars;
            # a phrase that starts anywhere else needs a part of its own.
            unexpected_phrase = bar.phrase != previous.phrase and position % phrase_length != 0
            starts_part = bar.label != previous.label or unexpected_phrase
        if starts_part:
            position = 0
        starts.append(starts_part)
    sections = list(accumulate(int(starts_part) for starts_part in starts))
    if phrase_marks(sections, phrase_length) != [(bar.phrase, bar.phrase_end) for bar in bars]:
        raise ValueError(
            f"the phrases of this lead sheet cannot be written for phrase_length={phrase_length}: "
            "a phrase is longer than phrase_length bars or a phrase end does not match"
        )
    return starts


def _units(beats: float, bar: Bar, what: str) -> int:
    """Convert beats to sixteenth-note units, refusing values off the sixteenth-note grid."""
    units = round(beats * UNITS_PER_BEAT)
    if abs(beats * UNITS_PER_BEAT - units) > 1e-6:
        raise ValueError(f"bar {bar.index + 1}: {what} {beats:g} is off the sixteenth-note grid")
    return units


def _bar_text(bar: Bar, signature: dict[str, int], sharps: int) -> str:
    """Write one bar: chord symbols, notes, tied pieces and rests, separated by spaces."""
    chord_starts = _chord_starts(bar)
    bar_units = round(bar.meter.bar_beats * UNITS_PER_BEAT)
    # Pieces of time in sixteenth units: (start, end, MIDI pitch or None for a rest).
    pieces: list[tuple[int, int, int | None]] = []
    position = 0
    for note in bar.melody:
        start = _units(note.onset, bar, "onset")
        end = _units(note.onset + note.duration, bar, "note end")
        if start < position or end <= start or end > bar_units:
            raise ValueError(
                f"bar {bar.index + 1}: melody notes overlap or leave the bar; an ABC lead sheet "
                "holds one note at a time, inside its bar"
            )
        if start > position:
            pieces.append((position, start, None))
        pieces.append((start, end, note.pitch))
        position = end
    if position < bar_units:
        pieces.append((position, bar_units, None))

    tokens, marked_letters = [], set()
    for start, end, pitch in pieces:
        cuts = [start, *sorted(c for c in chord_starts if start < c < end), end]
        for piece_start, piece_end in zip(cuts, cuts[1:], strict=False):
            chord_text = f'"{chord_starts[piece_start]}"' if piece_start in chord_starts else ""
            if pitch is None:
                name = "z"
            else:
                letter, alteration, octave = _spell(pitch, signature, sharps)
                # Once a letter is marked in this bar, every later note of it is marked too.
                marked = letter in marked_letters or alteration != signature.get(letter, 0)
                if marked:
                    marked_letters.add(letter)
                name = _note_name(letter, alteration, octave, marked)
            length = piece_end - piece_start
            tie = "-" if pitch is not None and piece_end < end else ""
            tokens.append(f"{chord_text}{name}{length if length > 1 else ''}{tie}")
    return " ".join(tokens)


def _chord_starts(bar: Bar) -> dict[int, str]:
    """Return {start in sixteenth units: chord symbol}, checking the chords cover the bar."""
    starts, position = {}, 0
    for segment in bar.chords:
        start = _units(segment.onset, bar, "chord onset")
        if start != position:
            break
        starts[start] = segment.symbol
        position = _units(segment.onset + segment.duration, bar, "chord end")
    if position != round(bar.meter.bar_beats * UNITS_PER_BEAT) or len(starts) != len(bar.chords):
        raise ValueError(
            f"bar {bar.index + 1}: the chord segments must cover the bar from its start to its "
            "end without gaps or overlaps"
        )
    return starts


def _spell(pitch: int, signature: dict[str, int], sharps: int) -> tuple[str, int, int]:
    """Spell a MIDI pitch as (letter, alteration, octave) in a key.

    A pitch of the key's scale takes the letter the key signature gives it; another white key is
    a natural; another black key is a sharp in a sharp key and a flat in a flat key.

    >>> _spell(66, {}, 0), _spell(71, {"B": -1, "E": -1, "A": -1, "D": -1, "G": -1, "C": -1}, -6)
    (('F', 1, 4), ('C', -1, 5))
    """
    pitch_class = pitch % 12
    for letter, natural in LETTER_PITCH_CLASSES.items():
        if (natural + signature.get(letter, 0)) % 12 == pitch_class:
            alteration = signature.get(letter, 0)
            break
    else:
        naturals = {natural: letter for letter, natural in LETTER_PITCH_CLASSES.items()}
        if pitch_class in naturals:
            letter, alteration = naturals[pitch_class], 0
        elif sharps > 0:
            letter, alteration = naturals[pitch_class - 1], 1
        elif sharps < 0:
            letter, alteration = naturals[(pitch_class + 1) % 12], -1
        else:
            letter, alteration = PLAIN_KEY_SPELLING[pitch_class]
    # The octave belongs to the letter: C-flat 5 sounds as B 4 (MIDI 71).
    octave = (pitch - alteration - LETTER_PITCH_CLASSES[letter]) // 12 - 1
    return letter, alteration, octave


def _note_name(letter: str, alteration: int, octave: int, marked: bool) -> str:
    """Write a note name in ABC: C is middle C (octave 4), c the octave above, C, and c' beyond.

    >>> _note_name("C", 0, 4, False), _note_name("F", 1, 5, True), _note_name("B", -1, 2, True)
    ('C', '^f', '_B,,')
    """
    sign = ACCIDENTAL_SIGNS[alteration] if marked else ""
    if octave >= 5:
        return sign + letter.lower() + "'" * (octave - 5)
    return sign + letter + "," * (4 - octave)
