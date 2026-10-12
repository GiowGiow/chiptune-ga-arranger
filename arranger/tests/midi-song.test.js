// @ts-check
// Tests for core/midi-song.js, which reduces a multi-track MIDI song to a lead sheet: the bars of
// the file's time-signature map, the melody of one track (skyline, snapped to sixteenths), one
// chord per group of each bar's meter voted by the other tracks, and the form the visitor marks.
// They port the doctests and tests of src/leadsheet/midi_reader.py and check SC-006: the same
// song and settings give the Python lead sheet, bar for bar, for the committed songs and for the
// project's synthetic songs in 3/4, 12/8, with meter changes and with a drum-only count-in.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { test } from "node:test";

import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { SUPPORTED_METERS, makeMeter, meterText } from "../src/core/meter.js";
import { readMidiFile, writeMidiFile } from "../src/core/midi-file.js";
import {
  BASS_TRACK_MAX_MEAN_PITCH,
  FILE_GRID_MIN_STRENGTH,
  GRID,
  QUALITIES,
  TEMPO_SEARCH,
  barMap,
  countBars,
  defaultExcerpt,
  describeTracks,
  detectChord,
  estimateBeatGrid,
  excerptBars,
  gridStrength,
  mainMeter,
  rankMelodyTracks,
  readLeadSheetMidi,
  skyline,
  suggestMelodyTrack,
} from "../src/core/midi-song.js";
import {
  assertClose,
  countInSongBytes,
  fixturesDir,
  rawMidiPath,
  readFixture,
  readJson,
  repoRoot,
  withTimeSignatures,
} from "./helpers.js";

/** The MIDI songs of data/sources.json; their raw files are in data/raw/ (not committed). */
const SONGS = readJson(`${repoRoot}/data/sources.json`).songs;

/** The project's synthetic songs (src/export/fixtures.py), committed with their reductions. */
const SYNTHETIC_SONGS = ["synthetic-waltz", "synthetic-twelve-eight", "synthetic-changes", "synthetic-count-in"];

/** The list of supported meters that ends every "not supported" message (core/meter.js). */
const SUPPORTED_LIST = SUPPORTED_METERS.map(meterText).join(", ");

/**
 * @param {import("../src/core/leadsheet.js").LeadSheet} sheet
 * @returns {string[]} the meter of each bar, as written.
 */
function meters(sheet) {
  return sheet.bars.map((bar) => String(bar.meter));
}

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

/**
 * A port of `write_waltz_song` (tests/test_midi_reader.py): `bars` bars in one meter at 120 BPM,
 * a flute note on every beat, and a pad triad and a bass root for each bar (C, F, G, C).
 * @param {{meter?: [number, number], bars?: number}} [options]
 */
function waltzSong({ meter = [3, 4], bars = 4 } = {}) {
  const barMeter = makeMeter(...meter);
  const beat = 0.5;
  /** @type {{start: number, end: number, pitch: number, velocity: number}[]} */
  const melody = [];
  /** @type {typeof melody} */
  const pad = [];
  /** @type {typeof melody} */
  const bass = [];
  const triads = [
    [60, 64, 67],
    [65, 69, 72],
    [67, 71, 74],
    [60, 64, 67],
  ];
  let position = 0;
  for (let bar = 0; bar < bars; bar += 1) {
    for (const length of barMeter.beats) {
      melody.push({ start: position * beat, end: position * beat + length * beat * 0.9, pitch: 76, velocity: 90 });
      position += length;
    }
    const [barStart, barEnd] = [(position - barMeter.barBeats) * beat, position * beat];
    const triad = triads[bar % 4];
    for (const pitch of triad) pad.push({ start: barStart, end: barEnd, pitch, velocity: 70 });
    bass.push({ start: barStart, end: barEnd, pitch: triad[0] - 24, velocity: 80 });
  }
  return readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      timeSignature: meter,
      tracks: [
        { name: "flute", channel: 0, program: 73, notes: melody },
        { name: "pad", channel: 1, program: 89, notes: pad },
        { name: "bass", channel: 2, program: 33, notes: bass },
      ],
    }),
  );
}

