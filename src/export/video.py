"""Render a piece as a scrolling "vision test" video, in sync with its audio.

The look follows Vulfpeck's "Bach Vision Test" videos: each voice is a glowing line of pitch over
time that is drawn while the music plays, so the eye can follow the parts as they move against
each other. Here the three pitched NES channels (P1 melody, P2 harmony, TR bass) are three step
lines, as in the piano roll, and the NO drum hits flash as short marks in a band at the bottom.

How one frame is made: the view shows a window of a few seconds, with the playhead at 75% of the
width, so the recent past stays visible while the view scrolls (a 5-minute piece works as well
as a short one). Each line is cut at the current time (`visible_until`) and a bright dot marks
its tip while its note sounds (`sounding_pitch`). The glow is the neon-sign trick: the same line
drawn several times, wide and faint underneath, narrow and bright on top.

The figure is built once on matplotlib's Agg canvas; each frame only moves the line data and the
x-limits, and the raw RGB pixels go through a pipe to ffmpeg, which adds the audio and writes MP4.
"""

import math
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pretty_midi
from matplotlib.axes import Axes
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.collections import LineCollection
from matplotlib.colors import to_rgb, to_rgba
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

from arrangement.model import ChannelNote
from export.figures import DRUM_ROWS, PITCHED_CHANNELS, step_line

BACKGROUND = "#0B0E17"
# The brightest members of tableau-colorblind10, so the lines stand out on the dark background.
CHANNEL_COLORS = {"P1": "#5F9ED1", "P2": "#FF800E", "TR": "#CFCFCF"}
DRUM_COLOR = "#FFBC79"
CHANNEL_NAMES = {"P1": "P1 melody", "P2": "P2 harmony", "TR": "TR bass", "NO": "NO drums"}
PLAYHEAD_FRACTION = 0.75
# AAC rate of the video soundtrack, high enough to sound like the source MP3.
AUDIO_BITRATE = "192k"
LEGEND_SEPARATOR = "  ·  "

# Glow layers as (width in points, opacity, whiteness), from the wide faint halo to the narrow
# core, which is mixed with white to look hot. Points are relative to the frame (the dpi follows
# the width), so a smaller frame keeps the same look.
GLOW_LAYERS = ((30.0, 0.04, 0.0), (19.0, 0.08, 0.0), (11.0, 0.16, 0.0), (5.5, 0.45, 0.05),
               (2.4, 1.0, 0.2))  # fmt: skip
TIP_LAYERS = ((36.0, 0.1, 0.0), (22.0, 0.25, 0.0), (12.0, 0.55, 0.2), (6.0, 1.0, 0.75))
DRUM_LAYERS = ((16.0, 0.14, 0.0), (8.0, 0.35, 0.0), (2.8, 1.0, 0.4))
# A drum mark is brightest at its onset and fades to a dim trace within a fraction of a second.
FLASH_SECONDS = 0.18
DRUM_TRACE_BRIGHTNESS = 0.4


def lighten(color: str, amount: float) -> tuple[float, float, float]:
    """Mix `color` with white; `amount` 0 keeps the color, 1 gives white.

    >>> lighten("#000000", 0.5)
    (0.5, 0.5, 0.5)
    """
    return tuple(c + (1.0 - c) * amount for c in to_rgb(color))


