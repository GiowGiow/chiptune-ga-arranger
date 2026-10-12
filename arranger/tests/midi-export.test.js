// @ts-check
// Tests for core/midi-export.js, which writes an arrangement as the .mid download
// (contracts/files.md): format 1 at 480 ticks per quarter note, a tempo track, and the tracks P1,
// P2, TR and NO on channels 0, 1, 2 and 9 with General MIDI programs 80, 80, 38 and 0. They port
// the doctest of src/export/midi.py and read the bytes back with core/midi-file.js.
//
// With WRITE_WEB_FIXTURES set, the last test also writes fixtures/web/korobeiniki-s1.mid, which
// tests/test_web_midi.py reads with pretty_midi (the CLI's reader).

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { CHANNEL_PROGRAMS, MIDI_CHANNELS, arrangementToMidi } from "../src/core/midi-export.js";
import { readMidiFile } from "../src/core/midi-file.js";
import { assertClose, fixturesDir, readFixture } from "./helpers.js";

/** @typedef {import("../src/core/midi-export.js").Arrangement} Arrangement */

/**
 * The arrangement of a plan fixture: notes `[pitch, onset, duration, velocity]` per channel.
 * @param {string} sample
 * @param {number} tempoBpm
 * @returns {Arrangement}
 */
function fixtureArrangement(sample, tempoBpm) {
  const plan = readFixture(`plans/${sample}.json`);
  /** @type {Arrangement["channels"]} */
  const channels = { P1: [], P2: [], TR: [], NO: [] };
  for (const channel of /** @type {const} */ (["P1", "P2", "TR", "NO"])) {
    channels[channel] = plan.arrangement[channel].map((/** @type {number[]} */ [pitch, onset, duration, velocity]) => ({
      pitch,
      onset,
      duration,
      velocity,
    }));
  }
  return { title: sample, tempoBpm, plan: plan.best_plan, channels };
}

test("the JSDoc example holds: a P1 note on beat 1 at 120 BPM starts at 0.5 s", () => {
  const arrangement = {
    title: "demo",
    tempoBpm: 120,
    plan: [[0, 0, 0, 0]],
    channels: {
      P1: [{ pitch: 72, onset: 1, duration: 1, velocity: 100 }],
      P2: [{ pitch: 64, onset: 0, duration: 2, velocity: 80 }],
      TR: [{ pitch: 48, onset: 0, duration: 4, velocity: 90 }],
      NO: [{ pitch: 36, onset: 0, duration: 0.25, velocity: 100 }],
    },
  };
  const midi = readMidiFile(arrangementToMidi(arrangement));
  assert.deepEqual(
    [midi.instruments.map((i) => i.name), midi.instruments[0].notes[0].start],
    [["P1", "P2", "TR", "NO"], 0.5],
  );
});

test("the file is format 1 at 480 ticks per quarter note, with the tempo and a 4/4 time signature", () => {
  const bytes = arrangementToMidi(fixtureArrangement("korobeiniki-s1", 150));
  // "MThd", header length 6, format 1, 5 tracks (tempo track + P1, P2, TR, NO), 480 ticks.
  assert.deepEqual([...bytes.subarray(0, 14)], [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 5, 0x01, 0xe0]);
  const midi = readMidiFile(bytes);
  assert.equal(midi.resolution, 480);
  assert.deepEqual(midi.tempoChanges, [{ tick: 0, time: 0, bpm: 150 }]);
  assert.deepEqual(midi.timeSignatures, [{ numerator: 4, denominator: 4, time: 0 }]);
});

test("the tracks are P1, P2, TR and NO on channels 0, 1, 2 and 9 with programs 80, 80, 38 and 0", () => {
  assert.deepEqual(MIDI_CHANNELS, { P1: 0, P2: 1, TR: 2, NO: 9 });
  assert.deepEqual(CHANNEL_PROGRAMS, { P1: 80, P2: 80, TR: 38, NO: 0 });
  const midi = readMidiFile(arrangementToMidi(fixtureArrangement("korobeiniki-s1", 150)));
  assert.deepEqual(
    midi.instruments.map((i) => [i.name, i.channel, i.program, i.isDrum]),
    [
      ["P1", 0, 80, false],
      ["P2", 1, 80, false],
      ["TR", 2, 38, false],
      ["NO", 9, 0, true],
    ],
  );
});

test("reading the file back gives the arrangement's notes in seconds (beats × 60 / tempo)", () => {
  const arrangement = fixtureArrangement("korobeiniki-s1", 150);
  const midi = readMidiFile(arrangementToMidi(arrangement));
  const secondsPerBeat = 60 / arrangement.tempoBpm;
  midi.instruments.forEach((instrument) => {
    const channel = /** @type {"P1" | "P2" | "TR" | "NO"} */ (instrument.name);
    const expected = arrangement.channels[channel].map((n) => [
      n.pitch,
      n.onset * secondsPerBeat,
      (n.onset + n.duration) * secondsPerBeat,
      n.velocity,
    ]);
    const actual = instrument.notes.map((n) => [n.pitch, n.start, n.end, n.velocity]);
    const order = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[1] - b[1] || a[0] - b[0];
    assertClose(actual.sort(order), expected.sort(order), 9);
  });
});

test("an empty channel still gets its named track", () => {
  const bytes = arrangementToMidi({
    title: "empty",
    tempoBpm: 100,
    plan: [],
    channels: { P1: [{ pitch: 60, onset: 0, duration: 4, velocity: 100 }], P2: [], TR: [], NO: [] },
  });
  assert.equal(bytes[11], 5, "track count in the header");
  // pretty_midi lists only instruments with notes, so the reader shows P1 alone.
  assert.deepEqual(readMidiFile(bytes).instruments.map((i) => i.name), ["P1"]);
});

test("the web fixture for tests/test_web_midi.py is written on request", (t) => {
  if (!process.env.WRITE_WEB_FIXTURES) {
    t.skip("set WRITE_WEB_FIXTURES=1 to write fixtures/web/korobeiniki-s1.mid");
    return;
  }
  const tempoBpm = readFixture("leadsheets/korobeiniki.json").tempo_bpm;
  assert.equal(tempoBpm, 150);
  const folder = join(fixturesDir, "web");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "korobeiniki-s1.mid"), arrangementToMidi(fixtureArrangement("korobeiniki-s1", tempoBpm)));
});
