"""Score tables: every musical fact the fitness function needs, computed once per lead sheet.

The genes of one bar take few values (5 P2 textures, 4 TR textures, 5 drum patterns, 3 melody
octaves), so every (bar, gene value) choice can be realized into notes and measured once, before
the GA starts. The fitness of a plan then only looks values up in these tables, which keeps the
thousands of fitness evaluations of a run fast and keeps the notes out of the GA loop.

Activity measures how busy a channel is in a bar: min(1, onsets / steps), where steps is the
number of sixteenth notes in the bar (16 in 4/4, 12 in 3/4), so one onset on every sixteenth note
(or more) counts as fully active, and silence as 0. Measuring each bar on its own grid keeps a 3/4
bar as busy as a 4/4 bar with the same rhythm.

The bass is measured as a *line*: the notes a listener follows as the bass melody. For most TR
textures that is every note. For the octave pump it is only the roots on the beats: the upper
octave between them is an ornament that colors the line, not a step of it, as a listener hears
"C C C C" in a C pump, not a melody that jumps an octave eight times a bar. Every leap of the
line is scored, inside a bar (`bass_inner`) and across a bar line (`bass_across`), because a
walking bar starts and ends next to the neighboring roots but can leap by more than an octave
in between.
"""

from dataclasses import dataclass

import numpy as np

from arrangement.textures import realize_no, realize_p1, realize_p2, realize_tr
from ga.genome import NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES
from leadsheet.model import LeadSheet


# eq=False: the fields are numpy arrays, whose == is element-wise and has no single truth value.
@dataclass(frozen=True, eq=False)
class ScoreTables:
    """Precomputed per-bar measurements, indexed by bar and by gene value (n = number of bars).

    Attributes:
        act_p1: (n, 3) melody activity for each octave gene.
        act_p2: (n, 5) P2 activity for each P2 texture.
        act_tr: (n, 4) TR activity for each TR texture.
        act_no: (n, 5) NO activity for each drum pattern (it depends on the bar's meter).
        reg_both: (n, 3, 5) sixteenth steps of the bar where P1 (octave gene) and P2 (texture)
            both sound.
        reg_ok: (n, 3, 5) sixteenth steps where both sound and P2 is lower than P1.
        bass_inner: (n, 4) mean leap score over consecutive notes of the bass line inside bar b
            for each TR texture; NaN when the line has a single note in the bar.
        bass_inner_leaps: (n, 4) number of those leaps (notes of the line in the bar minus 1).
        bass_across: (n - 1, 4, 4) leap score from the last note of the line of TR texture i in
            bar b to the first note of TR texture j in bar b + 1.
        single_chord: (n,) True when one chord lasts the whole bar.
        phrase_end: (n,) True when the bar ends its phrase.
        phrase: (n,) phrase id of each bar.
        is_chorus: (n,) True for chorus bars, False for verse bars.
    """

    act_p1: np.ndarray
    act_p2: np.ndarray
    act_tr: np.ndarray
    act_no: np.ndarray
    reg_both: np.ndarray
    reg_ok: np.ndarray
    bass_inner: np.ndarray
    bass_inner_leaps: np.ndarray
    bass_across: np.ndarray
    single_chord: np.ndarray
    phrase_end: np.ndarray
    phrase: np.ndarray
    is_chorus: np.ndarray


# A sixteenth note, the step of the grid on which activity and register overlaps are counted.
STEP = 0.25

OCTAVE_PUMP = TR_TEXTURES.index("octave_pump")


