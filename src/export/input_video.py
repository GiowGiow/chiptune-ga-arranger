"""Render the original input as a scrolling "vision test" video, in the style of `piece.mp4`.

The listening page shows the input next to the 8-bit arrangement. To compare them by eye as well
as by ear, the input gets the same picture as the arrangement (see `export.video`): glowing notes
on a dark background, a window that scrolls with the playhead at 75% of the width, and drum hits
that flash in a band at the bottom.

The input is not in NES format. It has many instrument tracks, and each track can play chords, so
a step line (one pitch at a time) would not fit. Here every note is a short horizontal glowing
segment from its onset to its end, as in a piano roll, and each instrument track is one color.
The melody track that the genetic algorithm arranged is drawn in the P1 color and brighter; the
other tracks are muted, so the eye finds the melody first, as in the arrangement. A song with many
tracks keeps its busiest ones and merges the rest into one "other" layer, so the legend stays
short enough to read.

For a MIDI song, `input.mp3` is an excerpt (the bars that were arranged), so the notes are shifted
by the excerpt start: time 0 of the video is the first sound of the audio.
"""

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi
from matplotlib.axes import Axes
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D

from export.video import (
    DRUM_COLOR,
    GLOW_LAYERS,
    PLAYHEAD_FRACTION,
    TIP_LAYERS,
    add_drum_marks,
    dark_figure,
    draw_colored_title,
    encode_frames,
    lighten,
    update_drum_marks,
    video_tools_ready,
)

MELODY_COLOR = "#5F9ED1"  # the P1 color of the arrangement video
# The other bright members of tableau-colorblind10, one per accompaniment track, then grey for
# the merged "other" layer. The light blue (#A2C8EC) is left out: next to the melody blue, the
# two would read as one part.
TRACK_COLORS = ("#FF800E", "#CFCFCF", "#C85200", "#ABABAB")
OTHER_COLOR = "#898989"
# Accompaniment glows narrower and dimmer than the melody, so many chord notes do not blur into
# one cloud and the melody stays in front.
ACCOMPANIMENT_GLOW = ((16.0, 0.03, 0.0), (9.0, 0.06, 0.0), (5.0, 0.13, 0.0), (2.6, 0.45, 0.0))
ACCOMPANIMENT_TIP_SCALE = 0.55
# General MIDI drum keys: kicks on the bottom row, snares and claps in the middle, the rest
# (hi-hats, cymbals, toms, percussion) on top.
KICKS, SNARES = {35, 36}, {37, 38, 39, 40}
# Video encoder quality: a little lower than the default (CRF 23) keeps a busy song under 5 MB.
INPUT_VIDEO_OPTIONS = ("-crf", "26")


@dataclass
class NoteLayer:
    """One instrument track as drawn: its legend label, color and notes (start, end, pitch)."""

    label: str
    color: str
    notes: np.ndarray
    is_melody: bool = False


def excerpt_notes(notes: np.ndarray, start: float, end: float) -> np.ndarray:
    """Keep the notes that sound between `start` and `end`, in seconds from `start`.

    `notes` has one row (start, end, pitch) per note. A note that sounds across an edge of the
    excerpt is cut at that edge, as the audio excerpt cuts it.

    >>> excerpt_notes(np.array([[1.0, 3.0, 60.0], [4.0, 5.0, 62.0]]), start=2.0, end=4.5)
    array([[ 0. ,  1. , 60. ],
           [ 2. ,  2.5, 62. ]])
    """
    inside = (notes[:, 0] < end) & (notes[:, 1] > start)
    shown = notes[inside].copy()
    shown[:, :2] = np.clip(shown[:, :2], start, end) - start
    return shown


def drum_row(pitch: int) -> int:
    """Return the drum-band row of a General MIDI drum key: 0 kick, 1 snare, 2 anything else.

    >>> drum_row(36), drum_row(40), drum_row(42)
    (0, 1, 2)
    """
    return 0 if pitch in KICKS else 1 if pitch in SNARES else 2


def _note_array(notes: Sequence[pretty_midi.Note]) -> np.ndarray:
    rows = [(note.start, note.end, note.pitch) for note in notes]
    return np.array(rows, dtype=float).reshape(-1, 3)


