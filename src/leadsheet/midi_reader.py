"""Read a lead sheet from a full multi-track MIDI file (melody track + accompaniment).

Many songs exist only as MIDI files made by fans: a whole band, with no chord symbols and no
part labels. To arrange such a song for the NES, this module reduces it to a lead sheet:

- Melody: the notes of one chosen track. A *skyline* keeps only the highest note at each moment,
  so the melody is monophonic like a sung line, and onsets and ends snap to a sixteenth-note grid
  (hand-played files are a few milliseconds early or late). A very short note, whose end snaps
  onto its start (a staccato sixteenth, half a sixteenth long or less), keeps one sixteenth: a
  staccato note is still a note of the tune. The skyline then cuts it at the next onset.
- Chords: every half bar (2 beats), the other pitched tracks vote for the 12 pitch classes in
  proportion to how long each class sounds; bass tracks vote twice. The chord whose tones collect
  the most votes (major, minor, dominant seventh or minor seventh, on any of the 12 roots) is
  chosen, with a bonus when its root is the bass note.
- Form: the student marks where each section starts (for example bar 0 is "A" and bar 8 is "B");
  sections, roles and phrases then follow the same rules as the ABC reader.

Time is measured in beats on a *beat grid*. A MIDI file made in a sequencer already has one: its
ticks. A file recorded live may not: "Voa Voa" says 120 BPM but was played at about 110 BPM, so its
notes drift across the file's bar lines. When the drum onsets do not fit the file's own grid,
the grid is estimated from the recording: the tempo whose sixteenth-note grid best explains the
drum onsets, the sixteenth with the most onsets as the beat, and the beat where the bass plays
its longest notes as the downbeat.

Only 4/4 is supported. A file may open with a few bars in another meter, such as a 3/4 count-in
before a 4/4 song: on the file's own grid those bars are a lead-in, and bar 0 is the first 4/4 bar.
A change to another meter inside the music would move every later bar line, so it is refused.
"""

import math
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pretty_midi

from leadsheet.abc_reader import phrase_marks, section_role
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

BEATS_PER_BAR = 4
GRID = 0.25  # sixteenth note, in beats
CHORD_SPAN = 2.0  # one chord decision per half bar
PITCH_CLASS_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")

# Chord qualities as intervals from the root, in the order root, third, fifth, seventh.
QUALITIES = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10)}
BASS_TRACK_MAX_MEAN_PITCH = 50  # tracks lower than this on average are treated as bass

Note = tuple[float, float, int]  # (start beat, end beat, MIDI pitch)

# A file whose drum onsets fit its own sixteenth-note grid this well keeps its ticks as the grid.
FILE_GRID_MIN_STRENGTH = 0.8
TEMPO_SEARCH = np.arange(60.0, 200.0, 0.05)


def grid_strength(onsets: np.ndarray, bpm: float | np.ndarray) -> np.ndarray:
    """How well onset times (s) fit a sixteenth-note grid: 1 = perfectly, near 0 = not at all.

    It is the length of the mean of the onsets' phases on the grid, seen as unit vectors.

    >>> onsets = np.arange(16) * 0.125  # sixteenths at 120 BPM
    >>> float(np.round(grid_strength(onsets, 120.0), 3)), float(grid_strength(onsets, 97.0) < 0.5)
    (1.0, 1.0)
    """
    step = 60.0 / np.asarray(bpm, dtype=float) / 4
    phases = np.exp(2j * np.pi * onsets[..., np.newaxis] / step)
    return np.abs(phases.mean(axis=0)).squeeze()


