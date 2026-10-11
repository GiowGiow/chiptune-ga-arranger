"""Read a lead sheet written in ABC notation.

ABC is a plain-text music notation: a header of `field:value` lines (T: title, M: meter, Q: tempo,
K: key) followed by the tune body, where letters are notes, `|` are bar lines and quoted strings
such as "Am" are chord symbols. A `P:` line in the body marks where a part (verse, chorus) starts.

music21 parses the notes, chord symbols, meter, key and tempo. It drops the `P:` field and
silently skips chord symbols it cannot parse, so this module also scans the ABC text itself, bar
line by bar line, to read the part labels and to check every chord symbol.

The arranger works bar by bar in 4/4, in the order the bars are played. So the reader rejects any
other meter, pickups and incomplete bars, and repeat signs (a repeat must be written out in full).
"""

import re
from dataclasses import dataclass
from itertools import groupby
from pathlib import Path

from music21 import converter, harmony, key, meter, stream, tempo

from leadsheet.chords import chord_tones
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

BEATS_PER_BAR = 4
DEFAULT_TEMPO_BPM = 140.0

# In ABC, a quoted string that starts with one of these characters is a text annotation placed
# above, below or beside the staff, not a chord symbol.
ANNOTATION_PREFIXES = ("^", "_", "<", ">", "@")

# Repeat signs and first/second endings. "|1" and "|2" are the short form of "[1" and "[2".
REPEAT_SIGNS = ("|:", ":|", "::", "[1", "[2", "|1", "|2")

# One token of a body line: a comment (which ends the line), a quoted string, a repeat sign or a
# bar line. "||" and "|]" are matched whole, so each closes one bar. Quoted strings are matched
# before bar lines so that a "|" inside quotes is never taken for a bar line.
BODY_TOKEN = re.compile(r'%.*|"[^"]*"|\|:|:\||::|\[[12]|\|[12]|\|[|\]]?')

# A header-style field inside the body, such as "w:" (lyrics) or "N:" (notes). It holds no bars.
FIELD_LINE = re.compile(r"^[A-Za-z+]:")


@dataclass(frozen=True)
class _ScannedBar:
    """What the ABC text says about one bar: its part label and the section it belongs to."""

    label: str
    section: int


def read_lead_sheet(
    path: str | Path,
    phrase_length: int = 4,
    role_map: dict[str, str] | None = None,
    tempo_override: float | None = None,
) -> LeadSheet:
    """Read the first tune of an ABC file into a lead sheet.

    See `read_lead_sheet_text` for the arguments and the rejected cases.
    """
    text = Path(path).read_text(encoding="utf-8")
    return read_lead_sheet_text(text, phrase_length, role_map, tempo_override)


def read_lead_sheet_text(
    text: str,
    phrase_length: int = 4,
    role_map: dict[str, str] | None = None,
    tempo_override: float | None = None,
) -> LeadSheet:
    """Read the first tune of an ABC text into a lead sheet.

    Args:
        text: ABC notation. Only the first tune (up to the second "X:" line) is read.
        phrase_length: number of bars per phrase, counted from the start of each part.
        role_map: part label -> "verse" or "chorus". Labels it does not list fall back to the
            default: a label that contains "chorus" (any case) or equals "B" is a chorus, every
            other label is a verse.
        tempo_override: tempo in quarter notes per minute that replaces the tune's own Q: field.

    Returns:
        The lead sheet, with one `Bar` per bar of the tune.

    Raises:
        ValueError: for a repeat sign, a meter other than 4/4, a pickup or incomplete bar, a tune
            without chord symbols or with an unknown one. The message names the bar when it can.

    >>> sheet = read_lead_sheet_text('X:1\\nT:Scale\\nM:4/4\\nL:1/4\\nK:C\\n"C"CDEF|"G7"GABc|')
    >>> [bar.chords[0].symbol for bar in sheet.bars], sheet.bars[1].melody[0].pitch
    (['C', 'G7'], 67)
    """
    if phrase_length < 1:
        raise ValueError(f"phrase_length must be at least 1, got {phrase_length}")
    tune = _first_tune(text)
    scanned_bars = _scan_body(tune)

    score = converter.parse(tune, format="abc")
    _check_meter(score)
    # music21 numbers the first measure 0 (or 1), so measures are matched by position, not number.
    measures = list(score.parts[0].getElementsByClass(stream.Measure))
    if not measures:
        raise ValueError(
            "music21 splits a tune into bars only when it has at least two plain '|' bar lines"
        )
    if len(measures) != len(scanned_bars):
        raise ValueError(
            f"music21 found {len(measures)} bars but the bar lines of the text close "
            f"{len(scanned_bars)}; check for an overfull bar (music21 splits it in two) or a "
            "missing final bar line"
        )
    _check_complete_bars(measures)

    chords_per_bar = _chord_segments([_chord_changes(measure) for measure in measures])
    marks = phrase_marks([bar.section for bar in scanned_bars], phrase_length)
    bars = []
    for index, measure in enumerate(measures):
        label = scanned_bars[index].label
        phrase, phrase_end = marks[index]
        bars.append(
            Bar(
                index=index,
                melody=_melody(measure),
                chords=chords_per_bar[index],
                label=label,
                role=section_role(label, role_map),
                phrase=phrase,
                phrase_end=phrase_end,
            )
        )
    return LeadSheet(
        title=score.metadata.title or "",
        key=_key_name(score),
        tempo_bpm=_tempo_bpm(score, tempo_override),
        bars=tuple(bars),
    )


