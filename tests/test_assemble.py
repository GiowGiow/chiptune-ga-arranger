import numpy as np

from arrangement.assemble import assemble
from arrangement.model import CHANNELS
from arrangement.validation import find_violations
from ga.genome import GENE_SIZES, random_population
from leadsheet.abc_reader import read_lead_sheet

KOROBEINIKI = "data/leadsheets/korobeiniki.abc"


def test_assembled_onsets_are_measured_from_the_start_of_the_piece():
    lead_sheet = read_lead_sheet(KOROBEINIKI)
    genome = np.zeros((len(lead_sheet.bars), 4), dtype=int)
    arrangement = assemble(lead_sheet, genome)
    assert set(arrangement.channels) == set(CHANNELS)
    second_bar_melody = [n for n in arrangement.channels["P1"] if 4.0 <= n.onset < 8.0]
    assert second_bar_melody[0].onset == 4.0
    assert arrangement.genome[0] == (0, 0, 0, 0)
    assert arrangement.tempo_bpm == lead_sheet.tempo_bpm


def test_every_valid_plan_gives_an_arrangement_that_obeys_the_nes_rules():
    lead_sheet = read_lead_sheet(KOROBEINIKI)
    rng = np.random.default_rng(0)
    for genome in random_population(rng, 20, len(lead_sheet.bars)):
        assert find_violations(assemble(lead_sheet, genome), lead_sheet) == []
    for value in range(max(GENE_SIZES)):
        constant = np.minimum(value, np.array(GENE_SIZES) - 1)
        genome = np.tile(constant, (len(lead_sheet.bars), 1))
        assert find_violations(assemble(lead_sheet, genome), lead_sheet) == []


def test_bars_of_different_meters_follow_each_other_without_gaps():
    from leadsheet.meter import parse_meter
    from leadsheet.model import Bar, ChordSegment, LeadSheet, MelodyNote

    def bar(index, meter_text):
        meter = parse_meter(meter_text)
        chord = ChordSegment("C", 0, (0, 4, 7), 0.0, meter.bar_beats)
        melody = (MelodyNote(72, 0.0, meter.bar_beats),)
        return Bar(index, melody, (chord,), "A", "verse", 0, index == 2, meter)

    lead_sheet = LeadSheet("Mixed", "", 120.0, (bar(0, "4/4"), bar(1, "2/4"), bar(2, "3/4")))
    arrangement = assemble(lead_sheet, np.zeros((3, 4), dtype=int))

    assert [note.onset for note in arrangement.channels["P1"]] == [0.0, 4.0, 6.0]
    assert [str(meter) for meter in arrangement.meters] == ["4/4", "2/4", "3/4"]
    assert find_violations(arrangement, lead_sheet) == []