/**
 * A song recorded off its file's grid: drums on every eighth at 100 BPM (0.3 s) from `start`, and a
 * bass note on each downbeat of a `beatsPerBar`-beat bar from `downbeat`, in a file that says 120
 * BPM with the given time signature. The bass notes grow longer (0.5 s, 0.6 s, ...), so a downbeat
 * search over a wrong number of beats does not end in a tie.
 * @param {{start?: number, downbeat?: number, beatsPerBar?: number, bars?: number,
 *   timeSignature?: [number, number]}} [options]
 */
function offGridSong({ start = 0.3, downbeat = 0.3, beatsPerBar = 4, bars = 8, timeSignature = [4, 4] } = {}) {
  const beat = 0.6;
  /** @type {{start: number, end: number, pitch: number, velocity: number}[]} */
  const drums = [];
  /** @type {typeof drums} */
  const bass = [];
  const eighths = Math.round((downbeat - start) / (beat / 2)) + bars * beatsPerBar * 2;
  for (let eighth = 0; eighth < eighths; eighth += 1) {
    const at = start + eighth * (beat / 2);
    drums.push({ start: at, end: at + 0.05, pitch: eighth % 2 ? 42 : 36, velocity: 90 });
  }
  for (let bar = 0; bar < bars; bar += 1) {
    const at = downbeat + bar * beatsPerBar * beat;
    bass.push({ start: at, end: at + 0.5 + 0.1 * bar, pitch: 33, velocity: 90 });
  }
  return readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      timeSignature,
      tracks: [
        { name: "Bass", channel: 1, program: 33, notes: bass },
        { name: "Drums", channel: 9, program: 0, notes: drums },
      ],
    }),
  );
}

/**
 * Read a synthetic song of the fixtures folder (a .mid the Python fixtures command wrote).
 * @param {string} id
 */
function syntheticSong(id) {
  return readMidiFile(new Uint8Array(readFileSync(join(fixturesDir, "midi-songs", `${id}.mid`))));
}