def _first_tune(text: str) -> str:
    """Keep only the first tune of an ABC text (every tune starts with an "X:" line).

    >>> two_tunes = "X:1\\nT:One\\nK:C\\nC4|\\nX:2\\nT:Two\\nK:C\\nD4|"
    >>> _first_tune(two_tunes).splitlines()
    ['X:1', 'T:One', 'K:C', 'C4|']
    """
    lines = text.splitlines()
    tune_starts = [number for number, line in enumerate(lines) if line.startswith("X:")]
    if len(tune_starts) > 1:
        lines = lines[: tune_starts[1]]
    return "\n".join(lines)


def _scan_body(tune: str) -> list[_ScannedBar]:
    """Read from the ABC text what music21 does not report: part labels and section starts.

    The body starts after the K: line. Each "P:" line starts a new section with its label, and
    each bar line closes one bar. The scan also rejects repeat signs and checks every chord
    symbol, because music21 would expand the first and silently drop an unknown second.

    >>> bars = _scan_body('X:1\\nK:C\\n"C"CDEF|\\nP:A\\nGABc|"F"cBAG||\\nP:B\\nC4|]')
    >>> [(bar.label, bar.section) for bar in bars]
    [('', 0), ('A', 1), ('A', 1), ('B', 2)]
    """
    lines = tune.splitlines()
    key_line = next((n for n, line in enumerate(lines) if line.startswith("K:")), None)
    if key_line is None:
        raise ValueError("the tune has no K: (key) line, so its body cannot be found")

    label, section = "", 0
    bars: list[_ScannedBar] = []
    for line in lines[key_line + 1 :]:
        if line.startswith("P:"):
            label, section = line[2:].strip(), section + 1
            continue
        if FIELD_LINE.match(line):
            continue
        for token in BODY_TOKEN.findall(line):
            bar_number = len(bars) + 1  # the bar being read, counted from 1 as musicians do
            if token.startswith("%"):
                break
            if token.startswith('"'):
                _check_chord_symbol(token.strip('"'), bar_number)
            elif token in REPEAT_SIGNS:
                raise ValueError(
                    f"bar {bar_number}: repeat sign or ending {token!r} is not supported; "
                    "write the repeated bars out in full"
                )
            else:
                bars.append(_ScannedBar(label, section))
    return bars


def _check_chord_symbol(quoted_text: str, bar_number: int) -> None:
    """Raise ValueError, naming the bar, when a quoted chord symbol is not a known chord."""
    if quoted_text.startswith(ANNOTATION_PREFIXES):
        return
    try:
        chord_tones(quoted_text.strip())
    except ValueError as error:
        raise ValueError(f"bar {bar_number}: {error}") from None


def _check_meter(score: stream.Score) -> None:
    """Raise ValueError unless the tune declares a 4/4 meter (M:4/4 or M:C)."""
    time_signature = score.recurse().getElementsByClass(meter.TimeSignature).first()
    if time_signature is None:
        raise ValueError("the tune has no M: (meter) field; only 4/4 is supported")
    if time_signature.ratioString != "4/4":
        raise ValueError(f"only 4/4 meter is supported, not {time_signature.ratioString}")


def _check_complete_bars(measures: list[stream.Measure]) -> None:
    """Raise ValueError, naming the bar, when a bar does not last exactly 4 beats."""
    for index, measure in enumerate(measures):
        beats = float(measure.duration.quarterLength)
        if beats != BEATS_PER_BAR:
            raise ValueError(
                f"bar {index + 1} lasts {beats:g} beats instead of {BEATS_PER_BAR}; "
                "pickups and incomplete bars are not supported"
            )


def _melody(measure: stream.Measure) -> tuple[MelodyNote, ...]:
    """Return the melody notes of one bar, with onsets measured from the bar start."""
    notes = []
    for element in measure.flatten().notes:
        # Chord symbols are harmony, not melody; grace notes take no time of their own.
        if isinstance(element, harmony.ChordSymbol) or element.duration.isGrace:
            continue
        # When the melody plays several notes at once, the top note carries the tune.
        pitch = max(p.midi for p in element.pitches)
        notes.append(
            MelodyNote(pitch, float(element.offset), float(element.duration.quarterLength))
        )
    return tuple(notes)


