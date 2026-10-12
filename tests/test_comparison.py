import json
import shutil
import subprocess

import numpy as np
import pytest
from matplotlib.image import imread

import main
from export.comparison import (
    PixelBox,
    choose_video,
    draw_card,
    draw_label,
    filter_graph,
    fit_lengths,
    max_total_seconds,
    playhead_image,
    render_comparison,
    sample_title,
    waveform_envelope,
)

FFMPEG_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def test_lengths_that_fit_the_budget_are_returned_unchanged():
    assert fit_lengths([50.0, 60.0, 70.0], max_total=200.0) == [50.0, 60.0, 70.0]


def test_water_filling_cuts_all_long_segments_to_one_length_and_hits_the_total_exactly():
    lengths = fit_lengths([100.0, 120.0, 30.0], max_total=150.0)
    # The 30 s segment is shorter than the cut, so it stays whole; the other two share the rest.
    assert lengths == pytest.approx([60.0, 60.0, 30.0])
    assert sum(lengths) == pytest.approx(150.0)


def test_water_filling_cuts_only_the_one_segment_that_is_longer_than_the_rest():
    lengths = fit_lengths([50.0, 50.0, 200.0], max_total=200.0)
    assert lengths == pytest.approx([50.0, 50.0, 100.0])


def test_max_total_seconds_is_the_budget_spent_at_the_lowest_acceptable_bitrate():
    # 9.5 MB minus 2% container overhead, at 96 kbps audio + 80 kbps video.
    seconds = max_total_seconds(9_500_000, audio_kbps=96, min_video_kbps=80)
    assert seconds == pytest.approx(9_500_000 * 8 * 0.98 / 176_000)


def test_choose_video_keeps_720p_for_a_short_video():
    video_kbps, width, height = choose_video(60.0, 9_500_000, audio_kbps=96)
    assert (width, height) == (1280, 720)
    assert video_kbps == pytest.approx(9_500_000 * 8 * 0.98 / 60.0 / 1000 - 96)


def test_choose_video_lowers_the_resolution_when_the_bits_per_pixel_get_too_few():
    _, width, height = choose_video(354.0, 9_500_000, audio_kbps=96)
    assert (width, height) == (960, 540)
    _, width, height = choose_video(420.0, 9_500_000, audio_kbps=96)
    assert (width, height) == (854, 480)


def test_choose_video_falls_back_to_360p_when_even_that_gets_too_few_bits():
    _, width, height = choose_video(600.0, 9_500_000, audio_kbps=96)
    assert (width, height) == (640, 360)


def test_waveform_envelope_has_one_peak_per_pixel_column_scaled_to_one():
    samples = np.concatenate([np.full(100, 0.1), np.full(100, -0.4), np.zeros(100)])
    envelope = waveform_envelope(samples, columns=3)
    np.testing.assert_allclose(envelope, [0.25, 1.0, 0.0])


def test_waveform_envelope_of_silence_stays_silent():
    np.testing.assert_allclose(waveform_envelope(np.zeros(50), columns=5), np.zeros(5))


def test_sample_title_prefers_the_title_in_the_config():
    assert sample_title("korobeiniki-s1", {"title": "Korobeiniki"}) == "Korobeiniki"


def test_sample_title_falls_back_to_the_prettified_folder_name():
    assert sample_title("korobeiniki-s1", {}) == "Korobeiniki (s1)"
    assert sample_title("mulher-de-fases-s1", {}) == "Mulher de Fases (s1)"
    assert sample_title("ievan-polkka-s1-contrast0", {}) == "Ievan Polkka (s1-contrast0)"


def test_playhead_is_a_white_core_with_a_dark_outline_and_a_fading_halo():
    image = playhead_image(height=40)
    assert image.dtype == np.uint8
    assert image.shape[0] == 40 and image.shape[2] == 4
    center = image.shape[1] // 2
    assert image[:, center, 3].min() == 255
    assert image[:, center, :3].min() == 255
    # Opaque dark pixels on both sides of the core keep it visible over the light waveform.
    opaque_dark = (image[0, :, 3] == 255) & (image[0, :, :3].max(axis=1) < 40)
    assert opaque_dark[:center].any() and opaque_dark[center:].any()
    assert image[:, 0, 3].max() < 100 and image[:, -1, 3].max() < 100


