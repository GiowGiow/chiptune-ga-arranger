"""Score tables: every musical fact the fitness function needs, computed once per lead sheet.

The genes of one bar take few values (5 P2 textures, 4 TR textures, 5 drum patterns, 3 melody
octaves), so every (bar, gene value) choice can be realized into notes and measured once, before
the GA starts. The fitness of a plan then only looks values up in these tables, which keeps the
thousands of fitness evaluations of a run fast and keeps the notes out of the GA loop.

Activity measures how busy a channel is in a bar: min(1, onsets / 16), so one onset on every
sixteenth note (or more) counts as fully active, and silence as 0.
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
        act_no: (5,) NO activity for each drum pattern (the same in every bar).
        reg_both: (n, 3, 5) sixteenth steps where P1 (octave gene) and P2 (texture) both sound.
        reg_ok: (n, 3, 5) sixteenth steps where both sound and P2 is lower than P1.
        bass_smooth: (n - 1, 4, 4) score in [0, 1] of the leap from TR texture i in bar b to
            TR texture j in bar b + 1.
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
    bass_smooth: np.ndarray
    single_chord: np.ndarray
    phrase_end: np.ndarray
    phrase: np.ndarray
    is_chorus: np.ndarray


# Sixteenth-note steps of a 4/4 bar: the grid on which register overlaps are counted.
STEPS_PER_BAR = 16
STEP = 0.25


def build_tables(lead_sheet: LeadSheet) -> ScoreTables:
    """Realize every (bar, channel, gene value) choice once and measure it.

    >>> from leadsheet.model import Bar, ChordSegment, MelodyNote
    >>> c = ChordSegment("C", 0, (0, 4, 7), 0.0, 4.0)
    >>> bar = Bar(0, (MelodyNote(72, 0.0, 4.0),), (c,), "A", "verse", 0, True)
    >>> tables = build_tables(LeadSheet("one bar", "c major", 120.0, (bar,)))
    >>> float(tables.act_p2[0, 1]), tables.bass_smooth.shape
    (1.0, (0, 4, 4))
    """
    bars = lead_sheet.bars
    n = len(bars)
    act_p1 = np.zeros((n, len(P1_OCTAVES)))
    act_p2 = np.zeros((n, len(P2_TEXTURES)))
    act_tr = np.zeros((n, len(TR_TEXTURES)))
    reg_both = np.zeros((n, len(P1_OCTAVES), len(P2_TEXTURES)))
    reg_ok = np.zeros_like(reg_both)
    bass_first = np.zeros((n, len(TR_TEXTURES)))
    bass_last = np.zeros((n, len(TR_TEXTURES)))
    for b, bar in enumerate(bars):
        next_bar = bars[b + 1] if b + 1 < n else None
        melody_grids = []
        for octave in range(len(P1_OCTAVES)):
            notes = realize_p1(bar, octave)
            act_p1[b, octave] = _activity(notes)
            melody_grids.append(_sounding_grid(notes))
        for texture in range(len(P2_TEXTURES)):
            notes = realize_p2(bar, texture)
            act_p2[b, texture] = _activity(notes)
            harmony = _sounding_grid(notes)
            for octave, melody in enumerate(melody_grids):
                both = (melody >= 0) & (harmony >= 0)
                reg_both[b, octave, texture] = both.sum()
                reg_ok[b, octave, texture] = (both & (harmony < melody)).sum()
        for texture in range(len(TR_TEXTURES)):
            notes = realize_tr(bar, texture, next_bar)
            act_tr[b, texture] = _activity(notes)
            bass_first[b, texture] = notes[0].pitch
            bass_last[b, texture] = notes[-1].pitch
    act_no = np.array([_activity(realize_no(pattern)) for pattern in range(len(NO_PATTERNS))])
    # Leap from the last bass note of bar b (texture i) to the first of bar b + 1 (texture j).
    leaps = np.abs(bass_last[:-1, :, np.newaxis] - bass_first[1:, np.newaxis, :])
    bass_smooth = _leap_score(leaps)
    return ScoreTables(
        act_p1=act_p1,
        act_p2=act_p2,
        act_tr=act_tr,
        act_no=act_no,
        reg_both=reg_both,
        reg_ok=reg_ok,
        bass_smooth=bass_smooth,
        single_chord=np.array([len(bar.chords) == 1 for bar in bars], dtype=bool),
        phrase_end=np.array([bar.phrase_end for bar in bars], dtype=bool),
        phrase=np.array([bar.phrase for bar in bars], dtype=int),
        is_chorus=np.array([bar.role == "chorus" for bar in bars], dtype=bool),
    )


def _activity(notes) -> float:
    return min(1.0, len(notes) / STEPS_PER_BAR)


def _sounding_grid(notes) -> np.ndarray:
    """Pitch sounding at the start of each sixteenth step, or -1 when the channel rests."""
    grid = np.full(STEPS_PER_BAR, -1)
    for note in notes:
        for step in range(STEPS_PER_BAR):
            if note.onset <= step * STEP + 1e-9 < note.onset + note.duration:
                grid[step] = note.pitch
    return grid


def _leap_score(leaps: np.ndarray) -> np.ndarray:
    """1 for a leap up to a fourth (5 semitones), 0 from an octave (12), linear in between."""
    return np.clip((12.0 - leaps) / 7.0, 0.0, 1.0)