def estimate_beat_grid(midi: pretty_midi.PrettyMIDI) -> tuple[float, float, float]:
    """Return (tempo BPM, first downbeat in seconds, grid strength) estimated from the notes."""
    drums = [n.start for i in midi.instruments if i.is_drum for n in i.notes]
    pitched = [n.start for i in midi.instruments if not i.is_drum for n in i.notes]
    onsets = np.unique(np.round(np.array(drums or pitched), 3))
    strengths = np.concatenate(
        [grid_strength(onsets, TEMPO_SEARCH[i : i + 200]) for i in range(0, len(TEMPO_SEARCH), 200)]
    )
    # A grid twice as fast fits the same onsets, so take the slowest tempo that fits about as well
    # as the best one, then the best tempo near it.
    good = TEMPO_SEARCH[strengths >= 0.9 * strengths.max()]
    near = np.abs(TEMPO_SEARCH - good.min()) <= 1.0
    bpm = float(TEMPO_SEARCH[near][np.argmax(strengths[near])])
    strength = float(grid_strength(onsets, bpm))
    step = 60.0 / bpm / 4
    first_step = float(np.angle(np.exp(2j * np.pi * onsets / step).mean()) / (2 * np.pi) * step)
    first_step %= step
    # The beat is the sixteenth position (of 4) with the most onsets, drums and notes together.
    all_onsets = np.array(drums + pitched)
    positions = np.round((all_onsets - first_step) / step).astype(int) % 4
    beat_shift = int(np.argmax(np.bincount(positions, minlength=4)))
    first_beat = first_step + beat_shift * step
    # The downbeat is the beat (of 4) on which the bass plays the longest notes.
    beat = 4 * step
    weights = np.zeros(4)
    for instrument in midi.instruments:
        if instrument.is_drum or not instrument.notes:
            continue
        if np.mean([n.pitch for n in instrument.notes]) >= BASS_TRACK_MAX_MEAN_PITCH:
            continue
        for n in instrument.notes:
            weights[int(round((n.start - first_beat) / beat)) % 4] += n.end - n.start
    downbeat = (first_beat + int(np.argmax(weights)) * beat) % (4 * beat)
    return bpm, downbeat, strength


def meter_offset_beats(midi: pretty_midi.PrettyMIDI) -> float:
    """Return the beat (ticks / resolution) on which the file's 4/4 music starts.

    Time signatures before the first 4/4 one are a lead-in (a count-in, for example): on the
    file's own grid, bar 0 starts on the tick of that 4/4 time signature. A file without time
    signatures is 4/4 from the start.

    >>> midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    >>> meter_offset_beats(midi)
    0.0
    >>> midi.time_signature_changes = [  # two 3/4 bars of count-in, 4/4 from 3 s on
    ...     pretty_midi.TimeSignature(3, 4, 0.0),
    ...     pretty_midi.TimeSignature(4, 4, 3.0),
    ... ]
    >>> meter_offset_beats(midi)
    6.0

    Raises:
        ValueError: when no time signature is 4/4, or when the meter changes from 4/4 to another
            one (the message names the meter, its bar counted from the offset and its time).
    """
    changes = midi.time_signature_changes
    if not changes:
        return 0.0
    supported = [(c.numerator, c.denominator) == (4, 4) for c in changes]
    if not any(supported):
        meter = f"{changes[0].numerator}/{changes[0].denominator}"
        raise ValueError(f"only 4/4 MIDI files are supported; this file is in {meter}")
    start = supported.index(True)
    offset = float(midi.time_to_tick(changes[start].time) / midi.resolution)
    for change, is_supported in zip(changes[start:], supported[start:], strict=True):
        if not is_supported:
            beat = midi.time_to_tick(change.time) / midi.resolution
            bar = math.floor((beat - offset) / BEATS_PER_BAR)
            raise ValueError(
                f"the file changes to {change.numerator}/{change.denominator} at bar {bar} "
                f"({change.time:.1f} s); only 4/4 is supported"
            )
    return offset


def skyline(notes: Sequence[Note]) -> list[Note]:
    """Keep the highest note at each onset and cut every note at the next onset.

    >>> skyline([(0.0, 2.0, 60), (0.0, 1.0, 64), (1.0, 2.0, 62)])
    [(0.0, 1.0, 64), (1.0, 2.0, 62)]
    """
    by_onset: dict[float, Note] = {}
    for start, end, pitch in notes:
        if start not in by_onset or pitch > by_onset[start][2]:
            by_onset[start] = (start, end, pitch)
    ordered = [by_onset[onset] for onset in sorted(by_onset)]
    line = []
    for (start, end, pitch), following in zip(ordered, ordered[1:] + [None], strict=True):
        if following is not None:
            end = min(end, following[0])
        if end > start:
            line.append((start, end, pitch))
    return line


def detect_chord(weights: Sequence[float], bass_pc: int | None) -> tuple[str, int, tuple] | None:
    """Return (symbol, root, tones) of the chord that best explains 12 pitch-class weights.

    A chord scores the weight of its tones minus half the weight of the other classes; a seventh
    chord is considered only when its seventh is clearly present.

    >>> detect_chord([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], bass_pc=0)[0]
    'C'
    """
    total = sum(weights)
    if total <= 0:
        return None
    best, best_score = None, -math.inf
    for root in range(12):
        for quality, intervals in QUALITIES.items():
            tones = tuple((root + i) % 12 for i in intervals)
            if len(tones) == 4 and weights[tones[3]] < 0.25 * max(weights):
                continue
            inside = sum(weights[pc] for pc in tones)
            score = inside - 0.5 * (total - inside)
            if root == bass_pc:
                score += 0.25 * total
            if score > best_score + 1e-9:
                best, best_score = (PITCH_CLASS_NAMES[root] + quality, root, tones), score
    return best


