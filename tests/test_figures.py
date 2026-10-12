from test_midi_export import small_arrangement

from export.figures import plot_pianoroll


def test_pianoroll_is_written_as_png_and_pdf(tmp_path):
    for name in ("pianoroll.png", "pianoroll.pdf"):
        path = tmp_path / name
        plot_pianoroll(small_arrangement(), path)
        assert path.stat().st_size > 1000


def test_evolution_figure_is_written_as_png_and_pdf(tmp_path):
    from collections import namedtuple

    from export.figures import plot_evolution

    stats = namedtuple("Stats", "generation best mean diversity")
    log = [stats(g, 0.5 + 0.01 * g, 0.4 + 0.01 * g, 1.0 - 0.02 * g) for g in range(20)]
    for name in ("evolution.png", "evolution.pdf"):
        path = tmp_path / name
        plot_evolution(log, path)
        assert path.stat().st_size > 1000


def test_bar_lines_fall_where_each_bar_starts_in_its_own_meter():
    from dataclasses import replace

    from arrangement.model import Arrangement
    from export.figures import bar_lines
    from leadsheet.meter import parse_meter

    four_four = Arrangement("t", 120.0, ((0, 0, 0, 0),) * 2, {})
    mixed = replace(four_four, meters=tuple(parse_meter(m) for m in ("3/4", "3/4", "2/4")))

    assert bar_lines(four_four, total_beats=8.0) == [0.0, 4.0, 8.0]
    assert bar_lines(mixed, total_beats=8.0) == [0.0, 3.0, 6.0, 8.0]