def note_layers(
    midi: pretty_midi.PrettyMIDI,
    melody_tracks: int | Sequence[int],
    start: float = 0.0,
    end: float | None = None,
    max_tracks: int = 5,
) -> tuple[list[NoteLayer], np.ndarray]:
    """Split the excerpt of a song into note layers and drum hits (onset, General MIDI key).

    The melody comes first; the other pitched tracks follow by the number of notes they play in
    the excerpt, up to `max_tracks` layers in all, and the quieter rest is merged into "other".
    Labels are General MIDI instrument names, because the track names of downloaded files are
    often the song title; a name that repeats gets a number.
    """
    end = midi.get_end_time() if end is None else end
    melody_set = {melody_tracks} if isinstance(melody_tracks, int) else set(melody_tracks)
    melody, accompaniment, drums = [], [], []
    for index, track in enumerate(midi.instruments):
        notes = excerpt_notes(_note_array(track.notes), start, end)
        if track.is_drum:
            drums.append(notes)
        elif index in melody_set:
            melody.append(notes)
        elif len(notes):
            accompaniment.append((track.program, notes))
    # A stable sort keeps the file order among tracks with the same number of notes.
    accompaniment.sort(key=lambda program_notes: -len(program_notes[1]))
    kept, merged = accompaniment[: max_tracks - 1], accompaniment[max_tracks - 1 :]

    names = [pretty_midi.program_to_instrument_name(program) for program, _ in kept]
    repeats, seen = Counter(names), Counter()
    layers = []
    if melody:
        melody_program = midi.instruments[min(melody_set)].program
        label = f"Melody ({pretty_midi.program_to_instrument_name(melody_program)})"
        layers.append(NoteLayer(label, MELODY_COLOR, np.concatenate(melody), is_melody=True))
    for name, (_, notes), color in zip(names, kept, TRACK_COLORS, strict=False):
        seen[name] += 1
        label = f"{name} {seen[name]}" if repeats[name] > 1 else name
        layers.append(NoteLayer(label, color, notes))
    if merged:
        notes = np.concatenate([notes for _, notes in merged])
        layers.append(NoteLayer("other", OTHER_COLOR, notes))

    hits = np.concatenate(drums) if drums else np.zeros((0, 3))
    drum_hits = hits[np.argsort(hits[:, 0], kind="stable")][:, [0, 2]]
    return layers, drum_hits


@dataclass
class InputScene:
    """The figure of the input video and the artists that each frame updates."""

    canvas: FigureCanvasAgg
    pitch_axes: Axes
    layers: list[NoteLayer]
    glow_segments: list[list[LineCollection]]
    tip_dots: list[list[Line2D]]
    drum_onsets: np.ndarray
    drum_rows: np.ndarray
    drum_marks: list[LineCollection]
    window_seconds: float


def build_input_scene(
    midi: pretty_midi.PrettyMIDI,
    melody_tracks: int | Sequence[int],
    start: float = 0.0,
    end: float | None = None,
    width: int = 1280,
    height: int = 720,
    window_seconds: float = 10.0,
) -> InputScene:
    """Build the dark figure with one glowing note layer per track, the drum band and legend."""
    layers, drum_hits = note_layers(midi, melody_tracks, start, end)
    figure, canvas, pitch_axes, drum_axes = dark_figure(width, height)
    pitches = np.concatenate([layer.notes[:, 2] for layer in layers] or [np.zeros(0)])
    low, high = (pitches.min(), pitches.max()) if len(pitches) else (48.0, 84.0)
    pitch_axes.set_ylim(low - 3, high + 3)

    glow_segments, tip_dots = [], []
    # Accompaniment first, so the melody is drawn on top of it.
    for layer in sorted(layers, key=lambda layer: layer.is_melody):
        glow = GLOW_LAYERS if layer.is_melody else ACCOMPANIMENT_GLOW
        tip_scale = 1.0 if layer.is_melody else ACCOMPANIMENT_TIP_SCALE
        glow_segments.append(
            [
                pitch_axes.add_collection(
                    LineCollection([], linewidths=lw, colors=[lighten(layer.color, whiteness)],
                                   alpha=alpha, capstyle="round")
                )
                for lw, alpha, whiteness in glow
            ]
        )  # fmt: skip
        tip_dots.append(
            [
                pitch_axes.plot(
                    [], [], "o", color=lighten(layer.color, whiteness), alpha=alpha,
                    markersize=size * tip_scale, markeredgewidth=0, linestyle="none",
                )[0]
                for size, alpha, whiteness in TIP_LAYERS
            ]
        )  # fmt: skip
    legend = [(layer.label, layer.color) for layer in layers]
    if len(drum_hits):
        legend.append(("drums", DRUM_COLOR))
    draw_colored_title(figure, canvas, legend, fontsize=12, top=0.965)
    return InputScene(
        canvas=canvas,
        pitch_axes=pitch_axes,
        layers=sorted(layers, key=lambda layer: layer.is_melody),
        glow_segments=glow_segments,
        tip_dots=tip_dots,
        drum_onsets=drum_hits[:, 0].copy(),
        drum_rows=np.array([drum_row(int(key)) for key in drum_hits[:, 1]], dtype=float),
        drum_marks=add_drum_marks(drum_axes),
        window_seconds=window_seconds,
    )


