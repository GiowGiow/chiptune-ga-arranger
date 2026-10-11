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
