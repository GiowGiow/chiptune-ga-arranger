// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { GM_PROGRAM_NAMES, noteName, programName } from "../src/ui/gm-programs.js";

test("the General MIDI program list has 128 instruments, numbered from 0", () => {
  assert.equal(GM_PROGRAM_NAMES.length, 128);
  assert.equal(programName(0), "Acoustic Grand Piano");
  assert.equal(programName(25), "Acoustic Guitar (steel)");
  assert.equal(programName(33), "Electric Bass (finger)");
  assert.equal(programName(80), "Lead 1 (square)");
  assert.equal(programName(127), "Gunshot");
});

test("a drum track is named drums, whatever its program", () => {
  assert.equal(programName(0, true), "Drums");
});

test("note names use sharps and the octave of middle C (C4 = 60)", () => {
  assert.equal(noteName(60), "C4");
  assert.equal(noteName(61), "C#4");
  assert.equal(noteName(21), "A0");
  assert.equal(noteName(108), "C8");
});
