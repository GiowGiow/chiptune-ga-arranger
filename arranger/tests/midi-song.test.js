// @ts-check
// Tests for core/midi-song.js, which reduces a multi-track MIDI song to a lead sheet: the melody
// of one track (skyline, snapped to sixteenths), one chord per half bar voted by the other tracks,
// and the form the visitor marks. They port the doctests of src/leadsheet/midi_reader.py and check
// SC-006: the same song and settings give the Python lead sheet, bar for bar.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { test } from "node:test";

import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { readMidiFile, writeMidiFile } from "../src/core/midi-file.js";
import {
  BASS_TRACK_MAX_MEAN_PITCH,
  CHORD_SPAN,
  FILE_GRID_MIN_STRENGTH,
  GRID,
  QUALITIES,
  TEMPO_SEARCH,
  countBars,
  describeTracks,
  detectChord,
  estimateBeatGrid,
  gridStrength,
  meterOffsetBeats,
  rankMelodyTracks,
  readLeadSheetMidi,
  skyline,
  suggestMelodyTrack,
} from "../src/core/midi-song.js";
import { assertClose, countInSongBytes, rawMidiPath, readFixture, readJson, repoRoot, withTimeSignatures } from "./helpers.js";

/** The MIDI songs of data/sources.json; their raw files are in data/raw/ (not committed). */
const SONGS = readJson(`${repoRoot}/data/sources.json`).songs;

/**
 * Read a song of data/sources.json, or null when its raw file is missing.
 * @param {any} song
 */
function loadSong(song) {
  const path = rawMidiPath(song.path.replace(/^data\/raw\//, ""));
  return path === null ? null : readMidiFile(new Uint8Array(readFileSync(path)));
}

/**
 * A small song at 120 BPM (a beat lasts 0.5 s): a voice, a bass and drums, for `bars` bars.
 * `meters` ([numerator, denominator, tick] at 480 ticks per beat) replaces `timeSignature`.
 * @param {{timeSignature?: [number, number], bars?: number, meters?: Array<[number, number, number]>}} [options]
 */
function smallSong({ timeSignature = [4, 4], bars = 2, meters } = {}) {
  /** @type {{start: number, end: number, pitch: number, velocity: number}[]} */
  const voice = [];
  /** @type {typeof voice} */
  const bass = [];
  /** @type {typeof voice} */
  const drums = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const t = bar * 2;
    voice.push({ start: t, end: t + 1, pitch: 72, velocity: 100 }, { start: t + 1, end: t + 2, pitch: 76, velocity: 100 });
    bass.push({ start: t, end: t + 2, pitch: bar % 2 === 0 ? 36 : 43, velocity: 100 });
    for (let beat = 0; beat < 4; beat += 1) drums.push({ start: t + beat / 2, end: t + beat / 2 + 0.1, pitch: 36, velocity: 100 });
  }
  const bytes = writeMidiFile({
    tempoBpm: 120,
    timeSignature,
    tracks: [
      { name: "Voz", channel: 0, program: 53, notes: voice },
      { name: "Bass", channel: 1, program: 33, notes: bass },
      { name: "Drums", channel: 9, program: 0, notes: drums },
    ],
  });
  return readMidiFile(meters ? withTimeSignatures(bytes, meters) : bytes);
}

test("the reader's constants are those of midi_reader.py", () => {
  assert.equal(GRID, 0.25);
  assert.equal(CHORD_SPAN, 2);
  assert.equal(BASS_TRACK_MAX_MEAN_PITCH, 50);
  assert.equal(FILE_GRID_MIN_STRENGTH, 0.8);
  assert.deepEqual(QUALITIES, [
    ["", [0, 4, 7]],
    ["m", [0, 3, 7]],
    ["7", [0, 4, 7, 10]],
    ["m7", [0, 3, 7, 10]],
  ]);
});

test("the tempo search grid is numpy's arange(60, 200, 0.05), float noise included", () => {
  assert.equal(TEMPO_SEARCH.length, 2800);
  assert.equal(TEMPO_SEARCH[0], 60);
  // numpy steps by (60 + 0.05) - 60, not by 0.05, so 110.1 comes out as 110.09999999999715.
  assert.equal(TEMPO_SEARCH[1002], 110.09999999999715);
  assert.equal(TEMPO_SEARCH[2799], 60 + 2799 * (60 + 0.05 - 60));
});

test("skyline keeps the highest note at each onset and cuts each note at the next onset", () => {
  assert.deepEqual(
    skyline([
      [0.0, 2.0, 60],
      [0.0, 1.0, 64],
      [1.0, 2.0, 62],
    ]),
    [
      [0.0, 1.0, 64],
      [1.0, 2.0, 62],
    ],
  );
});

test("detectChord names C for the weights of C, E and G over a C bass", () => {
  assert.deepEqual(detectChord([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], 0), ["C", 0, [0, 4, 7]]);
});

test("detectChord chooses a seventh chord only when its seventh is clearly present", () => {
  const g7 = [0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1]; // G B D F
  assert.deepEqual(detectChord(g7, 7), ["G7", 7, [7, 11, 2, 5]]);
  const faintSeventh = [0, 0, 1, 0, 0, 0.1, 0, 1, 0, 0, 0, 1];
  assert.equal(detectChord(faintSeventh, 7)?.[0], "G");
});

test("detectChord returns null for silence", () => {
  assert.equal(detectChord(new Array(12).fill(0), null), null);
});

test("gridStrength is 1 for sixteenths at 120 BPM and below 0.5 for a 97 BPM grid", () => {
  const onsets = Array.from({ length: 16 }, (_, i) => i * 0.125);
  assert.equal(Math.round(gridStrength(onsets, 120) * 1000) / 1000, 1);
  assert.ok(gridStrength(onsets, 97) < 0.5);
});

test("estimateBeatGrid finds the played tempo and the bar line of a song recorded off its grid", () => {
  // Drums on every eighth at 100 BPM from 0.3 s, a bass note on every downbeat; the file says 120.
  /** @type {{start: number, end: number, pitch: number, velocity: number}[]} */
  const drums = [];
  /** @type {typeof drums} */
  const bass = [];
  for (let eighth = 0; eighth < 64; eighth += 1) {
    drums.push({ start: 0.3 + eighth * 0.3, end: 0.3 + eighth * 0.3 + 0.05, pitch: eighth % 2 ? 42 : 36, velocity: 90 });
  }
  for (let bar = 0; bar < 8; bar += 1) bass.push({ start: 0.3 + bar * 2.4, end: 1.5 + bar * 2.4, pitch: 33, velocity: 90 });
  const midi = readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      tracks: [
        { name: "Bass", channel: 1, program: 33, notes: bass },
        { name: "Drums", channel: 9, program: 0, notes: drums },
      ],
    }),
  );
  const [bpm, downbeat, strength] = estimateBeatGrid(midi);
  assert.deepEqual([bpm.toFixed(2), downbeat.toFixed(3)], ["100.00", "0.300"]);
  assert.ok(strength > 0.99);
});