def read_lead_sheet_midi(
    path: Path | str,
    melody_track: int | Sequence[int],
    phrase_length: int = 4,
    role_map: dict[str, str] | None = None,
    bars: tuple[int, int] | None = None,
    sections: Sequence[tuple[int, str]] | None = None,
    tempo_override: float | None = None,
    grid: str | Sequence[float] = "auto",
) -> LeadSheet:
    """Reduce a multi-track MIDI file to a lead sheet.

    Args:
        path: MIDI file.
        melody_track: index of the track that carries the melody (0-based, as listed by
            pretty_midi), or several indices when the melody moves between instruments; their
            notes are merged by the skyline.
        phrase_length: bars per phrase.
        role_map: part label to "verse"/"chorus", as in the ABC reader.
        bars: optional excerpt (first bar, end bar), 0-based with the end excluded. On the file's
            own grid, bar 0 is the first 4/4 bar (see `meter_offset_beats`).
        sections: (bar inside the excerpt, label) pairs where each section starts; default one
            section "A".
        tempo_override: tempo in BPM; by default the tempo of the beat grid.
        grid: "file" uses the file's ticks; (bpm, downbeat seconds) gives the grid explicitly;
            "auto" keeps the file's ticks when the drums fit them, else estimates the grid.

    Raises:
        ValueError: for a missing or drum melody track, or a meter that is not 4/4 after the
            lead-in (see `meter_offset_beats`).
    """
    midi = pretty_midi.PrettyMIDI(str(path))
    melody_tracks = [melody_track] if isinstance(melody_track, int) else list(melody_track)
    for track in melody_tracks:
        if not 0 <= track < len(midi.instruments):
            raise ValueError(f"melody track {track} does not exist")
        if midi.instruments[track].is_drum:
            raise ValueError(f"track {track} is a drum track and cannot be the melody")
    meter_offset = meter_offset_beats(midi)

    file_bpm = float(midi.get_tempo_changes()[1][0])
    if grid == "auto":
        # Measure the fit on the file's own beats (ticks), so tempo changes do not count as misfit.
        drum_beats = np.array(
            [
                midi.time_to_tick(n.start) / midi.resolution
                for i in midi.instruments
                if i.is_drum
                for n in i.notes
            ]
        )
        fits_file = (
            drum_beats.size == 0 or grid_strength(drum_beats, 60.0) >= FILE_GRID_MIN_STRENGTH
        )
        grid = "file" if fits_file else estimate_beat_grid(midi)[:2]
    if grid == "file":
        source_grid = (file_bpm, 0.0)

        def beats(seconds: float) -> float:
            return midi.time_to_tick(seconds) / midi.resolution

    else:
        grid_bpm, downbeat = float(grid[0]), float(grid[1])
        source_grid = (grid_bpm, downbeat)
        meter_offset = 0.0  # a grid of its own starts on its own downbeat

        def beats(seconds: float) -> float:
            return (seconds - downbeat) * grid_bpm / 60.0

    tracks = []
    for index, instrument in enumerate(midi.instruments):
        if instrument.is_drum or not instrument.notes:
            continue
        notes = [(beats(n.start), beats(n.end), n.pitch) for n in instrument.notes]
        mean_pitch = sum(p for _, _, p in notes) / len(notes)
        tracks.append((index, notes, mean_pitch < BASS_TRACK_MAX_MEAN_PITCH))
    last_beat = max(end for _, notes, _ in tracks for _, end, _ in notes)
    first_bar, end_bar = (
        bars
        if bars is not None
        else (0, math.ceil((last_beat - meter_offset) / BEATS_PER_BAR - 1e-3))
    )
    offset = meter_offset + first_bar * BEATS_PER_BAR
    n_bars = end_bar - first_bar

    melody_notes = [n for index, notes, _ in tracks if index in melody_tracks for n in notes]
    melody = _quantized_melody(melody_notes, offset, n_bars)
    harmony = [(notes, is_bass) for index, notes, is_bass in tracks if index not in melody_tracks]
    chords = _chords(harmony, offset, n_bars)

    starts = dict(sections) if sections else {0: "A"}
    labels, section_ids, current, section = [], [], starts.get(0, "A"), 0
    for bar_index in range(n_bars):
        if bar_index in starts and bar_index > 0:
            current, section = starts[bar_index], section + 1
        labels.append(current)
        section_ids.append(section)
    marks = phrase_marks(section_ids, phrase_length)

    lead_bars = tuple(
        Bar(
            index=b,
            melody=tuple(melody[b]),
            chords=tuple(chords[b]),
            label=labels[b],
            role=section_role(labels[b], role_map),
            phrase=marks[b][0],
            phrase_end=marks[b][1],
        )
        for b in range(n_bars)
    )
    tempo = tempo_override or (_tempo_at_beat(midi, offset) if grid == "file" else source_grid[0])
    return LeadSheet(
        title=Path(path).stem, key="", tempo_bpm=tempo, bars=lead_bars, source_grid=source_grid
    )


