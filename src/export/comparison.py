"""Join the three versions of a sample in one short MP4 that a README can play inline.

A reader of the README should hear what the arranger did without downloading anything: first
the input (`input.mp3`), then the generated arrangement played by General MIDI instruments
(`piece.mp3`), then the same arrangement on the NES chip synthesizer (`piece-chip.mp3`). During
the first part the picture is a still card with the waveform of the input and a playhead that
sweeps over it; during the other two it is the "vision test" video of the arrangement
(`piece.mp4`, see `export.video`), with a label that names what is playing.

GitHub plays a video inline only when it is uploaded as an attachment of at most 10 MB, so the
whole file must fit a byte budget, and the budget fixes the bitrate: bits = seconds x (audio
bitrate + video bitrate). Two choices follow from it:

- Duration. Each version plays whole when the three fit at the lowest acceptable video bitrate.
  When they do not, the long segments are cut to one common length L, chosen so that the cut
  total matches the maximum. This is "water-filling": pour the time budget into the segments
  like water into glasses of different heights; short segments fill up and stay whole, long
  ones are cut at the water level L.
- Resolution. The video bitrate left after the audio is spread over the pixels of each frame. A
  frame needs a minimum number of bits per pixel to stay sharp; below it, a smaller frame looks
  better than a blurry large one, so the largest size that keeps enough bits per pixel wins.

ffmpeg does the rest in one filter graph: it scales each part, pads or trims it to its audio
length, joins the three parts and encodes H.264 in two passes. The first pass measures how hard
each frame is to compress, so the second can move bits from the still card to the moving parts
and land close to the target size. `+faststart` moves the index of the file (the `moov` atom)
to the front, so a browser can start playing while it downloads.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import NamedTuple

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.colors import to_rgb
from matplotlib.figure import Figure
from matplotlib.image import imsave

from export.video import BACKGROUND, CHANNEL_COLORS

# Below GitHub's 10 MB attachment limit, with room for the error of the encoder's size control.
DEFAULT_BUDGET_BYTES = 9_500_000
# The audio bitrate adapts to the length (choose_audio_kbps): 192 kbit/s for short videos,
# never under 128; the picture keeps at least VIDEO_FLOOR_KBPS when the budget allows.
AUDIO_KBPS_LOW = 128
AUDIO_KBPS_HIGH = 192
VIDEO_FLOOR_KBPS = 120
MIN_VIDEO_KBPS = 80
# Share of the file taken by the MP4 container (index, headers) rather than by audio and video.
CONTAINER_OVERHEAD = 0.02
# Candidate frame sizes, largest first, all 16:9 like piece.mp4 (1280x720).
FRAME_SIZES = ((1280, 720), (960, 540), (854, 480), (640, 360))
MIN_BITS_PER_PIXEL = 0.009
# The still first segment costs almost no bits, so the two-pass encoder gives its share to the
# moving segments: they get about 1.5 times the average video bitrate.
MOVING_SHARE = 1.5
# At these low bitrates a slower preset gives visibly sharper lines for the same file size.
X264_PRESET = "slow"
# When the file still comes out too large, the next try asks for 7% less video bitrate.
SHRINK_STEP = 0.93
MAX_TRIES = 3

SEGMENT_AUDIO = ("input.mp3", "piece.mp3", "piece-chip.mp3")
SEGMENT_LABELS = (
    ("Original input", "input.mp3: the input rendered with General MIDI"),
    ("Generated · General MIDI", "piece.mp3"),
    ("Generated · NES chip", "piece-chip.mp3"),
)
WAVEFORM_COLOR = CHANNEL_COLORS["TR"]
HEADING_COLOR = "white"
DETAIL_COLOR = "#A3A8B3"
# The envelope only needs one value per pixel column, so a low decoding rate is plenty.
ENVELOPE_RATE = 11025
# Words kept in lower case inside a title made from a folder name ("mulher-de-fases").
MINOR_WORDS = {"a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "and", "of", "the"}


class PixelBox(NamedTuple):
    """A rectangle in frame pixels, with the origin at the top-left corner of the frame."""

    left: int
    top: int
    right: int
    bottom: int


def fit_lengths(durations: Sequence[float], max_total: float) -> list[float]:
    """Cut the segment durations (seconds) so that their sum is at most `max_total`.

    When they already fit they come back unchanged. Otherwise every segment longer than a
    common length L is cut to L (it plays its first L seconds), with L chosen so that the sum
    is exactly `max_total` (water-filling).

    >>> fit_lengths([50.0, 60.0], max_total=200.0)
    [50.0, 60.0]
    >>> fit_lengths([100.0, 120.0, 30.0], max_total=150.0)
    [60.0, 60.0, 30.0]
    """
    if sum(durations) <= max_total:
        return [float(duration) for duration in durations]
    remaining = max_total
    ordered = sorted(durations)
    for index, duration in enumerate(ordered):
        segments_left = len(ordered) - index
        # Once this segment no longer fits whole, the rest share what is left equally.
        if duration * segments_left >= remaining:
            cut = remaining / segments_left
            break
        remaining -= duration
    return [min(float(duration), cut) for duration in durations]


def max_total_seconds(
    budget_bytes: int,
    audio_kbps: float,
    min_video_kbps: float,
    overhead: float = CONTAINER_OVERHEAD,
) -> float:
    """Return the longest video (seconds) that fits the budget at the lowest video bitrate.

    >>> round(max_total_seconds(9_500_000, audio_kbps=96, min_video_kbps=80), 1)
    423.2
    """
    return budget_bytes * 8 * (1 - overhead) / ((audio_kbps + min_video_kbps) * 1000)


def choose_audio_kbps(
    total_seconds: float,
    budget_bytes: int,
    video_floor_kbps: float = VIDEO_FLOOR_KBPS,
    low: float = AUDIO_KBPS_LOW,
    high: float = AUDIO_KBPS_HIGH,
    overhead: float = CONTAINER_OVERHEAD,
) -> float:
    """Return the AAC bitrate (kbit/s): as high as the budget allows after the video's floor.

    The listener compares sound, so the audio gets the bits first: up to `high` (transparent for
    these MP3 sources) while the picture keeps `video_floor_kbps`, and never less than `low`.

    >>> choose_audio_kbps(154.0, 9_500_000), choose_audio_kbps(354.0, 9_500_000)
    (192, 128)
    """
    total_kbps = budget_bytes * 8 * (1 - overhead) / total_seconds / 1000
    return max(low, min(high, total_kbps - video_floor_kbps))


def choose_video(
    total_seconds: float,
    budget_bytes: int,
    audio_kbps: float,
    fps: int = 30,
    overhead: float = CONTAINER_OVERHEAD,
) -> tuple[float, int, int]:
    """Return (video kbps, width, height) for a video of `total_seconds` within the budget.

    The video bitrate is what the budget leaves after the audio. The frame is the largest of
    `FRAME_SIZES` whose moving parts still get `MIN_BITS_PER_PIXEL` bits per pixel per frame.

    >>> choose_video(354.0, 9_500_000, audio_kbps=96)[1:]
    (960, 540)
    """
    video_kbps = budget_bytes * 8 * (1 - overhead) / total_seconds / 1000 - audio_kbps
    for width, height in FRAME_SIZES:
        if video_kbps * 1000 * MOVING_SHARE / (width * height * fps) >= MIN_BITS_PER_PIXEL:
            return video_kbps, width, height
    width, height = FRAME_SIZES[-1]
    return video_kbps, width, height


def waveform_envelope(samples: np.ndarray, columns: int) -> np.ndarray:
    """Return the peak level of the audio in each of `columns` equal slices, scaled to max 1.

    One value per pixel column is all a waveform drawing can show; the peak (rather than the
    average) keeps short loud notes visible.

    >>> waveform_envelope(np.array([0.1, -0.2, 0.0, 0.4]), columns=2)
    array([0.5, 1. ])
    """
    magnitude = np.abs(np.asarray(samples, dtype=float))
    peaks = np.array([chunk.max(initial=0.0) for chunk in np.array_split(magnitude, columns)])
    loudest = peaks.max(initial=0.0)
    return peaks / loudest if loudest > 0 else peaks


def sample_title(folder_name: str, config: dict) -> str:
    """Return the title of a sample: the config's `title`, else the folder name made readable.

    >>> sample_title("korobeiniki-s1", {})
    'Korobeiniki (s1)'
    >>> sample_title("mulher-de-fases-s1", {})
    'Mulher de Fases (s1)'
    """
    if config.get("title"):
        return str(config["title"])
    # Sample folders are "<song>-s<seed>[-<variant>]"; the seed part goes in parentheses.
    match = re.fullmatch(r"(.+?)-(s\d+.*)", folder_name)
    song, variant = match.groups() if match else (folder_name, "")
    words = song.replace("_", "-").split("-")
    title = " ".join(
        word if index > 0 and word in MINOR_WORDS else word.capitalize()
        for index, word in enumerate(words)
    )
    return f"{title} ({variant})" if variant else title


def playhead_image(height: int) -> np.ndarray:
    """Return the playhead as an RGBA uint8 image: a white line, a dark outline and a glow.

    A white line alone disappears over the light waveform, and a dark one over the dark
    background; the white core with a dark outline reads on both. The soft white halo outside
    the outline gives the neon look of `export.video` on the dark background.
    """
    core, outline, halo = 1, 2, 6  # half-width of the core, then outline and halo, in pixels
    distance = np.abs(np.arange(-(core + outline + halo), core + outline + halo + 1))
    beyond_outline = distance - core - outline
    opacity = np.where(beyond_outline <= 0, 1.0, 0.35 * (1 - beyond_outline / (halo + 1)) ** 2)
    image = np.full((height, len(distance), 4), 255, dtype=np.uint8)
    image[:, :, 3] = np.round(opacity * 255).astype(np.uint8)
    in_outline = (distance > core) & (beyond_outline <= 0)
    image[:, in_outline, :3] = np.round(np.array(to_rgb(BACKGROUND)) * 255).astype(np.uint8)
    return image


def _frame_figure(width: int, height: int, facecolor: str | tuple) -> Figure:
    """Return an empty figure of exactly `width` x `height` pixels, scaled like `export.video`."""
    dpi = 100 * width / 1280
    # Half a pixel of slack, because the Agg canvas truncates the figure size to whole pixels.
    figure = Figure(figsize=((width + 0.5) / dpi, (height + 0.5) / dpi), dpi=dpi)
    figure.set_facecolor(facecolor)
    FigureCanvasAgg(figure)
    return figure


def _write_label(figure: Figure, heading: str, detail: str) -> None:
    """Write the segment label at the top-right of the frame.

    In `piece.mp4` the channel names fill the top-left and the area right of the playhead (the
    future) is always empty, so the label sits there and hides nothing.
    """
    figure.text(0.98, 0.955, heading, color=HEADING_COLOR, fontsize=17, weight="bold",
                ha="right", va="center")  # fmt: skip
    figure.text(0.98, 0.9, detail, color=DETAIL_COLOR, fontsize=12, ha="right", va="center")


def draw_card(
    png_path: Path | str, title: str, envelope: np.ndarray, width: int, height: int
) -> PixelBox:
    """Draw the still card of the first segment; return the waveform's box in frame pixels.

    The card shows the song title, the segment label and the waveform envelope of the input.
    The box tells ffmpeg where the playhead must travel, from its left to its right edge.
    """
    figure = _frame_figure(width, height, BACKGROUND)
    figure.text(0.04, 0.79, title, color=HEADING_COLOR, fontsize=30, weight="bold", va="center")
    figure.text(0.04, 0.70, "Plays in turn: original input → General MIDI → NES chip",
                color=DETAIL_COLOR, fontsize=14, va="center")  # fmt: skip
    _write_label(figure, *SEGMENT_LABELS[0])

    waveform_axes = figure.add_axes((0.04, 0.12, 0.92, 0.45))
    waveform_axes.set_axis_off()
    columns = np.arange(len(envelope)) + 0.5
    waveform_axes.fill_between(columns, -envelope, envelope, color=WAVEFORM_COLOR, lw=0)
    # A thin center line keeps silent passages visible.
    waveform_axes.axhline(0.0, color=WAVEFORM_COLOR, lw=0.8, alpha=0.5)
    waveform_axes.set_xlim(0, len(envelope))
    waveform_axes.set_ylim(-1.05, 1.05)
    figure.savefig(png_path, dpi=figure.dpi, facecolor=BACKGROUND)

    extent = waveform_axes.get_window_extent()
    # Matplotlib counts y from the bottom of the figure; image rows count from the top.
    return PixelBox(
        left=round(extent.x0),
        top=height - round(extent.y1),
        right=round(extent.x1),
        bottom=height - round(extent.y0),
    )


def draw_label(png_path: Path | str, heading: str, detail: str, width: int, height: int) -> None:
    """Draw a frame-sized transparent image with the segment label, to overlay on a video."""
    figure = _frame_figure(width, height, (0.0, 0.0, 0.0, 0.0))
    _write_label(figure, heading, detail)
    figure.savefig(png_path, dpi=figure.dpi, transparent=True)


def filter_graph(lengths: Sequence[float], width: int, height: int, fps: int, box: PixelBox) -> str:
    """Return the ffmpeg filter graph that builds and joins the three segments.

    It expects the inputs in the order of `render_comparison`: 0 card, 1 playhead, 2 input.mp3,
    3 piece.mp4, 4 piece.mp3, 5 piece.mp4 again, 6 piece-chip.mp3, 7 and 8 the two labels.
    Every part is padded (last frame repeated, or silence) and then trimmed to its length, so
    picture and sound of each segment end together. The outputs are `[v]` and `[a]`.
    """
    first, general_midi, chip = (f"{length:.3f}" for length in lengths)
    sweep = box.right - box.left
    chains = [
        # The playhead's left edge moves from the box's left to its right during the segment;
        # `w` is the playhead's own width, so its center is on the current time.
        f"[0:v][1:v]overlay=x='{box.left}+t/{first}*{sweep}-w/2':y={box.top},fps={fps},"
        f"setsar=1,trim=duration={first},setpts=PTS-STARTPTS,format=yuv420p[v0]"
    ]
    for segment, (video, label, length) in enumerate(((3, 7, general_midi), (5, 8, chip)), 1):
        chains.append(
            f"[{video}:v]setpts=PTS-STARTPTS,scale={width}:{height},fps={fps},setsar=1,"
            f"tpad=stop_mode=clone:stop_duration={length},trim=duration={length}[base{segment}]"
        )
        chains.append(f"[base{segment}][{label}:v]overlay=0:0,format=yuv420p[v{segment}]")
    for segment, (audio, length) in enumerate(((2, first), (4, general_midi), (6, chip))):
        chains.append(
            f"[{audio}:a]asetpts=PTS-STARTPTS,aresample=44100,"
            f"aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={length}[a{segment}]"
        )
    chains.append("[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]")
    return ";".join(chains)


def probe_duration(path: Path | str) -> float:
    """Return the duration of a media file in seconds, as ffprobe reads it."""
    command = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]
    return float(subprocess.run([*command, str(path)], check=True, capture_output=True).stdout)


def decode_mono(audio_path: Path | str, seconds: float, rate: int = ENVELOPE_RATE) -> np.ndarray:
    """Decode the first `seconds` of an audio file to mono float32 samples through a pipe."""
    command = [
        "ffmpeg", "-loglevel", "error", "-i", str(audio_path), "-t", f"{seconds:.3f}",
        "-ac", "1", "-ar", str(rate), "-f", "f32le", "-",
    ]  # fmt: skip
    return np.frombuffer(subprocess.run(command, check=True, capture_output=True).stdout, "<f4")


def _encode_two_pass(
    inputs: list[str],
    graph: str,
    video_kbps: float,
    audio_kbps: float,
    passlog: Path,
    mp4_path: Path,
) -> None:
    """Encode the filter graph with x264 in two passes at `video_kbps`, AAC audio, faststart.

    Both passes must see the same frames, or the second pass rejects the statistics of the
    first. `-vsync cfr` makes the null output of pass 1 repeat or drop frames exactly as the
    MP4 output of pass 2 does (by default the null output passes timestamps through).
    """
    common = [
        "ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph,
        "-map", "[v]", "-map", "[a]", "-vsync", "cfr", "-c:v", "libx264", "-preset", X264_PRESET,
        "-b:v", str(round(video_kbps * 1000)), "-pix_fmt", "yuv420p", "-passlogfile", str(passlog),
    ]  # fmt: skip
    subprocess.run([*common, "-pass", "1", "-f", "null", "-"], check=True)
    audio = ["-c:a", "aac", "-b:a", f"{audio_kbps}k", "-ar", "44100", "-ac", "2"]
    subprocess.run(
        [*common, "-pass", "2", *audio, "-movflags", "+faststart", str(mp4_path)], check=True
    )


def render_comparison(
    sample_dir: Path | str,
    mp4_path: Path | str,
    title: str | None = None,
    budget_bytes: int = DEFAULT_BUDGET_BYTES,
    audio_kbps: float | None = None,
    min_video_kbps: float = MIN_VIDEO_KBPS,
    fps: int = 30,
) -> bool:
    """Write the input, General MIDI and chip versions of a sample one after the other to MP4.

    The file fits `budget_bytes`; the segments are as long as the budget allows (whole, for the
    current samples). Return False, with a notice, when ffmpeg or a sample file is missing.
    """
    sample_dir, mp4_path = Path(sample_dir), Path(mp4_path)
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    missing += [name for name in (*SEGMENT_AUDIO, "piece.mp4") if not (sample_dir / name).exists()]
    if missing:
        print(f"comparison skipped: missing {', '.join(missing)}", file=sys.stderr)
        return False
    if title is None:
        config_path = sample_dir / "config.json"
        config = json.loads(config_path.read_text()) if config_path.exists() else {}
        title = sample_title(sample_dir.resolve().name, config)

    durations = [probe_duration(sample_dir / name) for name in SEGMENT_AUDIO]
    if audio_kbps is None:
        audio_kbps = choose_audio_kbps(sum(durations), budget_bytes)
    lengths = fit_lengths(durations, max_total_seconds(budget_bytes, audio_kbps, min_video_kbps))
    video_kbps, width, height = choose_video(sum(lengths), budget_bytes, audio_kbps, fps)

    with tempfile.TemporaryDirectory() as scratch_name:
        scratch = Path(scratch_name)
        envelope = waveform_envelope(decode_mono(sample_dir / "input.mp3", lengths[0]), width)
        box = draw_card(scratch / "card.png", title, envelope, width, height)
        imsave(scratch / "playhead.png", playhead_image(box.bottom - box.top))
        for name, (heading, detail) in zip(("gm", "chip"), SEGMENT_LABELS[1:], strict=True):
            draw_label(scratch / f"label-{name}.png", heading, detail, width, height)
        inputs = [
            "-loop", "1", "-framerate", str(fps), "-t", f"{lengths[0]:.3f}",
            "-i", str(scratch / "card.png"),
            "-i", str(scratch / "playhead.png"),
            "-i", str(sample_dir / "input.mp3"),
            "-i", str(sample_dir / "piece.mp4"), "-i", str(sample_dir / "piece.mp3"),
            "-i", str(sample_dir / "piece.mp4"), "-i", str(sample_dir / "piece-chip.mp3"),
            "-i", str(scratch / "label-gm.png"), "-i", str(scratch / "label-chip.png"),
        ]  # fmt: skip
        graph = filter_graph(lengths, width, height, fps, box)
        for attempt in range(MAX_TRIES):
            if attempt > 0:
                video_kbps *= SHRINK_STEP
            _encode_two_pass(inputs, graph, video_kbps, audio_kbps, scratch / "x264", mp4_path)
            if mp4_path.stat().st_size <= budget_bytes:
                break

    size = mp4_path.stat().st_size
    print(
        f"{mp4_path}: {probe_duration(mp4_path):.1f} s, {size / 1e6:.2f} MB, "
        f"{width}x{height}, video {video_kbps:.0f} kbps"
    )
    if size > budget_bytes:
        print(f"warning: {mp4_path} exceeds the budget of {budget_bytes} bytes", file=sys.stderr)
    return True