test("describeTracks summarizes each instrument; polyphony is the share of notes that overlap another", () => {
  const midi = readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      tracks: [
        {
          name: "Piano",
          channel: 0,
          program: 0,
          notes: [
            { start: 0, end: 1, pitch: 60, velocity: 90 },
            { start: 0.5, end: 1, pitch: 64, velocity: 90 },
            { start: 1, end: 2, pitch: 67, velocity: 90 },
            { start: 2, end: 3, pitch: 69, velocity: 90 },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(describeTracks(midi), [
    { index: 0, name: "Piano", program: 0, isDrum: false, noteCount: 4, lowest: 60, highest: 69, meanPitch: 65, polyphony: 0.5 },
  ]);
});

test("suggestMelodyTrack prefers many single notes, a vocal name and a singing range (research R11)", () => {
  const track = { program: 0, isDrum: false, lowest: 0, highest: 0 };
  const tracks = [
    { ...track, index: 0, name: "Strings", noteCount: 400, meanPitch: 60, polyphony: 0.9 },
    { ...track, index: 1, name: "Voz", noteCount: 200, meanPitch: 67, polyphony: 0.05 },
    { ...track, index: 2, name: "Bass", noteCount: 300, meanPitch: 40, polyphony: 0 },
    { ...track, index: 3, name: "Drums", noteCount: 900, meanPitch: 40, polyphony: 0, isDrum: true },
  ];
  assert.equal(suggestMelodyTrack(tracks), 1);
  assert.deepEqual(rankMelodyTracks(tracks), [1, 2, 0]);
  assert.equal(suggestMelodyTrack([tracks[3]]), null);
});

test("the readLeadSheetMidi JSDoc example holds: one bar of a voice over a C bass", () => {
  const midi = readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      tracks: [
        { name: "Voice", channel: 0, program: 53, notes: [{ start: 0, end: 1, pitch: 72, velocity: 100 }] },
        { name: "Bass", channel: 1, program: 33, notes: [{ start: 0, end: 2, pitch: 36, velocity: 100 }] },
      ],
    }),
  );
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, title: "demo" });
  assert.deepEqual(
    [sheet.bars.length, sheet.bars[0].melody[0], sheet.bars[0].chords[0].symbol, sheet.tempoBpm],
    [1, { pitch: 72, onset: 0, duration: 2 }, "C", 120],
  );
  assert.deepEqual([sheet.title, sheet.key, sheet.beatsPerBar, sheet.sourceGrid], ["demo", "", 4, [120, 0]]);
});