def build_tables(lead_sheet: LeadSheet) -> ScoreTables:
    """Realize every (bar, channel, gene value) choice once and measure it.

    >>> from leadsheet.model import Bar, ChordSegment, MelodyNote
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
    >>> bar = Bar(0, (MelodyNote(72, 0.0, 4.0),), (c,), "A", "verse", 0, True)
    >>> tables = build_tables(LeadSheet("one bar", "c major", 120.0, (bar,)))
    >>> float(tables.act_p2[0, 1]), tables.bass_across.shape
    (1.0, (0, 4, 4))
    >>> tables.bass_inner_leaps[0].tolist()  # root, octave_pump, root_fifth, walking
    [0, 3, 3, 3]
    """
    bars = lead_sheet.bars
    n = len(bars)
    act_p1 = np.zeros((n, len(P1_OCTAVES)))
    act_p2 = np.zeros((n, len(P2_TEXTURES)))
    act_tr = np.zeros((n, len(TR_TEXTURES)))
    reg_both = np.zeros((n, len(P1_OCTAVES), len(P2_TEXTURES)))
    reg_ok = np.zeros_like(reg_both)
    bass_inner = np.full((n, len(TR_TEXTURES)), np.nan)
    bass_inner_leaps = np.zeros((n, len(TR_TEXTURES)), dtype=int)
    bass_first = np.zeros((n, len(TR_TEXTURES)))
    bass_last = np.zeros((n, len(TR_TEXTURES)))
    act_no = np.zeros((n, len(NO_PATTERNS)))
    for b, bar in enumerate(bars):
        next_bar = bars[b + 1] if b + 1 < n else None
        steps = bar.meter.steps
        melody_grids = []
        for octave in range(len(P1_OCTAVES)):
            notes = realize_p1(bar, octave)
            act_p1[b, octave] = _activity(notes, steps)
            melody_grids.append(_sounding_grid(notes, steps))
        for texture in range(len(P2_TEXTURES)):
            notes = realize_p2(bar, texture)
            act_p2[b, texture] = _activity(notes, steps)
            harmony = _sounding_grid(notes, steps)
            for octave, melody in enumerate(melody_grids):
                both = (melody >= 0) & (harmony >= 0)
                reg_both[b, octave, texture] = both.sum()
                reg_ok[b, octave, texture] = (both & (harmony < melody)).sum()
        for texture in range(len(TR_TEXTURES)):
            notes = realize_tr(bar, texture, next_bar)
            act_tr[b, texture] = _activity(notes, steps)
            line = bass_line(texture, [note.pitch for note in notes])
            bass_first[b, texture], bass_last[b, texture] = line[0], line[-1]
            bass_inner_leaps[b, texture] = len(line) - 1
            if len(line) > 1:
                bass_inner[b, texture] = _leap_score(np.abs(np.diff(line))).mean()
        for pattern in range(len(NO_PATTERNS)):
            act_no[b, pattern] = _activity(realize_no(pattern, bar.meter), steps)
    # Leap from the line's last note in bar b (texture i) to its first in bar b + 1 (texture j).
    leaps = np.abs(bass_last[:-1, :, np.newaxis] - bass_first[1:, np.newaxis, :])
    return ScoreTables(
        act_p1=act_p1,
        act_p2=act_p2,
        act_tr=act_tr,
        act_no=act_no,
        reg_both=reg_both,
        reg_ok=reg_ok,
        bass_inner=bass_inner,
        bass_inner_leaps=bass_inner_leaps,
        bass_across=_leap_score(leaps),
        single_chord=np.array([len(bar.chords) == 1 for bar in bars], dtype=bool),
        phrase_end=np.array([bar.phrase_end for bar in bars], dtype=bool),
        phrase=np.array([bar.phrase for bar in bars], dtype=int),
        is_chorus=np.array([bar.role == "chorus" for bar in bars], dtype=bool),
    )


def bass_line(tr_texture: int, pitches: list[int]) -> list[int]:
    """The pitches of a TR bar that form the bass line: all of them, except in the octave pump.

    The pump alternates root and upper octave on the eighths; its line is the roots alone.

    >>> bass_line(OCTAVE_PUMP, [36, 48, 36, 48, 43, 55, 43, 55])
    [36, 36, 43, 43]
    >>> bass_line(TR_TEXTURES.index("walking"), [36, 40, 43, 42])
    [36, 40, 43, 42]
    """
    return pitches[::2] if tr_texture == OCTAVE_PUMP else pitches


def _activity(notes, steps: int) -> float:
    return min(1.0, len(notes) / steps)


def _sounding_grid(notes, steps: int) -> np.ndarray:
    """Pitch sounding at the start of each sixteenth step of the bar, or -1 when it rests."""
    grid = np.full(steps, -1)
    for note in notes:
        for step in range(steps):
            if note.onset <= step * STEP + 1e-9 < note.onset + note.duration:
                grid[step] = note.pitch
    return grid


def _leap_score(leaps: np.ndarray) -> np.ndarray:
    """1 for a leap up to a fourth (5 semitones), 0 from an octave (12), linear in between."""
    return np.clip((12.0 - leaps) / 7.0, 0.0, 1.0)