def input_frame_at(scene: InputScene, t: float) -> np.ndarray:
    """Draw the frame at time `t` (seconds from the excerpt start) as an RGB uint8 array."""
    left = t - PLAYHEAD_FRACTION * scene.window_seconds
    scene.pitch_axes.set_xlim(left, left + scene.window_seconds)
    for layer, glow, tips in zip(scene.layers, scene.glow_segments, scene.tip_dots, strict=True):
        starts, ends, pitches = layer.notes.T
        # A note is drawn from its onset up to the playhead (or its end, when it has ended).
        shown = (starts <= t) & (ends >= left)
        segment_ends = np.minimum(ends[shown], t)
        segments = np.stack(
            [
                np.column_stack([starts[shown], pitches[shown]]),
                np.column_stack([segment_ends, pitches[shown]]),
            ],
            axis=1,
        )
        for collection in glow:
            collection.set_segments(segments)
        sounding = pitches[(starts <= t) & (ends > t)]
        for dot in tips:
            dot.set_data(np.full(len(sounding), t), sounding)
    update_drum_marks(scene.drum_marks, scene.drum_onsets, scene.drum_rows, left, t)
    scene.canvas.draw()
    return np.asarray(scene.canvas.buffer_rgba())[:, :, :3].copy()


def render_input_video(
    mid_path: Path | str,
    audio_path: Path | str,
    mp4_path: Path | str,
    melody_tracks: int | Sequence[int],
    start_seconds: float = 0.0,
    end_seconds: float | None = None,
    fps: int = 30,
    width: int = 1280,
    height: int = 720,
    window_seconds: float = 10.0,
) -> bool:
    """Render the input song (or its excerpt) as a glowing-note video with its audio, to MP4.

    `start_seconds` and `end_seconds` must be the cut of the audio file, so that picture and
    sound stay in sync, and the video lasts exactly as long as that cut. Without `end_seconds`,
    the whole file is drawn and the video lasts one second more, for the synthesizer's release
    (cut to the audio if that is shorter). Return False, with a notice, when ffmpeg or the audio
    file is missing.
    """
    if not video_tools_ready(audio_path):
        return False
    midi = pretty_midi.PrettyMIDI(str(mid_path))
    # ffmpeg's `-shortest` trims a piped video only roughly, so the excerpt sets the frame count.
    release = 1.0 if end_seconds is None else 0.0
    end_seconds = midi.get_end_time() if end_seconds is None else end_seconds
    scene = build_input_scene(midi, melody_tracks, start_seconds, end_seconds, width, height,
                              window_seconds)  # fmt: skip
    frame_count = math.ceil((end_seconds - start_seconds + release) * fps)
    encode_frames(lambda t: input_frame_at(scene, t), frame_count, audio_path, mp4_path, fps,
                  width, height, video_options=INPUT_VIDEO_OPTIONS)  # fmt: skip
    return True