test("a small song reads into bars, sections, roles and phrases", () => {
  const midi = smallSong({ bars: 4 });
  assert.equal(countBars(midi), 4);
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, sections: [[0, "A"], [2, "Chorus"]], phraseLength: 2 });
  assert.deepEqual(
    sheet.bars.map((bar) => [bar.label, bar.role, bar.phrase, bar.phraseEnd, bar.chords.map((c) => c.symbol).join(" ")]),
    [
      ["A", "verse", 0, false, "C"],
      ["A", "verse", 0, true, "G"],
      ["Chorus", "chorus", 1, false, "C"],
      ["Chorus", "chorus", 1, true, "G"],
    ],
  );
  assert.deepEqual(sheet.bars[1].melody, [
    { pitch: 72, onset: 0, duration: 2 },
    { pitch: 76, onset: 2, duration: 2 },
  ]);
});

test("an excerpt starts at its first bar, and the tempo override and an explicit grid are kept", () => {
  const midi = smallSong({ bars: 4 });
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, bars: [1, 3], tempoOverride: 90 });
  assert.equal(sheet.bars.length, 2);
  assert.deepEqual(sheet.bars[0].chords.map((c) => c.symbol), ["G"]);
  assert.equal(sheet.tempoBpm, 90);
  const shifted = readLeadSheetMidi(midi, { melodyTrack: 0, grid: [120, 0.5] });
  assert.deepEqual(shifted.sourceGrid, [120, 0.5]);
  assert.equal(shifted.tempoBpm, 120);
  // On a grid whose downbeat is 0.5 s, the first beat starts half way through the first note.
  assert.deepEqual(shifted.bars[0].melody.slice(0, 2), [
    { pitch: 72, onset: 0, duration: 1 },
    { pitch: 76, onset: 1, duration: 2 },
  ]);
});

test("a missing or drum melody track is refused with the Python messages", () => {
  const midi = smallSong();
  assert.throws(() => readLeadSheetMidi(midi, { melodyTrack: 7 }), /melody track 7 does not exist/);
  assert.throws(() => readLeadSheetMidi(midi, { melodyTrack: 2 }), /track 2 is a drum track and cannot be the melody/);
});

test("a 3/4 file is refused with a message that names 3/4, and 2/4 is accepted", () => {
  assert.throws(() => readLeadSheetMidi(smallSong({ timeSignature: [3, 4] }), { melodyTrack: 0 }), /3\/4/);
  assert.equal(readLeadSheetMidi(smallSong({ timeSignature: [2, 4] }), { melodyTrack: 0 }).bars.length, 2);
});

test("meterOffsetBeats is the beat where the 4/4 or 2/4 music starts: 6 after two 3/4 bars of count-in", () => {
  assert.equal(meterOffsetBeats(readMidiFile(countInSongBytes())), 6);
  assert.equal(meterOffsetBeats(smallSong()), 0);
  assert.equal(meterOffsetBeats(smallSong({ timeSignature: [2, 4] })), 0);
  assert.equal(meterOffsetBeats(smallSong({ meters: [[3, 4, 0], [2, 4, 1440]] })), 3);
  assert.equal(meterOffsetBeats(smallSong({ meters: [] })), 0);
});

test("a count-in in another meter is skipped: bar 0 starts on the first 4/4 downbeat", () => {
  const midi = readMidiFile(countInSongBytes());
  assert.equal(countBars(midi), 4);
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0 });
  assert.equal(sheet.bars.length, 4);
  // The pickup G4 of the count-in lies before bar 0, outside every bar.
  assert.deepEqual(sheet.bars[0].melody, [{ pitch: 72, onset: 0, duration: 2 }]);
  assert.deepEqual(sheet.bars.map((bar) => bar.chords.map((c) => c.symbol)), [["C"], ["G"], ["C"], ["G"]]);
  assert.deepEqual(sheet.sourceGrid, [120, 0]);
});

test("an excerpt after a count-in counts bars from the first 4/4 bar", () => {
  const sheet = readLeadSheetMidi(readMidiFile(countInSongBytes()), { melodyTrack: 0, bars: [1, 3] });
  assert.deepEqual(sheet.bars[0].melody.map((n) => [n.pitch, n.onset]), [[74, 0]]);
  assert.deepEqual(sheet.bars[0].chords.map((c) => c.symbol), ["G"]);
});

test("an explicit grid finds its own downbeat and ignores the count-in", () => {
  const midi = readMidiFile(countInSongBytes());
  // Bars of 2 s from 1 s on: the last note ends at 11 s, so 5 bars.
  assert.equal(countBars(midi, [120, 1]), 5);
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, grid: [120, 1] });
  assert.equal(sheet.bars.length, 5);
  assert.deepEqual(sheet.sourceGrid, [120, 1]);
});