test("the reader's constants are those of midi_reader.py", () => {
  assert.equal(GRID, 0.25);
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

test("estimateBeatGrid searches the downbeat among the bar's quarter beats (3 in 3/4)", () => {
  // The drums start one beat before the first downbeat; the bass plays on every 3/4 downbeat.
  const midi = offGridSong({ start: 0.3, downbeat: 0.9, beatsPerBar: 3 });
  const [bpm, downbeat] = estimateBeatGrid(midi, 3);
  assert.deepEqual([bpm.toFixed(2), downbeat.toFixed(3)], ["100.00", "0.900"]);
  // Searched among 4 beats, the 3/4 downbeats fall on every beat of a 4/4 bar in turn, and the
  // longest bass notes (the last bars) win: a wrong downbeat.
  assert.equal(estimateBeatGrid(midi)[1].toFixed(3), "1.500");
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
  assert.deepEqual([sheet.title, sheet.key, meters(sheet), sheet.sourceGrid], ["demo", "", ["4/4"], [120, 0]]);
  assert.equal("beatsPerBar" in sheet, false);
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

/**
 * One bar at 120 BPM (a beat lasts 0.5 s): four staccato sixteenths of 0.1 beat, a note of 0.3
 * beats on beat 2, and a bass under them.
 */
function staccatoSong() {
  const voice = [72, 74, 72, 74].map((pitch, sixteenth) => ({ start: sixteenth * 0.125, end: sixteenth * 0.125 + 0.05, pitch, velocity: 90 }));
  voice.push({ start: 1, end: 1.15, pitch: 76, velocity: 90 });
  return readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      tracks: [
        { name: "Voice", channel: 0, program: 73, notes: voice },
        { name: "Bass", channel: 1, program: 33, notes: [{ start: 0, end: 2, pitch: 36, velocity: 80 }] },
      ],
    }),
  );
}

test("staccato sixteenths shorter than half a sixteenth keep one sixteenth each", () => {
  const sheet = readLeadSheetMidi(staccatoSong(), { melodyTrack: 0 });
  assert.deepEqual(sheet.bars[0].melody.slice(0, 4), [
    { pitch: 72, onset: 0, duration: 0.25 },
    { pitch: 74, onset: 0.25, duration: 0.25 },
    { pitch: 72, onset: 0.5, duration: 0.25 },
    { pitch: 74, onset: 0.75, duration: 0.25 },
  ]);
});

test("a note of 0.3 beats still snaps its end to the nearest sixteenth", () => {
  const sheet = readLeadSheetMidi(staccatoSong(), { melodyTrack: 0 });
  // 2.0 to 2.3 beats snaps to 2.0 to 2.25, as before staccato notes kept their sixteenth.
  assert.deepEqual(
    sheet.bars[0].melody.filter((note) => note.onset >= 1),
    [{ pitch: 76, onset: 2, duration: 0.25 }],
  );
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

// --- the time-signature map (spec 003, research R8) ------------------------------------------

test("barMap lists every bar of the file with its meter: two 3/4 bars of count-in, then 4/4", () => {
  const countIn = barMap(readMidiFile(countInSongBytes()));
  assert.deepEqual(
    countIn.map((bar) => [bar.start, bar.length, bar.signature]),
    [
      [0, 3, [3, 4]],
      [3, 3, [3, 4]],
      [6, 4, [4, 4]],
      [10, 4, [4, 4]],
      [14, 4, [4, 4]],
      [18, 4, [4, 4]],
    ],
  );
  assert.deepEqual(
    barMap(smallSong({ bars: 4 })).map((bar) => bar.start),
    [0, 4, 8, 12],
  );
});

test("the barMap JSDoc example: one 3/4 bar of count-in, 4/4 from 1.5 s, a note to 5.5 s", () => {
  const bytes = writeMidiFile({
    tempoBpm: 120,
    tracks: [{ name: "Piano", channel: 0, program: 0, notes: [{ start: 1.5, end: 5.5, pitch: 60, velocity: 90 }] }],
  });
  const midi = readMidiFile(withTimeSignatures(bytes, [[3, 4, 0], [4, 4, 1440]]));
  assert.deepEqual(
    barMap(midi).map((bar) => [bar.start, bar.signature.join("/")]),
    [
      [0, "3/4"],
      [3, "4/4"],
      [7, "4/4"],
    ],
  );
});

test("a file without time signatures is 4/4 from beat 0", () => {
  const bytes = writeMidiFile({
    tempoBpm: 120,
    tracks: [{ name: "Piano", channel: 0, program: 0, notes: [{ start: 0, end: 3.9, pitch: 60, velocity: 90 }] }],
  });
  const midi = readMidiFile(withTimeSignatures(bytes, []));
  assert.deepEqual(midi.timeSignatures, []);
  assert.deepEqual(
    barMap(midi).map((bar) => [bar.start, bar.signature.join("/")]),
    [
      [0, "4/4"],
      [4, "4/4"],
    ],
  );
  assert.equal(String(mainMeter(midi)), "4/4");
});

test("a time signature that falls inside a bar leaves that bar short, and unsupported meters stay in the map", () => {
  // 3/4 starts on beat 6, in the middle of bar 1 (beats 4 to 8); 5/8 on beat 12.
  const midi = smallSong({ bars: 4, meters: [[4, 4, 0], [3, 4, 6 * 480], [5, 8, 12 * 480]] });
  assert.deepEqual(
    barMap(midi).map((bar) => [bar.start, bar.length, bar.signature.join("/")]),
    [
      [0, 4, "4/4"],
      [4, 2, "4/4"],
      [6, 3, "3/4"],
      [9, 3, "3/4"],
      [12, 2.5, "5/8"],
      [14.5, 2.5, "5/8"],
    ],
  );
});

test("mainMeter is the meter that lasts longest in the map", () => {
  assert.equal(String(mainMeter(readMidiFile(countInSongBytes()))), "4/4");
  assert.equal(String(mainMeter(waltzSong())), "3/4");
  assert.equal(String(mainMeter(smallSong())), "4/4");
});

test("a 3/4 song has 3-beat bars with one chord per bar", () => {
  const sheet = readLeadSheetMidi(waltzSong(), { melodyTrack: 0 });
  assert.deepEqual(meters(sheet), ["3/4", "3/4", "3/4", "3/4"]);
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords.map((c) => [c.symbol, c.onset, c.duration])),
    [[["C", 0, 3]], [["F", 0, 3]], [["G", 0, 3]], [["C", 0, 3]]],
  );
  assert.deepEqual(
    sheet.bars[1].melody.map((note) => note.onset),
    [0, 1, 2],
  );
});

test("a 2/4 song has 2-beat bars, read as 2/4 and not paired", () => {
  const sheet = readLeadSheetMidi(waltzSong({ meter: [2, 4] }), { melodyTrack: 0 });
  assert.deepEqual(meters(sheet), ["2/4", "2/4", "2/4", "2/4"]);
  assert.deepEqual(
    sheet.bars.map((bar) => bar.chords.map((c) => [c.symbol, c.duration])),
    [[["C", 2]], [["F", 2]], [["G", 2]], [["C", 2]]],
  );
});

test("by default a count-in bar with a pickup note is part of the song", () => {
  const midi = readMidiFile(countInSongBytes());
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0 });
  assert.deepEqual(meters(sheet), ["3/4", "4/4", "4/4", "4/4", "4/4"]);
  assert.deepEqual(sheet.bars[0].melody, [{ pitch: 67, onset: 2, duration: 1 }]);
  assert.deepEqual(sheet.sourceGrid, [120, 0]);
  assert.deepEqual(defaultExcerpt(midi), [1, 6]);
});

