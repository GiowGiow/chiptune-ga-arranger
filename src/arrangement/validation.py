"""NES rules that every arrangement must pass before export.

The realizers are built to respect the chip, but the exporter does not take that on trust: it
checks the finished arrangement against four rules and refuses to export when any one fails.

1. One note at a time: every NES channel is monophonic, so two notes of the same channel must
   not overlap.
2. Pitch range: the pulse channels (P1, P2) play MIDI 33-108 and the triangle (TR) 21-108. The
   noise channel (NO) plays drum sounds, which have no pitch range.
3. Chord tones on strong beats: a harmony (P2) or bass (TR) note that starts on beat 1 or 3 of
   a 4/4 bar belongs to the chord in effect, so the accompaniment supports the harmony where
   the ear expects it. Notes off those beats may be passing tones. P2 is exempt in bars where
   it plays the echo texture, because the echo replays the melody, passing tones included.
4. Complete bars: no note starts before the piece or rings past the end of its bar.

Each violation is a message naming the channel, the bar (counted from 1) and the broken rule,
for example "TR bar 3: pitch 40 at beat 3 is not a chord tone of Am".
"""

from arrangement.model import CHANNELS, PITCH_RANGES, Arrangement, ChannelNote
from ga.genome import P2 as P2_GENE_COLUMN
from ga.genome import P2_TEXTURES
from leadsheet.model import LeadSheet

BEATS_PER_BAR = 4

# Onsets closer than this are the same instant: it absorbs float noise in sums of durations.
TOLERANCE = 1e-9

# Beats 1 and 3, as onsets in beats from the bar start.
STRONG_BEAT_OFFSETS = (0.0, 2.0)

ECHO = P2_TEXTURES.index("echo")


def _bar_position(note: ChannelNote) -> tuple[int, float]:
    """The bar index (from 0) of a note and its onset in beats from that bar's start."""
    bar_index = int(note.onset // BEATS_PER_BAR)
    return bar_index, note.onset - BEATS_PER_BAR * bar_index


def _where(channel: str, note: ChannelNote) -> tuple[str, str]:
    """The message prefix "TR bar 3" and the beat label "3" (both counted from 1) of a note."""
    bar_index, offset = _bar_position(note)
    return f"{channel} bar {bar_index + 1}", f"{offset + 1:g}"


def _overlaps(channel: str, notes: list[ChannelNote]) -> list[str]:
    violations = []
    for note, next_note in zip(notes, notes[1:], strict=False):
        if note.onset + note.duration > next_note.onset + TOLERANCE:
            prefix, beat = _where(channel, note)
            violations.append(f"{prefix}: the note at beat {beat} overlaps the next note")
    return violations


def _out_of_range(channel: str, notes: list[ChannelNote]) -> list[str]:
    if channel not in PITCH_RANGES:
        return []
    low, high = PITCH_RANGES[channel]
    violations = []
    for note in notes:
        if not low <= note.pitch <= high:
            prefix, beat = _where(channel, note)
            violations.append(
                f"{prefix}: pitch {note.pitch} at beat {beat} is outside the range {low}-{high}"
            )
    return violations


def _non_chord_tones_on_strong_beats(
    channel: str, notes: list[ChannelNote], arrangement: Arrangement, lead_sheet: LeadSheet
) -> list[str]:
    if channel not in ("P2", "TR"):
        return []
    violations = []
    for note in notes:
        bar_index, offset = _bar_position(note)
        if not 0 <= bar_index < len(lead_sheet.bars):
            continue  # a note outside the lead sheet has no chord to compare with
        if not any(abs(offset - strong) < TOLERANCE for strong in STRONG_BEAT_OFFSETS):
            continue
        if channel == "P2" and arrangement.genome[bar_index][P2_GENE_COLUMN] == ECHO:
            continue
        chord = lead_sheet.bars[bar_index].chord_at(offset)
        if note.pitch % 12 not in chord.tones:
            prefix, beat = _where(channel, note)
            violations.append(
                f"{prefix}: pitch {note.pitch} at beat {beat} is not a chord tone of {chord.symbol}"
            )
    return violations


def _incomplete_bars(channel: str, notes: list[ChannelNote]) -> list[str]:
    violations = []
    for note in notes:
        if note.onset < 0:
            violations.append(
                f"{channel} bar 1: the note at onset {note.onset:g} starts before the piece"
            )
            continue
        _, offset = _bar_position(note)
        if offset + note.duration > BEATS_PER_BAR + TOLERANCE:
            prefix, beat = _where(channel, note)
            violations.append(f"{prefix}: the note at beat {beat} crosses the bar end")
    return violations


def find_violations(arrangement: Arrangement, lead_sheet: LeadSheet) -> list[str]:
    """List every NES rule the arrangement breaks; an empty list means it can be exported.

    Note onsets in the arrangement are in beats from the start of the piece. Messages come in
    channel order (P1, P2, TR, NO), then rule order, then time order.

    >>> from leadsheet.model import Bar, ChordSegment
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
    >>> sheet = LeadSheet("Tune", "C major", 120.0, (Bar(0, (), (c,), "A", "verse", 0, True),))
    >>> bass = (ChannelNote(36, 0.0, 2.0, 90), ChannelNote(38, 2.0, 2.0, 90))
    >>> bass_only = Arrangement("Tune", 120.0, ((0, 0, 0, 0),), {"TR": bass})
    >>> find_violations(bass_only, sheet)
    ['TR bar 1: pitch 38 at beat 3 is not a chord tone of C']
    """
    violations = []
    for channel in CHANNELS:
        notes = sorted(arrangement.channels.get(channel, ()), key=lambda note: note.onset)
        violations += _overlaps(channel, notes)
        violations += _out_of_range(channel, notes)
        violations += _non_chord_tones_on_strong_beats(channel, notes, arrangement, lead_sheet)
        violations += _incomplete_bars(channel, notes)
    return violations
