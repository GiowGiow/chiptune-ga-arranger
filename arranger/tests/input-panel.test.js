// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { isMidi, parseSections, sha256Hex } from "../src/ui/input-panel.js";

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