test("by default a drum-only count-in is left out", () => {
  const midi = syntheticSong("synthetic-count-in");
  assert.deepEqual(
    barMap(midi).map((bar) => bar.signature.join("/")),
    ["3/4", "3/4", "4/4", "4/4", "4/4", "4/4"],
  );
  assert.deepEqual(defaultExcerpt(midi), [2, 6]);
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0 });
  assert.deepEqual(meters(sheet), ["4/4", "4/4", "4/4", "4/4"]);
  assert.deepEqual(sheet.bars[0].melody[0], { pitch: 72, onset: 0, duration: 1 });
});

test("countBars counts the map's bars up to the one where the last pitched note ends", () => {
  assert.equal(countBars(smallSong({ bars: 4 })), 4);
  // Two 3/4 count-in bars, then four 4/4 bars: the upper bound of an excerpt is bar 6.
  assert.equal(countBars(readMidiFile(countInSongBytes())), 6);
  assert.equal(countBars(syntheticSong("synthetic-count-in")), 6);
  // Without pitched notes, no bar can be arranged.
  const drumsOnly = readMidiFile(
    writeMidiFile({
      tempoBpm: 120,
      tracks: [{ name: "Drums", channel: 9, program: 0, notes: [{ start: 0, end: 0.1, pitch: 36, velocity: 90 }] }],
    }),
  );
  assert.equal(countBars(drumsOnly), 0);
  assert.deepEqual(defaultExcerpt(drumsOnly), [0, 0]);
});

test("an excerpt counts bars from the first bar of the file, count-in included", () => {
  const midi = readMidiFile(countInSongBytes());
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, bars: [3, 6] });
  // Bars 0 and 1 are the count-in, so bar 3 is the second 4/4 bar.
  assert.deepEqual(
    sheet.bars.map((bar) => bar.melody.map((n) => [n.pitch, n.onset])),
    [[[74, 0]], [[72, 0]], [[74, 0]]],
  );
  assert.deepEqual(sheet.bars[0].chords.map((c) => c.symbol), ["G"]);
});

test("excerptBars gives the map on the grid in use and the excerpt, to turn bars into beats", () => {
  const midi = readMidiFile(countInSongBytes());
  const { map, first, end } = excerptBars(midi, [3, 6], "file");
  assert.deepEqual([map[first].start, map[end - 1].start + map[end - 1].length], [10, 22]);
  assert.deepEqual(excerptBars(midi, null, "auto").first, 1);
  // On an explicit grid, every bar has the main meter and bar 0 starts at the grid's downbeat.
  const steady = excerptBars(midi, null, [120, 1]);
  assert.deepEqual(
    steady.map.map((bar) => [bar.start, bar.length, bar.signature.join("/")]),
    [
      [0, 4, "4/4"],
      [4, 4, "4/4"],
      [8, 4, "4/4"],
      [12, 4, "4/4"],
      [16, 4, "4/4"],
    ],
  );
  assert.throws(() => excerptBars(midi, [0, 9], "file"), /0 ≤ first < end ≤ 6/);
});

test("an explicit grid reads the song in its main meter from its own downbeat", () => {
  const midi = readMidiFile(countInSongBytes());
  // Bars of 2 s (4/4 lasts longest in the file) from 1 s on: the last note ends at 11 s, so 5 bars.
  assert.equal(countBars(midi, [120, 1]), 5);
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0, grid: [120, 1] });
  assert.equal(sheet.bars.length, 5);
  assert.deepEqual(new Set(meters(sheet)), new Set(["4/4"]));
  assert.deepEqual(sheet.sourceGrid, [120, 1]);
});

