"""Turn an arrangement plan (genotype) into the notes of the four NES channels (phenotype).

For every bar, the plan names one texture per channel. The realizers in `textures.py` write the
notes of that bar, with onsets relative to the bar; this module shifts them to onsets measured
from the start of the piece and collects them per channel.
"""

from dataclasses import replace

import numpy as np

from arrangement.model import CHANNELS, Arrangement, ChannelNote
from arrangement.textures import realize_no, realize_p1, realize_p2, realize_tr
from ga.genome import NO, OCT, P2, TR
from leadsheet.meter import bar_starts
from leadsheet.model import LeadSheet


def assemble(lead_sheet: LeadSheet, genome: np.ndarray) -> Arrangement:
    """Realize every bar of `genome` (shape (n_bars, 4)) on `lead_sheet`."""
    channels: dict[str, list[ChannelNote]] = {channel: [] for channel in CHANNELS}
    bars = lead_sheet.bars
    for bar, genes, bar_start in zip(bars, genome, bar_starts(bars), strict=True):
        next_bar = bars[bar.index + 1] if bar.index + 1 < len(bars) else None
        bar_notes = {
            "P1": realize_p1(bar, int(genes[OCT])),
            "P2": realize_p2(bar, int(genes[P2])),
            "TR": realize_tr(bar, int(genes[TR]), next_bar),
            "NO": realize_no(int(genes[NO]), bar.meter),
        }
        for channel, notes in bar_notes.items():
            channels[channel].extend(replace(n, onset=n.onset + bar_start) for n in notes)
    return Arrangement(
        title=lead_sheet.title,
        tempo_bpm=lead_sheet.tempo_bpm,
        genome=tuple(tuple(int(gene) for gene in row) for row in genome),
        channels={channel: tuple(notes) for channel, notes in channels.items()},
        meters=tuple(bar.meter for bar in bars),
    )