def channel_paths(midi: pretty_midi.PrettyMIDI) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Return the step-line points (x in seconds, y in MIDI pitch, NaN at rests) of P1, P2, TR.

    A channel missing from the file gets empty arrays.
    """
    tracks = {track.name: track for track in midi.instruments}
    paths = {}
    for channel in PITCHED_CHANNELS:
        track_notes = tracks[channel].notes if channel in tracks else []
        # step_line only needs onsets and durations in one unit; here that unit is seconds.
        notes = [ChannelNote(n.pitch, n.start, n.end - n.start, n.velocity) for n in track_notes]
        xs, ys = step_line(notes)
        paths[channel] = (np.asarray(xs, dtype=float), np.asarray(ys, dtype=float))
    return paths


def visible_until(
    x: np.ndarray, y: np.ndarray, t: float, start: float = -np.inf
) -> tuple[np.ndarray, np.ndarray]:
    """Cut a step line to the part between `start` and time `t`, as seen at time `t`.

    The note sounding at `t` is drawn only up to `t`; later notes are hidden. The last point at
    or before `start` is kept, so a note that began before the window enters it from the left.

    >>> x, y = np.array([0.0, 1.0, 2.0, 3.0]), np.array([60.0, np.nan, 62.0, 62.0])
    >>> visible_until(x, y, 2.5)
    (array([0. , 1. , 2. , 2.5]), array([60., nan, 62., 62.]))
    >>> visible_until(x, y, 2.5, start=2.2)
    (array([2. , 2.5]), array([62., 62.]))
    """
    current = np.searchsorted(x, t, side="right") - 1
    if current < 0:
        return x[:0], y[:0]
    first = max(int(np.searchsorted(x, start, side="right")) - 1, 0)
    if current == len(x) - 1:
        # The piece has ended for this channel: the path stops where its last note stops.
        return x[first:], y[first:]
    return np.append(x[first : current + 1], t), np.append(y[first : current + 1], y[current])


def sounding_pitch(x: np.ndarray, y: np.ndarray, t: float) -> float:
    """Return the MIDI pitch a step line plays at time `t`, or NaN when it is silent.

    >>> x, y = np.array([0.0, 1.0, 2.0, 3.0]), np.array([60.0, np.nan, 62.0, 62.0])
    >>> sounding_pitch(x, y, 0.5), sounding_pitch(x, y, 1.5), sounding_pitch(x, y, 3.0)
    (60.0, nan, nan)
    """
    current = np.searchsorted(x, t, side="right") - 1
    if current < 0 or current >= len(x) - 1:
        return math.nan
    return float(y[current])


@dataclass
class VideoScene:
    """The figure of the video and the artists that each frame updates, built once per piece."""

    canvas: FigureCanvasAgg
    pitch_axes: Axes
    paths: dict[str, tuple[np.ndarray, np.ndarray]]
    glow_lines: dict[str, list[Line2D]]
    tip_dots: dict[str, list[Line2D]]
    drum_onsets: np.ndarray
    drum_rows: np.ndarray
    drum_marks: list[LineCollection]
    window_seconds: float


def build_scene(
    midi: pretty_midi.PrettyMIDI, width: int, height: int, window_seconds: float = 10.0
) -> VideoScene:
    """Build the dark figure with one glowing line per pitched channel and the drum band."""
    paths = channel_paths(midi)
    figure, canvas, pitch_axes, drum_axes = dark_figure(width, height)

    pitches = np.concatenate([y for _, y in paths.values()])
    pitches = pitches[~np.isnan(pitches)]
    low, high = (pitches.min(), pitches.max()) if len(pitches) else (48.0, 84.0)
    pitch_axes.set_ylim(low - 3, high + 3)

    glow_lines, tip_dots = {}, {}
    for channel in PITCHED_CHANNELS:
        color = CHANNEL_COLORS[channel]
        glow_lines[channel] = [
            pitch_axes.plot(
                [], [], drawstyle="steps-post", color=lighten(color, whiteness), lw=lw,
                alpha=alpha, solid_capstyle="round", solid_joinstyle="round",
            )[0]
            for lw, alpha, whiteness in GLOW_LAYERS
        ]  # fmt: skip
        tip_dots[channel] = [
            pitch_axes.plot(
                [], [], "o", color=lighten(color, whiteness), markersize=size, alpha=alpha,
                markeredgewidth=0,
            )[0]
            for size, alpha, whiteness in TIP_LAYERS
        ]  # fmt: skip

    drum_track = next((track for track in midi.instruments if track.name == "NO"), None)
    hits = sorted((note.start, note.pitch) for note in drum_track.notes) if drum_track else []
    drum_onsets = np.array([onset for onset, _ in hits], dtype=float)
    drum_rows = np.array([DRUM_ROWS.get(pitch, (2, "other"))[0] for _, pitch in hits], dtype=float)
    drum_marks = add_drum_marks(drum_axes)
    colors = {**CHANNEL_COLORS, "NO": DRUM_COLOR}
    draw_colored_title(
        figure, canvas, [(CHANNEL_NAMES[channel], colors[channel]) for channel in colors]
    )
    return VideoScene(
        canvas=canvas,
        pitch_axes=pitch_axes,
        paths=paths,
        glow_lines=glow_lines,
        tip_dots=tip_dots,
        drum_onsets=drum_onsets,
        drum_rows=drum_rows,
        drum_marks=drum_marks,
        window_seconds=window_seconds,
    )


def dark_figure(width: int, height: int) -> tuple[Figure, FigureCanvasAgg, Axes, Axes]:
    """Return the dark figure of a video frame, its canvas, the pitch axes and the drum band.

    Both axes span the full width, so the playhead at 75% of the axes is at 75% of the frame, and
    the faint playhead line is drawn once here, since it never moves.
    """
    # 100 dpi for a 1280-pixel frame; other widths change the dpi, so sizes in points keep the look.
    dpi = 100 * width / 1280
    # Half a pixel of slack, because the Agg canvas truncates the figure size to whole pixels.
    figure = Figure(figsize=((width + 0.5) / dpi, (height + 0.5) / dpi), dpi=dpi)
    figure.set_facecolor(BACKGROUND)
    canvas = FigureCanvasAgg(figure)
    pitch_axes = figure.add_axes((0.0, 0.2, 1.0, 0.7))
    drum_axes = figure.add_axes((0.0, 0.03, 1.0, 0.13), sharex=pitch_axes)
    for axes in (pitch_axes, drum_axes):
        axes.set_axis_off()
    drum_axes.set_ylim(-0.8, 2.8)
    figure.add_artist(
        Line2D(
            [PLAYHEAD_FRACTION, PLAYHEAD_FRACTION], [0.02, 0.92], transform=figure.transFigure,
            color="white", alpha=0.18, lw=1.2,
        )
    )  # fmt: skip
    return figure, canvas, pitch_axes, drum_axes


def legend_lines(
    item_widths: Sequence[float], separator_width: float, line_width: float
) -> list[list[int]]:
    """Split the legend items into lines, as lists of item indices, filling each line greedily.

    The separator before an item counts as part of that item: an item that does not fit together
    with its separator starts the next line, and the separator is dropped at the break. So a
    separator always sits between two items of the same line, never at a line's start or end. An
    item wider than the whole line still gets a line of its own.

    >>> legend_lines([3.0, 3.0, 3.0], separator_width=1.0, line_width=8.0)
    [[0, 1], [2]]
    """
    lines: list[list[int]] = []
    used = 0.0
    for index, width in enumerate(item_widths):
        if lines and used + separator_width + width <= line_width:
            lines[-1].append(index)
            used += separator_width + width
        else:
            lines.append([index])
            used = width
    return lines


def draw_colored_title(
    figure: Figure,
    canvas: FigureCanvasAgg,
    names: Sequence[tuple[str, str]],
    fontsize: float = 15,
    top: float = 0.955,
) -> None:
    """Write the (name, color) pairs as "name · name · ...", each name in its own color.

    A name that would run past the right edge starts a new line below, without the separator
    before it, so no line starts or ends with a separator (see `legend_lines`).
    """
    pieces = []
    for name, color in names:
        pieces += [(name, color), (LEGEND_SEPARATOR, "#8A8F99")]
    renderer = canvas.get_renderer()
    # Matplotlib has no multicolor text, so each piece starts where the previous one ends. All
    # pieces go on one line first, to measure them; a legend that fits keeps exactly this layout.
    artists, widths, x = [], [], 0.02
    for text, color in pieces[:-1]:
        artists.append(
            figure.text(x, top, text, color=color, fontsize=fontsize, va="center", weight="bold")
        )
        widths.append(artists[-1].get_window_extent(renderer).width / figure.bbox.width)
        x += widths[-1]
    separator_width = widths[1] if len(widths) > 1 else 0.0
    lines = legend_lines(widths[::2], separator_width, line_width=0.96)
    if len(lines) <= 1:
        return
    line_height = 1.6 * fontsize / 72 * figure.dpi / figure.bbox.height
    for line_number, line in enumerate(lines):
        x, y = 0.02, top - line_number * line_height
        if line_number:
            # Item i sits at piece 2i, and the separator before it at piece 2i - 1.
            artists[2 * line[0] - 1].remove()
        for position, item in enumerate(line):
            for piece in ([2 * item - 1] if position else []) + [2 * item]:
                artists[piece].set_position((x, y))
                x += widths[piece]


def add_drum_marks(drum_axes: Axes) -> list[LineCollection]:
    """Add the glow layers of the drum marks, empty until `update_drum_marks` fills them."""
    return [
        drum_axes.add_collection(LineCollection([], linewidths=lw, capstyle="round"))
        for lw, _, _ in DRUM_LAYERS
    ]


def update_drum_marks(
    marks: list[LineCollection], onsets: np.ndarray, rows: np.ndarray, left: float, t: float
) -> None:
    """Show the drum hits between `left` and time `t`, each flashing at its onset, then fading."""
    first, last = np.searchsorted(onsets, [left, t], side="right")
    onsets, rows = onsets[first:last], rows[first:last]
    flash = np.exp(-(t - onsets) / FLASH_SECONDS)
    brightness = DRUM_TRACE_BRIGHTNESS + (1 - DRUM_TRACE_BRIGHTNESS) * flash
    # A fresh hit is also taller, so it reads as a flash even in peripheral vision.
    half_height = 0.3 + 0.25 * flash
    segments = np.stack(
        [
            np.column_stack([onsets, rows - half_height]),
            np.column_stack([onsets, rows + half_height]),
        ],
        axis=1,
    )
    for collection, (_, alpha, whiteness) in zip(marks, DRUM_LAYERS, strict=True):
        colors = np.tile(to_rgba(lighten(DRUM_COLOR, whiteness)), (len(onsets), 1))
        colors[:, 3] = alpha * brightness
        collection.set_segments(segments)
        collection.set_color(colors)


def frame_at(scene: VideoScene, t: float) -> np.ndarray:
    """Draw the frame at time `t` (seconds) as an RGB uint8 array of shape (height, width, 3)."""
    left = t - PLAYHEAD_FRACTION * scene.window_seconds
    scene.pitch_axes.set_xlim(left, left + scene.window_seconds)
    for channel, (x, y) in scene.paths.items():
        shown_x, shown_y = visible_until(x, y, t, start=left)
        for line in scene.glow_lines[channel]:
            line.set_data(shown_x, shown_y)
        pitch = sounding_pitch(x, y, t)
        tip = ([], []) if math.isnan(pitch) else ([t], [pitch])
        for dot in scene.tip_dots[channel]:
            dot.set_data(*tip)

    update_drum_marks(scene.drum_marks, scene.drum_onsets, scene.drum_rows, left, t)

    scene.canvas.draw()
    return np.asarray(scene.canvas.buffer_rgba())[:, :, :3].copy()


def render_video(
    mid_path: Path | str,
    audio_path: Path | str,
    mp4_path: Path | str,
    fps: int = 30,
    width: int = 1280,
    height: int = 720,
    window_seconds: float = 10.0,
) -> bool:
    """Render the MIDI file as a scrolling glowing-line video with the audio, written to MP4.

    The video lasts until the end of the MIDI file plus one second (cut to the audio if that is
    shorter). Return False, with a notice, when ffmpeg or the audio file is missing.
    """
    if not video_tools_ready(audio_path):
        return False
    midi = pretty_midi.PrettyMIDI(str(mid_path))
    scene = build_scene(midi, width, height, window_seconds)
    frame_count = math.ceil((midi.get_end_time() + 1.0) * fps)
    encode_frames(lambda t: frame_at(scene, t), frame_count, audio_path, mp4_path, fps, width,
                  height)  # fmt: skip
    return True


def video_tools_ready(audio_path: Path | str) -> bool:
    """Return True when ffmpeg and the audio file exist; else print a notice and return False."""
    missing = [] if shutil.which("ffmpeg") else ["ffmpeg"]
    if not Path(audio_path).exists():
        missing.append(f"audio {audio_path}")
    if missing:
        print(f"video skipped: missing {', '.join(missing)}", file=sys.stderr)
    return not missing


def encode_frames(
    draw_frame: Callable[[float], np.ndarray],
    frame_count: int,
    audio_path: Path | str,
    mp4_path: Path | str,
    fps: int,
    width: int,
    height: int,
    video_options: Sequence[str] = (),
) -> None:
    """Pipe `frame_count` frames, drawn at times 0, 1/fps, ..., to ffmpeg, which adds the audio.

    `-shortest` ends the video with the audio when the audio is shorter. `video_options` are
    extra encoder flags, for example a CRF that trades quality for a smaller file. The audio is
    encoded at AUDIO_BITRATE: ffmpeg's default AAC rate is low for mono input (about 69 kbit/s),
    and the chip's bright square waves then sound noticeably worse than the MP3 they come from.
    """
    command = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
        "-i", str(audio_path),
        "-c:v", "libx264", *video_options, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-shortest",
        str(mp4_path),
    ]  # fmt: skip
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        try:
            for index in range(frame_count):
                encoder.stdin.write(draw_frame(index / fps).tobytes())
        except BrokenPipeError:
            pass  # ffmpeg stopped early; its exit code below reports why
    if encoder.returncode != 0:
        raise subprocess.CalledProcessError(encoder.returncode, command)
