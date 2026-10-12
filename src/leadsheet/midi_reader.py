"""Read a lead sheet from a full multi-track MIDI file (melody track + accompaniment).

Many songs exist only as MIDI files made by fans: a whole band, with no chord symbols and no
part labels. To arrange such a song for the NES, this module reduces it to a lead sheet:

- Melody: the notes of one chosen track. A *skyline* keeps only the highest note at each moment,
  so the melody is monophonic like a sung line, and onsets and ends snap to a sixteenth-note grid
  (hand-played files are a few milliseconds early or late). A very short note, whose end snaps
  onto its start (a staccato sixteenth, half a sixteenth long or less), keeps one sixteenth: a
  staccato note is still a note of the tune. The skyline then cuts it at the next onset.
- Chords: over each group of the bar's meter (from one strong beat to the next: half bars in
  4/4, the whole bar in 3/4), the other pitched tracks vote for the 12 pitch classes in
  proportion to how long each class sounds; bass tracks vote twice. The chord whose tones collect
  the most votes (major, minor, dominant seventh or minor seventh, on any of the 12 roots) is
  chosen, with a bonus when its root is the bass note.
- Form: the student marks where each section starts (for example bar 0 is "A" and bar 8 is "B");
  sections, roles and phrases then follow the same rules as the ABC reader.

Time is measured in quarter-note beats on a *beat grid*. A MIDI file made in a sequencer already
has one: its ticks. A file recorded live may not: "Voa Voa" says 120 BPM but was played at about
110 BPM, so its notes drift across the file's bar lines. When the drum onsets do not fit the
file's own grid, the grid is estimated from the recording: the tempo whose sixteenth-note grid
best explains the drum onsets, the sixteenth with the most onsets as the beat, and the beat where
the bass plays its longest notes as the downbeat.

Bar lines come from the file's *time-signature map*: bar 0 starts on the file's first beat, in
4/4 until the first time signature, and each time signature starts a new bar in its meter (see
`bar_map`). A count-in in another meter is part of the map; by default the excerpt starts on the
first bar that holds a pitched note, so a drum-only count-in is left out. On an estimated grid
the song is read in one meter, the one that lasts longest in the map.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi

from leadsheet.abc_reader import phrase_marks, section_role
from leadsheet.meter import FOUR_FOUR, Meter, groups, parse_meter
from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

GRID = 0.25  # sixteenth note, in beats
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


def estimate_beat_grid(
    midi: pretty_midi.PrettyMIDI, beats_per_bar: int = 4
) -> tuple[float, float, float]:
    """Return (tempo BPM, first downbeat in seconds, grid strength) estimated from the notes.

    `beats_per_bar` is the bar length in quarter notes, among which the downbeat is chosen.
    """
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
    # The downbeat is the beat (of the bar's beats) on which the bass plays the longest notes.
    beat = 4 * step
    weights = np.zeros(beats_per_bar)
    for instrument in midi.instruments:
        if instrument.is_drum or not instrument.notes:
            continue
        if np.mean([n.pitch for n in instrument.notes]) >= BASS_TRACK_MAX_MEAN_PITCH:
            continue
        for n in instrument.notes:
            weights[int(round((n.start - first_beat) / beat)) % beats_per_bar] += n.end - n.start
    downbeat = (first_beat + int(np.argmax(weights)) * beat) % (beats_per_bar * beat)
    return bpm, downbeat, strength


@dataclass(frozen=True)
class MapBar:
    """One bar of a MIDI file's time-signature map.

    Attributes:
        start: the beat (quarter notes on the file's grid) where the bar starts.
        length: the bar's length in beats; shorter than its meter when a time signature that
            does not fall on a bar line cuts it.
        signature: (numerator, denominator) of the time signature in effect, as the file writes
            it, supported or not.
    """

    start: float
    length: float
    signature: tuple[int, int]

    @property
    def meter(self) -> Meter:
        """The bar's meter; ValueError when the file uses a meter the arranger does not support."""
        return parse_meter(f"{self.signature[0]}/{self.signature[1]}")


def bar_map(midi: pretty_midi.PrettyMIDI) -> list[MapBar]:
    """List every bar of the file on its own tick grid (beats = ticks / resolution).

    Bar 0 starts on beat 0, in 4/4 until the first time signature, as the MIDI standard says.
    Each time signature starts a new bar at its tick, and bars follow each other until the end
    of the last note.

    >>> midi = pretty_midi.PrettyMIDI(initial_tempo=120.0)
    >>> midi.time_signature_changes = [  # one 3/4 bar of count-in, 4/4 from 1.5 s (beat 3) on
    ...     pretty_midi.TimeSignature(3, 4, 0.0), pretty_midi.TimeSignature(4, 4, 1.5)]
    >>> piano = pretty_midi.Instrument(program=0)
    >>> piano.notes.append(pretty_midi.Note(90, 60, 1.5, 5.5))  # beats 3 to 11
    >>> midi.instruments.append(piano)
    >>> [(bar.start, str(bar.meter)) for bar in bar_map(midi)]
    [(0.0, '3/4'), (3.0, '4/4'), (7.0, '4/4')]
    """
    changes: dict[float, tuple[int, int]] = {}
    for change in midi.time_signature_changes:
        beat = midi.time_to_tick(change.time) / midi.resolution
        changes[float(beat)] = (change.numerator, change.denominator)  # the last one at a tick wins
    ends = [n.end for instrument in midi.instruments for n in instrument.notes]
    last_beat = midi.time_to_tick(max(ends)) / midi.resolution if ends else 0.0
    change_beats = sorted(changes)
    signature, position, next_change = (4, 4), 0.0, 0
    bars: list[MapBar] = []
    while True:
        while next_change < len(change_beats) and change_beats[next_change] <= position + 1e-9:
            signature = changes[change_beats[next_change]]
            next_change += 1
        if position >= last_beat - 1e-3 and bars:
            return bars
        length = signature[0] * 4 / signature[1]
        if next_change < len(change_beats):
            length = min(length, change_beats[next_change] - position)
        bars.append(MapBar(position, length, signature))
        position += length


def _bars_with_notes(bars: Sequence[MapBar], onsets: Sequence[float], ends: Sequence[float]):
    """The default excerpt: from the bar of the first onset to the bar where the last note ends."""
    starts = [bar.start for bar in bars]
    first = max(0, int(np.searchsorted(starts, min(onsets) + 1e-9, side="right")) - 1)
    last = max(0, int(np.searchsorted(starts, max(ends) - 1e-3, side="right")) - 1)
    return first, last + 1


def excerpt_bars(
    midi: pretty_midi.PrettyMIDI, bars: tuple[int, int] | None, beats=None
) -> tuple[list[MapBar], int, int]:
    """The time-signature map of the file and the excerpt (first bar, end bar) to read.

    Without `bars`, the excerpt runs from the first bar that holds a pitched note to the bar
    where the last pitched note ends, so a drum-only count-in or silence is left out.
    `beats` turns seconds into grid beats (by default the file's ticks).
    """
    to_beats = beats or (lambda seconds: midi.time_to_tick(seconds) / midi.resolution)
    the_map = bar_map(midi)
    if bars is not None:
        return the_map, bars[0], bars[1]
    pitched = [n for i in midi.instruments if not i.is_drum for n in i.notes]
    first, end = _bars_with_notes(
        the_map, [to_beats(n.start) for n in pitched], [to_beats(n.end) for n in pitched]
    )
    return the_map, first, end


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
        bars: optional excerpt (first bar, end bar), 0-based with the end excluded, counted on
            the file's time-signature map (see `bar_map`). By default, from the first to the last
            bar that holds a pitched note.
        sections: (bar inside the excerpt, label) pairs where each section starts; default one
            section "A".
        tempo_override: tempo in BPM; by default the tempo of the beat grid.
        grid: "file" uses the file's ticks; (bpm, downbeat seconds) gives the grid explicitly;
            "auto" keeps the file's ticks when the drums fit them, else estimates the grid.

    Raises:
        ValueError: for a missing or drum melody track; for a bar of the excerpt in an
            unsupported meter or cut short by a time-signature change (the message names the
            bar); for an estimated grid in a meter whose bar is not a whole number of quarters.
    """
    midi = pretty_midi.PrettyMIDI(str(path))
    melody_tracks = [melody_track] if isinstance(melody_track, int) else list(melody_track)
    for track in melody_tracks:
        if not 0 <= track < len(midi.instruments):
            raise ValueError(f"melody track {track} does not exist")
        if midi.instruments[track].is_drum:
            raise ValueError(f"track {track} is a drum track and cannot be the melody")

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
        grid = "file" if fits_file else estimate_beat_grid(midi, _whole_beats(main_meter(midi)))[:2]
    if grid == "file":
        source_grid = (file_bpm, 0.0)

        def beats(seconds: float) -> float:
            return midi.time_to_tick(seconds) / midi.resolution

        the_map, first_bar, end_bar = excerpt_bars(midi, bars)
    else:
        grid_bpm, downbeat = float(grid[0]), float(grid[1])
        source_grid = (grid_bpm, downbeat)

        def beats(seconds: float) -> float:
            return (seconds - downbeat) * grid_bpm / 60.0

        the_map, first_bar, end_bar = _grid_excerpt(midi, main_meter(midi), beats, bars)

    tracks = []
    for index, instrument in enumerate(midi.instruments):
        if instrument.is_drum or not instrument.notes:
            continue
        notes = [(beats(n.start), beats(n.end), n.pitch) for n in instrument.notes]
        mean_pitch = sum(p for _, _, p in notes) / len(notes)
        tracks.append((index, notes, mean_pitch < BASS_TRACK_MAX_MEAN_PITCH))
    excerpt = the_map[first_bar:end_bar]
    meters = [_checked_meter(bar, first_bar + index, midi) for index, bar in enumerate(excerpt)]
    offset = excerpt[0].start
    bar_starts = [bar.start - offset for bar in excerpt]
    n_bars = len(excerpt)

    melody_notes = [n for index, notes, _ in tracks if index in melody_tracks for n in notes]
    melody = _quantized_melody(melody_notes, offset, bar_starts, meters)
    harmony = [(notes, is_bass) for index, notes, is_bass in tracks if index not in melody_tracks]
    chords = _chords(harmony, offset, bar_starts, meters)

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
            meter=meters[b],
        )
        for b in range(n_bars)
    )
    tempo = tempo_override or (_tempo_at_beat(midi, offset) if grid == "file" else source_grid[0])
    return LeadSheet(
        title=Path(path).stem, key="", tempo_bpm=tempo, bars=lead_bars, source_grid=source_grid
    )


def main_meter(midi: pretty_midi.PrettyMIDI) -> Meter:
    """The meter that lasts longest in the file's time-signature map (4/4 without one).

    An estimated or explicit beat grid reads the whole song in this meter.
    """
    totals: dict[tuple[int, int], float] = {}
    for bar in bar_map(midi):
        totals[bar.signature] = totals.get(bar.signature, 0.0) + bar.length
    if not midi.time_signature_changes or not totals:
        return FOUR_FOUR
    signature = max(totals, key=lambda key: totals[key])
    return parse_meter(f"{signature[0]}/{signature[1]}")


def _whole_beats(meter: Meter) -> int:
    """The bar length of a meter in whole quarter notes, for the downbeat search."""
    if meter.bar_beats != int(meter.bar_beats):
        raise ValueError(
            f'a {meter} song needs the file\'s own beat grid (midi.grid = "file"): its bar is '
            f"not a whole number of quarter notes, so its downbeat cannot be estimated"
        )
    return int(meter.bar_beats)


def _grid_excerpt(midi, meter: Meter, beats, bars: tuple[int, int] | None):
    """Bars of one meter from the grid's downbeat on, and the excerpt to read in them."""
    ends = [beats(n.end) for instrument in midi.instruments for n in instrument.notes]
    count = max(1, math.ceil(max(ends) / meter.bar_beats - 1e-3))
    signature = (meter.numerator, meter.denominator)
    the_map = [MapBar(b * meter.bar_beats, meter.bar_beats, signature) for b in range(count)]
    if bars is not None:
        return the_map, bars[0], bars[1]
    pitched = [n for i in midi.instruments if not i.is_drum for n in i.notes]
    first, end = _bars_with_notes(
        the_map, [beats(n.start) for n in pitched], [beats(n.end) for n in pitched]
    )
    return the_map, first, end


def _checked_meter(bar: MapBar, index: int, midi: pretty_midi.PrettyMIDI) -> Meter:
    """The meter of a bar inside the excerpt; ValueError naming the bar when it cannot be read."""
    try:
        meter = bar.meter
    except ValueError as error:
        raise ValueError(f"bar {index}: {error}") from None
    if abs(bar.length - meter.bar_beats) > 1e-6:
        seconds = midi.tick_to_time(int(round(bar.start * midi.resolution)))
        raise ValueError(
            f"bar {index} ({seconds:.1f} s) lasts {bar.length:g} beats instead of "
            f"{meter.bar_beats:g}: a time signature cuts it short; leave it out of midi.bars"
        )
    return meter


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


def _quantized_melody(
    notes: Sequence[Note], offset: float, bar_starts: Sequence[float], meters: Sequence[Meter]
) -> list[list]:
    """Snap to the grid, skyline, keep the excerpt and split notes at the bar lines.

    `offset` is the excerpt's first beat; `bar_starts` are the bars' starts from it.
    A note whose end snaps onto its start (half a sixteenth long or shorter) lasts one sixteenth.

    >>> staccato = [(0.0, 0.1, 72), (0.25, 0.35, 74), (0.5, 0.6, 72), (0.75, 0.85, 74)]
    >>> notes = _quantized_melody(staccato + [(2.0, 2.3, 76)], 0.0, [0.0], [FOUR_FOUR])[0]
    >>> [(n.pitch, n.onset, n.duration) for n in notes]
    [(72, 0.0, 0.25), (74, 0.25, 0.25), (72, 0.5, 0.25), (74, 0.75, 0.25), (76, 2.0, 0.25)]
    """
    snapped = []
    for start, end, pitch in notes:
        start, end = _snap(start) - offset, _snap(end) - offset
        # A staccato note is still a note of the tune: keep one sixteenth rather than drop it.
        snapped.append((start, end if end > start else start + GRID, pitch))
    end_of_piece = bar_starts[-1] + meters[-1].bar_beats
    per_bar: list[list[MelodyNote]] = [[] for _ in bar_starts]
    for start, end, pitch in skyline(snapped):
        start, end = max(start, 0.0), min(end, end_of_piece)
        while end > start:
            bar = int(np.searchsorted(bar_starts, start, side="right")) - 1
            bar_end = bar_starts[bar] + meters[bar].bar_beats
            piece = min(end, bar_end)
            per_bar[bar].append(MelodyNote(pitch, start - bar_starts[bar], piece - start))
            start = piece
    return per_bar


def _chords(
    tracks: Sequence[tuple[Sequence[Note], bool]],
    offset: float,
    bar_starts: Sequence[float],
    meters: Sequence[Meter],
) -> list:
    """One chord decision per group of each bar's meter (from one strong beat to the next: half
    bars in 4/4, the whole bar in 3/4), merged within each bar; silence keeps the last chord."""
    spans = [
        (bar, offset + start + onset, length)
        for bar, (start, meter) in enumerate(zip(bar_starts, meters, strict=True))
        for onset, length in groups(meter)
    ]
    decisions: list[tuple[str, int, tuple] | None] = []
    for _, lo, length in spans:
        hi = lo + length
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
    per_bar: list[list[ChordSegment]] = [[] for _ in bar_starts]
    for (bar, lo, length), (symbol, root, tones) in zip(spans, filled, strict=True):
        segments = per_bar[bar]
        onset = lo - offset - bar_starts[bar]
        if segments and segments[-1].symbol == symbol:
            last = segments[-1]
            segments[-1] = ChordSegment(symbol, root, tones, last.onset, last.duration + length)
        else:
            segments.append(ChordSegment(symbol, root, tones, onset, length))
    return per_bar