test("a meter change inside the music moves the following bar lines", () => {
  const midi = smallSong({ bars: 4, meters: [[4, 4, 0], [3, 4, 8 * 480]] });
  const sheet = readLeadSheetMidi(midi, { melodyTrack: 0 });
  assert.deepEqual(meters(sheet), ["4/4", "4/4", "3/4", "3/4", "3/4"]);
  // Bar 3 spans beats 11 to 14: the end of a 76 (beats 10 to 12), then a 72 from beat 12.
  assert.deepEqual(sheet.bars[3].melody, [
    { pitch: 76, onset: 0, duration: 1 },
    { pitch: 72, onset: 1, duration: 2 },
  ]);
});

test("an unsupported meter inside the excerpt is refused, naming it and the bar", () => {
  const midi = smallSong({ meters: [[5, 8, 0]] });
  assert.throws(
    () => readLeadSheetMidi(midi, { melodyTrack: 0 }),
    (error) =>
      error instanceof Error &&
      error.message === `bar 0: the meter 5/8 is not supported; supported meters: ${SUPPORTED_LIST}`,
  );
});

test("a bar cut short by a time-signature change is refused inside the excerpt, and allowed outside it", () => {
  // 3/4 starts on beat 6, in the middle of bar 1 (beats 4 to 8): bar 1 lasts only 2 beats.
  const midi = smallSong({ bars: 4, meters: [[4, 4, 0], [3, 4, 6 * 480]] });
  assert.throws(
    () => readLeadSheetMidi(midi, { melodyTrack: 0 }),
    (error) =>
      error instanceof Error &&
      error.message ===
        "bar 1 (2.0 s) lasts 2 beats instead of 4: a time signature cuts it short; leave it out of midi.bars",
  );
  assert.deepEqual(meters(readLeadSheetMidi(midi, { melodyTrack: 0, bars: [2, 5] })), ["3/4", "3/4", "3/4"]);
});

test("a 7/8 song off its file's grid is refused: its downbeat cannot be estimated", () => {
  const midi = offGridSong({ timeSignature: [7, 8] });
  assert.throws(
    () => readLeadSheetMidi(midi, { melodyTrack: 0 }),
    (error) =>
      error instanceof Error &&
      error.message ===
        'a 7/8 song needs the file\'s own beat grid (midi.grid = "file"): its bar is not a whole ' +
          "number of quarter notes, so its downbeat cannot be estimated",
  );
  // On the file's own grid, 7/8 reads.
  assert.ok(meters(readLeadSheetMidi(midi, { melodyTrack: 0, grid: "file" })).every((meter) => meter === "7/8"));
});

for (const id of SYNTHETIC_SONGS) {
  test(`${id}: the lead sheet equals the Python reduction bar for bar (SC-006)`, () => {
    const fixture = readFixture(`midi-songs/${id}.json`);
    const expected = leadSheetFromJson(fixture.leadsheet);
    const settings = fixture.settings;
    const sheet = readLeadSheetMidi(syntheticSong(id), {
      melodyTrack: settings.melody_track,
      phraseLength: 4,
      bars: settings.bars,
      sections: settings.sections,
      grid: settings.grid,
      title: id,
    });
    assert.deepEqual([sheet.title, sheet.key], [expected.title, expected.key]);
    assert.deepEqual(meters(sheet), meters(expected));
    assertClose(sheet.tempoBpm, expected.tempoBpm, 6);
    assertClose(sheet.sourceGrid, expected.sourceGrid, 6);
    assert.equal(sheet.bars.length, expected.bars.length);
    assertClose(sheet.bars, expected.bars, 9);
  });
}

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
    assert.deepEqual([sheet.title, sheet.key], [expected.title, expected.key]);
    assert.deepEqual(meters(sheet), meters(expected));
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
  // Count-in in 3/4 at 127 BPM; the 4/4 music from tick 2880 (bar 2) at 98 BPM.
  const bytes = withTimeSignatures(countInSongBytes(), [[3, 4, 0], [4, 4, 2880]], [[127, 0], [98, 2880]]);
  const sheet = readLeadSheetMidi(readMidiFile(bytes), { melodyTrack: 0, title: "tempo", bars: [2, 6] });
  assertClose(sheet.tempoBpm, 98, 3);
  // The file grid is still named by the file's first tempo.
  assertClose(/** @type {[number, number]} */ (sheet.sourceGrid)[0], 127, 3);
});
