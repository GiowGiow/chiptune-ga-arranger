// @ts-check
// Tests for core/midi-file.js, the standard MIDI file reader and writer. The reader must group and
// time notes exactly as pretty_midi (on top of mido) does, because the CLI config names the melody
// by pretty_midi's instrument index (research R4). The hand-built files below were checked with
// pretty_midi 0.2.11 and mido 1.3.3; the last test compares whole songs with the instrument
// summaries that src/export/fixtures.py wrote.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { readMidiFile, writeMidiFile } from "../src/core/midi-file.js";
import { assertClose, rawMidiPath, readFixture, readJson, repoRoot } from "./helpers.js";

/**
 * A variable-length quantity, as MIDI writes delta times and lengths.
 * @param {number} value
 * @returns {number[]}
 */
function vlq(value) {
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

/**
 * One track event: its delta time in ticks, then its bytes.
 * @param {number} delta
 * @param {...number} bytes
 * @returns {number[]}
 */
function ev(delta, ...bytes) {
  return [...vlq(delta), ...bytes];
}

const END_OF_TRACK = ev(0, 0xff, 0x2f, 0);

/**
 * A whole standard MIDI file from raw track events.
 * @param {number} division ticks per quarter note
 * @param {number[][][]} tracks each track is a list of events
 * @param {number} [format]
 * @returns {Uint8Array}
 */
function smf(division, tracks, format = 1) {
  const u16 = (/** @type {number} */ n) => [(n >> 8) & 0xff, n & 0xff];
  const u32 = (/** @type {number} */ n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const ascii = (/** @type {string} */ text) => [...text].map((c) => c.charCodeAt(0));
  const bytes = [...ascii("MThd"), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division)];
  for (const track of tracks) {
    const body = track.flat();
    bytes.push(...ascii("MTrk"), ...u32(body.length), ...body);
  }
  return Uint8Array.from(bytes);
}

/**
 * Notes as [pitch, start, end, velocity] rows, for compact comparisons.
 * @param {{notes: {pitch: number, start: number, end: number, velocity: number}[]}} instrument
 * @returns {number[][]}
 */
function rows(instrument) {
  return instrument.notes.map((n) => [n.pitch, n.start, n.end, n.velocity]);
}

test("the JSDoc example holds: a written note reads back at the same time, name and resolution", () => {
  const bytes = writeMidiFile({
    resolution: 480,
    tempoBpm: 120,
    timeSignature: [4, 4],
    tracks: [{ name: "P1", channel: 0, program: 80, notes: [{ start: 0.5, end: 1, pitch: 72, velocity: 100 }] }],
  });
  const song = readMidiFile(bytes);
  assert.deepEqual([song.resolution, song.instruments[0].name, song.instruments[0].notes[0].start], [480, "P1", 0.5]);
});

test("the writeMidiFile JSDoc example holds: by default 480 ticks per quarter note and 4/4", () => {
  const bytes = writeMidiFile({
    tempoBpm: 120,
    tracks: [{ name: "P1", channel: 0, program: 80, notes: [{ start: 0.5, end: 1, pitch: 72, velocity: 100 }] }],
  });
  const song = readMidiFile(bytes);
  assert.equal(song.instruments[0].notes[0].start, 0.5);
  assert.equal(song.resolution, 480);
  assert.deepEqual(song.timeSignatures, [{ numerator: 4, denominator: 4, time: 0 }]);
});

test("writing then reading a 2-track file gives back the notes, names, programs, tempo and 480 ticks", () => {
  const melody = [
    { start: 0, end: 0.4, pitch: 76, velocity: 100 },
    { start: 0.4, end: 0.6, pitch: 71, velocity: 90 },
    { start: 0.6, end: 1.2, pitch: 72, velocity: 100 },
  ];
  const drums = [
    { start: 0, end: 0.1, pitch: 36, velocity: 100 },
    { start: 0, end: 0.1, pitch: 42, velocity: 60 },
    { start: 0.4, end: 0.5, pitch: 38, velocity: 90 },
  ];
  const bytes = writeMidiFile({
    resolution: 480,
    tempoBpm: 150,
    timeSignature: [4, 4],
    tracks: [
      { name: "Lead", channel: 0, program: 80, notes: melody },
      { name: "Drums", channel: 9, program: 0, notes: drums },
    ],
  });
  // Format 1, three tracks (tempo track + 2), 480 ticks per quarter note.
  assert.deepEqual([...bytes.subarray(0, 14)], [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 0x01, 0xe0]);

  const song = readMidiFile(bytes);
  assert.equal(song.resolution, 480);
  assert.deepEqual(song.tempoChanges, [{ tick: 0, time: 0, bpm: 150 }]);
  assert.deepEqual(song.timeSignatures, [{ numerator: 4, denominator: 4, time: 0 }]);
  assert.deepEqual(
    song.instruments.map((i) => [i.name, i.program, i.isDrum, i.channel]),
    [
      ["Lead", 80, false, 0],
      ["Drums", 0, true, 9],
    ],
  );
  assertClose(rows(song.instruments[0]), melody.map((n) => [n.pitch, n.start, n.end, n.velocity]), 9);
  assertClose(rows(song.instruments[1]), drums.map((n) => [n.pitch, n.start, n.end, n.velocity]), 9);
});

test("a note belongs to the program in effect at its note-off, and a channel with no note gives no instrument", () => {
  // pretty_midi keeps one instrument per (program, channel, track), created when its first note
  // ends. Events before any note (here a control change on channel 1) only go to a provisional
  // "straggler" instrument, which never appears in the list. Program 5 below never ends a note.
  const bytes = smf(
    96,
    [
      [
        ev(0, 0xb1, 7, 100),
        ev(0, 0x90, 60, 100),
        ev(96, 0x80, 60, 0),
        ev(0, 0xc0, 5),
        ev(0, 0x90, 62, 80),
        ev(96, 0xc0, 7),
        ev(0, 0x80, 62, 0),
        END_OF_TRACK,
      ],
    ],
    0,
  );
  const song = readMidiFile(bytes);
  assert.deepEqual(
    song.instruments.map((i) => [i.program, i.isDrum, rows(i)]),
    [
      [0, false, [[60, 0, 0.5, 100]]],
      [7, false, [[62, 0.5, 1, 80]]],
    ],
  );
});

test("a note-off closes every open note of its pitch except one that starts on the same tick", () => {
  const bytes = smf(
    96,
    [
      [
        ev(0, 0x90, 60, 100),
        ev(0, 0x90, 62, 100),
        ev(48, 0x90, 60, 90),
        ev(48, 0x80, 60, 0), // closes both open 60s
        ev(0, 0x90, 64, 70),
        ev(0, 0x80, 64, 0), // a lone zero-length note is dropped
        ev(96, 0x90, 62, 80), // a re-strike on the tick of the note-off stays open
        ev(0, 0x80, 62, 0),
        ev(96, 0x80, 62, 0),
        END_OF_TRACK,
      ],
    ],
    0,
  );
  assert.deepEqual(rows(readMidiFile(bytes).instruments[0]), [
    [60, 0, 0.5, 100],
    [60, 0.25, 0.5, 90],
    [62, 0, 1, 100],
    [62, 1, 1.5, 80],
  ]);
});

test("running status is read, and a meta event between does not reset it", () => {
  const bytes = smf(
    96,
    [
      [
        ev(0, 0x90, 60, 100),
        ev(0, 62, 100),
        ev(96, 0xff, 0x01, 2, 0x68, 0x69),
        ev(0, 60, 0), // note-on at velocity 0 is a note-off
        ev(0, 62, 0),
        END_OF_TRACK,
      ],
    ],
    0,
  );
  assert.deepEqual(rows(readMidiFile(bytes).instruments[0]), [
    [60, 0, 0.5, 100],
    [62, 0, 0.5, 100],
  ]);
});

test("an unknown meta event loses its delta time, as mido reads it", () => {
  const bytes = smf(96, [[ev(0, 0x90, 60, 100), ev(96, 0xff, 0x0a, 1, 0), ev(96, 0x80, 60, 0), END_OF_TRACK]], 0);
  assert.deepEqual(rows(readMidiFile(bytes).instruments[0]), [[60, 0, 0.5, 100]]);
});

/** A tempo of 120 BPM, then 60 BPM from tick 192, and one bass note in track 1. */
function tempoChangeFile() {
  return smf(96, [
    [ev(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20), ev(192, 0xff, 0x51, 3, 0x0f, 0x42, 0x40), END_OF_TRACK],
    [ev(0, 0xff, 0x03, 4, 0x42, 0x61, 0x73, 0x73), ev(0, 0xc0, 33), ev(96, 0x90, 40, 100), ev(192, 0x80, 40, 0), END_OF_TRACK],
  ]);
}

test("a tempo change mid-file maps ticks to the right seconds", () => {
  const song = readMidiFile(tempoChangeFile());
  assert.deepEqual(song.tempoChanges, [
    { tick: 0, time: 0, bpm: 120 },
    { tick: 192, time: 1, bpm: 60 },
  ]);
  assert.deepEqual(
    song.instruments.map((i) => [i.name, i.program, rows(i)]),
    [["Bass", 33, [[40, 0.5, 2, 100]]]],
  );
  assert.equal(song.tickToTime(240), 1.5);
});

test("timeToTick inverts tickToTime, rounds to the nearest tick and extends past the last event", () => {
  const song = readMidiFile(tempoChangeFile());
  for (let tick = 0; tick < 400; tick += 1) {
    assert.equal(song.timeToTick(song.tickToTime(tick)), tick, `tick ${tick}`);
  }
  assert.equal(song.timeToTick(0.26), 50);
  // pretty_midi's tick table ends at the last event + 1 (tick 289); later times use the last tempo.
  assert.equal(song.timeToTick(10), 1056);
});

test("a file that does not start with MThd is refused", () => {
  assert.throws(() => readMidiFile(new TextEncoder().encode("X:1\nK:C\nCDEF|\n")), /MThd/);
});

/** The MIDI songs of data/sources.json; their raw files are in data/raw/ (not committed). */
const SONGS = readJson(`${repoRoot}/data/sources.json`).songs;

for (const song of SONGS) {
  test(`${song.id} reads into pretty_midi's instruments: names, programs, note counts and times`, (t) => {
    const path = rawMidiPath(song.path.replace(/^data\/raw\//, ""));
    if (path === null) {
      t.skip("run uv run src/main.py fetch");
      return;
    }
    const fixture = readFixture(`midi-songs/${song.id}.json`);
    const midi = readMidiFile(new Uint8Array(readFileSync(path)));
    assert.equal(midi.resolution, fixture.resolution);
    assert.equal(midi.instruments.length, fixture.instruments.length);
    fixture.instruments.forEach((/** @type {any} */ expected, /** @type {number} */ index) => {
      const instrument = midi.instruments[index];
      const where = `instrument ${index}`;
      const notes = instrument.notes;
      assert.deepEqual(
        [instrument.name, instrument.program, instrument.isDrum, notes.length],
        [expected.name, expected.program, expected.is_drum, expected.note_count],
        where,
      );
      assert.equal(
        notes.reduce((sum, n) => sum + n.pitch, 0),
        expected.pitch_sum,
        where,
      );
      assertClose(
        notes.reduce((sum, n) => sum + n.start, 0),
        expected.start_sum,
        6,
      );
      const asRow = (/** @type {any} */ n) => [n.start, n.end, n.pitch, n.velocity];
      assertClose(asRow(notes[0]), expected.first, 6);
      assertClose(asRow(notes[notes.length - 1]), expected.last, 6);
    });
  });
}
