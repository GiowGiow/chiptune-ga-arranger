// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { isMidi, parseSections, sha256Hex, sharedTrackName, trackRangeBars } from "../src/ui/input-panel.js";

test("a file is MIDI when it starts with the chunk name MThd, whatever its name", () => {
  assert.equal(isMidi(new TextEncoder().encode("MThd\0\0\0\x06")), true);
  assert.equal(isMidi(new TextEncoder().encode("X:1\nT:Tune\nK:C\n")), false);
  assert.equal(isMidi(new Uint8Array([0x4d, 0x54])), false);
});

test("the section editor reads one bar and label per line", () => {
  assert.deepEqual(parseSections("0 A\n8 Chorus 2\n\n 16  A "), [[0, "A"], [8, "Chorus 2"], [16, "A"]]);
  assert.deepEqual(parseSections(""), []);
  assert.throws(() => parseSections("A at 0"), /must look like "8 Chorus"/);
});

test("the input fingerprint is the SHA-256 of the file bytes", async () => {
  assert.equal(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("the tempo summary of an excerpt weighs each tempo by how long it lasts", async () => {
  const { excerptTempos } = await import("../src/ui/input-panel.js");
  // Tempo changes as readMidiFile lists them: 120 BPM for 4 s, then 60 BPM until the end (8 s).
  const midi = {
    resolution: 480,
    tempoChanges: [
      { tick: 0, time: 0, bpm: 120 },
      { tick: 3840, time: 4, bpm: 60 },
    ],
    timeToTick: (/** @type {number} */ t) => (t <= 4 ? t * 960 : 3840 + (t - 4) * 480),
    tickToTime: (/** @type {number} */ k) => (k <= 3840 ? k / 960 : 4 + (k - 3840) / 480),
  };
  // Beats 0-12: 8 beats at 120 (4 s) and 4 beats at 60 (4 s), so each tempo lasts half the time.
  const summary = excerptTempos(/** @type {any} */ (midi), 0, 12);
  assert.deepEqual({ ...summary, median: Math.round(summary.median) }, { atStart: 120, min: 60, max: 120, median: 60 });
  assert.deepEqual(excerptTempos(/** @type {any} */ (midi), 8, 12), { atStart: 60, min: 60, max: 60, median: 60 });
});

test("a track name that every track repeats is found, so the table can leave it out", () => {
  assert.equal(sharedTrackName([{ name: "Amor I Love You" }, { name: "Amor I Love You" }]), "Amor I Love You");
  assert.equal(sharedTrackName([{ name: "Piano" }, { name: "Bass" }]), null);
  assert.equal(sharedTrackName([{ name: "Solo" }]), null, "one track repeats nothing");
  assert.equal(sharedTrackName([{ name: "" }, { name: "" }]), null);
});

test("the range bars of the tracks share one pitch axis, and drums and empty tracks have none", () => {
  const tracks = [
    { isDrum: false, noteCount: 3, lowest: 52, highest: 64 },
    { isDrum: false, noteCount: 5, lowest: 40, highest: 57 },
    { isDrum: true, noteCount: 9, lowest: 35, highest: 81 },
    { isDrum: false, noteCount: 0, lowest: Infinity, highest: -Infinity },
  ];
  assert.deepEqual(trackRangeBars(tracks), [
    { left: 12 / 24, width: 12 / 24 },
    { left: 0, width: 17 / 24 },
    null,
    null,
  ]);
  assert.deepEqual(trackRangeBars([{ isDrum: false, noteCount: 1, lowest: 60, highest: 60 }]), [{ left: 0, width: 0 }]);
});

test("the summary names the meter, or each meter in order when it changes", async () => {
  const { meterSummary } = await import("../src/ui/input-panel.js");
  const { parseMeter } = await import("../src/core/meter.js");
  const bars = (/** @type {string[]} */ ...texts) => texts.map((text) => ({ meter: parseMeter(text) }));

  assert.equal(meterSummary(bars("3/4", "3/4")), "3/4");
  assert.equal(meterSummary(bars("4/4", "2/4", "2/4", "3/4", "4/4")), "4/4, 2/4, 3/4");
});