test("a meter change inside the music is refused, naming the meter, its bar and its time", () => {
  const midi = smallSong({ bars: 4, meters: [[4, 4, 0], [3, 4, 8 * 480]] });
  const message = /the file changes to 3\/4 at bar 2 \(4\.0 s\); only 4\/4 and 2\/4 are supported/;
  assert.throws(() => readLeadSheetMidi(midi, { melodyTrack: 0 }), message);
  assert.throws(() => countBars(midi), message);
  assert.throws(() => meterOffsetBeats(midi), message);
});

test("bars must satisfy 0 ≤ first < end ≤ barCount and end − first ≤ 256", () => {
  const midi = smallSong({ bars: 4 });
  for (const bars of [[2, 2], [-1, 2], [0, 5], [3, 1], [0.5, 2]]) {
    assert.throws(
      () => readLeadSheetMidi(midi, { melodyTrack: 0, bars: /** @type {[number, number]} */ (bars) }),
      /0 ≤ first < end ≤ 4 and end − first ≤ 256/,
      String(bars),
    );
  }
  const long = smallSong({ bars: 258 });
  assert.throws(() => readLeadSheetMidi(long, { melodyTrack: 0, bars: [0, 258] }), /end − first ≤ 256/);
  assert.throws(() => readLeadSheetMidi(long, { melodyTrack: 0 }), /258 bars.*at most 256/);
  assert.equal(readLeadSheetMidi(long, { melodyTrack: 0, bars: [2, 258] }).bars.length, 256);
  // A whole song of up to 256 bars reads without an excerpt.
  assert.equal(readLeadSheetMidi(smallSong({ bars: 200 }), { melodyTrack: 0 }).bars.length, 200);
});

test("sections must start at bars inside the excerpt, in strictly increasing order", () => {
  const midi = smallSong({ bars: 4 });
  for (const sections of [[[0, "A"], [0, "B"]], [[2, "B"], [1, "A"]], [[0, "A"], [4, "B"]], [[-1, "A"]]]) {
    assert.throws(
      () => readLeadSheetMidi(midi, { melodyTrack: 0, sections: /** @type {Array<[number, string]>} */ (sections) }),
      /bars inside the excerpt; strictly increasing/,
      JSON.stringify(sections),
    );
  }
  // Bars before the first section start are part "A", as in the Python reader.
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, sections: [[2, "B"]] });
  assert.deepEqual(sheet.bars.map((bar) => bar.label), ["A", "A", "B", "B"]);
});

for (const song of SONGS) {
  test(`${song.id}: the lead sheet equals the Python reduction bar for bar (SC-006)`, (t) => {
    const midi = loadSong(song);
    if (midi === null) {
      t.skip("run uv run src/main.py fetch");
      return;
    }
    const fixture = readFixture(`midi-songs/${song.id}.json`);
    const expected = leadSheetFromJson(fixture.leadsheet);
    const settings = song.midi;
    const sheet = readLeadSheetMidi(midi, {
      melodyTrack: settings.melody_track,
      phraseLength: 4,
      bars: settings.bars,
      sections: settings.sections,
      grid: settings.grid ?? "auto",
      title: basename(song.path, extname(song.path)),
    });
    assert.deepEqual([sheet.title, sheet.key, sheet.beatsPerBar], [expected.title, expected.key, expected.beatsPerBar]);
    assertClose(sheet.tempoBpm, expected.tempoBpm, 6);
    assertClose(sheet.sourceGrid, expected.sourceGrid, 6);
    assert.equal(sheet.bars.length, expected.bars.length);
    assertClose(sheet.bars, expected.bars, 9);
  });

  test(`${song.id}: the recorded melody track is the first or second suggestion (research R11)`, (t) => {
    const midi = loadSong(song);
    if (midi === null) {
      t.skip("run uv run src/main.py fetch");
      return;
    }
    const ranking = rankMelodyTracks(describeTracks(midi));
    assert.ok(ranking.slice(0, 2).includes(song.midi.melody_track), `ranking ${ranking}`);
    assert.equal(suggestMelodyTrack(describeTracks(midi)), ranking[0]);
  });
}

test("the tempo is the one in effect where the excerpt starts, not the count-in's", () => {
  // Count-in in 3/4 at 127 BPM; the 4/4 music from tick 2880 at 98 BPM.
  const bytes = withTimeSignatures(countInSongBytes(), [[3, 4, 0], [4, 4, 2880]], [[127, 0], [98, 2880]]);
  const sheet = readLeadSheetMidi(readMidiFile(bytes), { melodyTrack: 0, title: "tempo" });
  assertClose(sheet.tempoBpm, 98, 3);
  // The file grid is still named by the file's first tempo.
  assertClose(/** @type {[number, number]} */ (sheet.sourceGrid)[0], 127, 3);
});
