"""Plain data types for a lead sheet.

A lead sheet holds what an arranger starts from: the melody, the chord in effect at every moment,
and the form (which bars belong to the verse or the chorus, and where each phrase ends). Every
time value is measured in quarter-note beats from the start of the bar, and every pitch is a MIDI
number (60 is middle C). The meter is always 4/4, so a bar spans the beats [0, 4).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class MelodyNote:
    """One melody note inside a bar.

    Attributes:
        pitch: MIDI pitch number (0-127).
        onset: start, in beats from the start of the bar (0 <= onset < 4).
        duration: length in beats (> 0, and onset + duration <= 4).
    """

    pitch: int
    onset: float
    duration: float


@dataclass(frozen=True)
class ChordSegment:
    """The stretch of a bar during which one chord symbol is in effect.

    Attributes:
        symbol: chord symbol as written in the lead sheet, for example "Ebm" or "Bbm7".
        root: pitch class of the chord root (0 = C, 1 = C#/Db, ..., 11 = B).
        tones: pitch classes of the chord, ordered root, third, fifth and the seventh when present.
        onset: start, in beats from the start of the bar.
        duration: length in beats.
    """

    symbol: str
    root: int
    tones: tuple[int, ...]
    onset: float
    duration: float


@dataclass(frozen=True)
class Bar:
    """One 4/4 bar of the lead sheet, with its place in the form.

    Attributes:
        index: position of the bar in the piece, starting at 0.
        melody: melody notes of the bar, in time order.
        chords: chord segments that cover the bar [0, 4) without gaps.
        label: part label from the lead sheet, for example "A" or "B".
        role: "verse" or "chorus", derived from the label.
        phrase: index of the phrase that contains the bar (phrases are counted over the piece).
        phrase_end: True when the bar is the last bar of its phrase.
    """

    index: int
    melody: tuple[MelodyNote, ...]
    chords: tuple[ChordSegment, ...]
    label: str
    role: str
    phrase: int
    phrase_end: bool

    def chord_at(self, onset: float) -> ChordSegment:
        """Return the chord segment in effect at `onset` (beats from the bar start).

        >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 2.0)
        >>> g = ChordSegment("G", 7, (7, 11, 2), 2.0, 2.0)
        >>> bar = Bar(0, (), (c, g), "A", "verse", 0, False)
        >>> bar.chord_at(0.0).symbol, bar.chord_at(1.75).symbol, bar.chord_at(2.0).symbol
        ('C', 'C', 'G')
        """
        for segment in reversed(self.chords):
            if segment.onset <= onset + 1e-9:
                return segment
        return self.chords[0]


@dataclass(frozen=True)
class LeadSheet:
    """A whole lead sheet: metadata and the bars in performed order.

    Attributes:
        title: tune title.
        key: key name, for example "e- minor".
        tempo_bpm: tempo in quarter notes per minute.
        bars: the bars, in performed order.
        beats_per_bar: always 4 (only 4/4 is supported).
        source_grid: for a lead sheet reduced from a MIDI recording, (tempo in BPM, time in
            seconds of the first downbeat) of the beat grid found in the recording; None for ABC.
    """

    title: str
    key: str
    tempo_bpm: float
    bars: tuple[Bar, ...]
    beats_per_bar: int = 4
    source_grid: tuple[float, float] | None = None