def test_card_is_a_frame_sized_image_with_the_waveform_inside_the_returned_box(tmp_path):
    card = tmp_path / "card.png"
    box = draw_card(card, "Korobeiniki (s1)", np.ones(50), width=320, height=180)
    image = imread(card)
    assert image.shape[:2] == (180, 320)
    assert 0 <= box.left < box.right <= 320
    assert 0 <= box.top < box.bottom <= 180
    middle_row = image[(box.top + box.bottom) // 2, box.left + 2 : box.right - 2, :3]
    # A full-scale envelope fills the box, so its middle row is bright; the corner stays dark.
    assert middle_row.mean() > 0.5
    assert image[-1, -1, :3].max() < 0.2


def test_label_is_transparent_except_for_its_text_at_the_top_right(tmp_path):
    label = tmp_path / "label.png"
    draw_label(label, "Generated · NES chip", "piece-chip.mp3", width=640, height=360)
    image = imread(label)
    assert image.shape == (360, 640, 4)
    assert image[180:, :320, 3].max() == 0
    assert image[:80, 320:, 3].max() > 0.9


def test_filter_graph_trims_every_segment_to_its_length_and_joins_the_three():
    box = PixelBox(left=20, top=60, right=300, bottom=150)
    graph = filter_graph([3.0, 2.5, 2.0], width=320, height=180, fps=30, box=box)
    assert "concat=n=3:v=1:a=1" in graph
    for length in ("3.000", "2.500", "2.000"):
        assert f"trim=duration={length}" in graph
        assert f"atrim=duration={length}" in graph
    # The playhead crosses the 280-pixel waveform during the 3 s of the first segment.
    assert "t/3.000*280" in graph
    assert "tpad=stop_mode=clone" in graph


def test_missing_ffmpeg_skips_the_comparison_with_a_notice(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("export.comparison.shutil.which", lambda name: None)
    ok = render_comparison(tmp_path, tmp_path / "compare.mp4")
    assert ok is False
    assert not (tmp_path / "compare.mp4").exists()
    assert "comparison skipped: missing ffmpeg" in capsys.readouterr().err


def run_ffmpeg(*arguments: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *arguments], check=True)


def probe(path, entries: str) -> str:
    command = ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", str(path)]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def top_level_atoms(path) -> list[str]:
    """Return the names of the top-level boxes of an MP4 file, in file order."""
    data = path.read_bytes()
    atoms, offset = [], 0
    while offset + 8 <= len(data):
        size = int.from_bytes(data[offset : offset + 4], "big")
        atoms.append(data[offset + 4 : offset + 8].decode("latin-1"))
        if size == 1:  # 64-bit size follows the name
            size = int.from_bytes(data[offset + 8 : offset + 16], "big")
        if size == 0:
            break
        offset += size
    return atoms


@pytest.fixture
def fake_sample(tmp_path):
    """A sample folder with sine-tone audio (3 s, 2.5 s, 2 s) and a 2 s test-pattern video."""
    folder = tmp_path / "korobeiniki-s1"
    folder.mkdir()
    for name, frequency, seconds in (
        ("input.mp3", 440, 3.0),
        ("piece.mp3", 660, 2.5),
        ("piece-chip.mp3", 880, 2.0),
    ):
        run_ffmpeg("-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={seconds}",
                   "-c:a", "libmp3lame", str(folder / name))  # fmt: skip
    run_ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", str(folder / "piece.mp4"))  # fmt: skip
    (folder / "config.json").write_text(json.dumps({"seed": 1}))
    return folder


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg or ffprobe is not installed")
def test_compare_command_writes_a_small_faststart_mp4_with_the_three_versions(
    fake_sample, tmp_path, capsys
):
    out = tmp_path / "compare.mp4"
    code = main.main(["compare", str(fake_sample), "--out", str(out), "--max-mb", "0.25"])
    assert code == 0
    assert out.exists()
    assert out.stat().st_size <= 250_000
    audio_seconds = sum(
        float(probe(fake_sample / name, "format=duration"))
        for name in ("input.mp3", "piece.mp3", "piece-chip.mp3")
    )
    assert float(probe(out, "format=duration")) == pytest.approx(audio_seconds, abs=0.3)
    streams = probe(out, "stream=codec_name,pix_fmt").splitlines()
    assert streams[0].startswith("h264,yuv420p")
    assert streams[1].startswith("aac")
    atoms = top_level_atoms(out)
    assert atoms.index("moov") < atoms.index("mdat")
    assert "MB" in capsys.readouterr().out