def _chord_changes(measure: stream.Measure) -> list[tuple[float, str]]:
    """Return (onset, symbol) for each chord symbol written in one bar."""
    return [
        # music21 writes flats as "-" (E-m); the lead sheet writes them as "b" (Ebm).
        (float(chord_symbol.offset), chord_symbol.figure.replace("-", "b"))
        for chord_symbol in measure.flatten().getElementsByClass(harmony.ChordSymbol)
    ]


def _chord_segments(
    changes_per_bar: list[list[tuple[float, str]]],
) -> list[tuple[ChordSegment, ...]]:
    """Turn the chord changes of each bar into segments that cover the whole bar.

    A chord stays in effect until the next chord symbol, across bar lines. Before the first
    chord symbol of the piece no chord is in effect yet, so the first symbol fills that gap.

    >>> segments = _chord_segments([[(2.0, "C")], [], [(0.0, "F"), (3.0, "G")]])
    >>> [[(s.symbol, s.onset, s.duration) for s in bar] for bar in segments]
    [[('C', 0.0, 2.0), ('C', 2.0, 2.0)], [('C', 0.0, 4.0)], [('F', 0.0, 3.0), ('G', 3.0, 1.0)]]
    """
    written = [symbol for changes in changes_per_bar for _, symbol in changes]
    if not written:
        raise ValueError("the tune has no chord symbol; a lead sheet needs at least one")

    in_effect = written[0]
    segments_per_bar = []
    for changes in changes_per_bar:
        # The bar starts with the chord carried over; a symbol on beat 0 replaces it.
        starts = {0.0: in_effect, **dict(changes)}
        onsets = sorted(starts)
        ends = [*onsets[1:], float(BEATS_PER_BAR)]
        segments = []
        for onset, end in zip(onsets, ends, strict=True):
            root, tones = chord_tones(starts[onset])
            segments.append(ChordSegment(starts[onset], root, tones, onset, end - onset))
        segments_per_bar.append(tuple(segments))
        in_effect = starts[onsets[-1]]
    return segments_per_bar


def phrase_marks(sections: list[int], phrase_length: int) -> list[tuple[int, bool]]:
    """Give each bar its phrase index and whether it is the last bar of its phrase.

    Phrases are chunks of `phrase_length` bars counted from the start of each section, so a
    section of 6 bars with 4-bar phrases holds one 4-bar phrase and one 2-bar phrase. Phrase
    indices count over the whole piece.

    >>> phrase_marks([1, 1, 1, 1, 1, 1, 2, 2], phrase_length=4)
    [(0, False), (0, False), (0, False), (0, True), (1, False), (1, True), (2, False), (2, True)]
    """
    marks: list[tuple[int, bool]] = []
    first_phrase = 0
    for _, section_bars in groupby(sections):
        section_size = len(list(section_bars))
        for position in range(section_size):
            phrase = first_phrase + position // phrase_length
            ends_phrase = (position + 1) % phrase_length == 0 or position + 1 == section_size
            marks.append((phrase, ends_phrase))
        first_phrase = marks[-1][0] + 1
    return marks


def section_role(label: str, role_map: dict[str, str] | None) -> str:
    """Return "verse" or "chorus" for a part label.

    >>> [section_role(label, None) for label in ("B", "Chorus 2", "A")]
    ['chorus', 'chorus', 'verse']
    >>> section_role("A", {"A": "chorus"})
    'chorus'
    """
    if role_map is not None and label in role_map:
        return role_map[label]
    # In a two-part tune (A B), the B part usually plays the role of the chorus.
    return "chorus" if "chorus" in label.lower() or label == "B" else "verse"


def _key_name(score: stream.Score) -> str:
    """Return the key of the tune in music21's spelling, for example "e- minor" or "C major"."""
    tune_key = score.recurse().getElementsByClass(key.Key).first()
    if tune_key is None:
        return ""
    return f"{tune_key.tonicPitchNameWithCase} {tune_key.mode}"


def _tempo_bpm(score: stream.Score, tempo_override: float | None) -> float:
    """Return the tempo in quarter notes per minute: the override, the Q: field or 140."""
    if tempo_override is not None:
        return float(tempo_override)
    mark = score.recurse().getElementsByClass(tempo.MetronomeMark).first()
    if mark is None or mark.getQuarterBPM() is None:
        return DEFAULT_TEMPO_BPM
    # The unit conversion leaves float noise, such as 110.00000000000001 for Q:1/4=110.
    return round(mark.getQuarterBPM(), 6)