def _tempo_at_beat(midi: pretty_midi.PrettyMIDI, beat: float) -> float:
    """The tempo (BPM) in effect at a beat of the file's own grid.

    The excerpt plays at the tempo where it starts, not at the file's first tempo, which may
    belong to a count-in.
    """
    times, tempi = midi.get_tempo_changes()
    seconds = midi.tick_to_time(int(round(beat * midi.resolution)))
    return float(tempi[np.searchsorted(times, seconds + 1e-9, side="right") - 1])


def _snap(beat: float) -> float:
    return round(beat / GRID) * GRID


def _quantized_melody(notes: Sequence[Note], offset: float, n_bars: int) -> list[list]:
    """Snap to the grid, skyline, keep the excerpt and split notes at the bar lines.

    A note whose end snaps onto its start (half a sixteenth long or shorter) lasts one sixteenth.

    >>> staccato = [(0.0, 0.1, 72), (0.25, 0.35, 74), (0.5, 0.6, 72), (0.75, 0.85, 74)]
    >>> notes = _quantized_melody(staccato + [(2.0, 2.3, 76)], 0.0, 1)[0]
    >>> [(n.pitch, n.onset, n.duration) for n in notes]
    [(72, 0.0, 0.25), (74, 0.25, 0.25), (72, 0.5, 0.25), (74, 0.75, 0.25), (76, 2.0, 0.25)]
    """
    snapped = []
    for start, end, pitch in notes:
        start, end = _snap(start) - offset, _snap(end) - offset
        # A staccato note is still a note of the tune: keep one sixteenth rather than drop it.
        snapped.append((start, end if end > start else start + GRID, pitch))
    end_of_piece = n_bars * BEATS_PER_BAR
    per_bar: list[list[MelodyNote]] = [[] for _ in range(n_bars)]
    for start, end, pitch in skyline(snapped):
        start, end = max(start, 0.0), min(end, end_of_piece)
        while end > start:
            bar = int(start // BEATS_PER_BAR)
            bar_end = (bar + 1) * BEATS_PER_BAR
            piece = min(end, bar_end)
            per_bar[bar].append(MelodyNote(pitch, start - bar * BEATS_PER_BAR, piece - start))
            start = piece
    return per_bar


def _chords(tracks: Sequence[tuple[Sequence[Note], bool]], offset: float, n_bars: int) -> list:
    """One chord decision per half bar, merged within each bar; silence keeps the last chord."""
    spans_per_bar = int(BEATS_PER_BAR / CHORD_SPAN)
    decisions: list[tuple[str, int, tuple] | None] = []
    for span in range(n_bars * spans_per_bar):
        lo, hi = offset + span * CHORD_SPAN, offset + (span + 1) * CHORD_SPAN
        weights, bass = [0.0] * 12, None
        for notes, is_bass in tracks:
            for start, end, pitch in notes:
                overlap = min(end, hi) - max(start, lo)
                if overlap > 0:
                    weights[pitch % 12] += overlap * (2.0 if is_bass else 1.0)
                    if bass is None or pitch < bass[0]:
                        bass = (pitch, pitch % 12)
        decisions.append(detect_chord(weights, bass[1] if bass else None))
    # Silent spans keep the chord before them; leading silence takes the first chord found.
    first = next((d for d in decisions if d is not None), ("C", 0, (0, 4, 7)))
    filled, previous = [], first
    for decision in decisions:
        previous = decision or previous
        filled.append(previous)
    per_bar = []
    for bar in range(n_bars):
        segments: list[ChordSegment] = []
        for position in range(spans_per_bar):
            symbol, root, tones = filled[bar * spans_per_bar + position]
            onset = position * CHORD_SPAN
            if segments and segments[-1].symbol == symbol:
                last = segments[-1]
                segments[-1] = ChordSegment(
                    symbol, root, tones, last.onset, last.duration + CHORD_SPAN
                )
            else:
                segments.append(ChordSegment(symbol, root, tones, onset, CHORD_SPAN))
        per_bar.append(segments)
    return per_bar
