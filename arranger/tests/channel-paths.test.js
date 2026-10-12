// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { soundingPitch, stepLine, visibleUntil } from "../src/ui/channel-paths.js";

const note = (/** @type {number} */ pitch, /** @type {number} */ onset, /** @type {number} */ duration) =>
  ({ pitch, onset, duration });

test("a step line has one point per note start, a NaN point at each rest, and one at the end", () => {
  const { x, y } = stepLine([note(62, 2, 1), note(60, 0, 1)]);
  assert.deepEqual(x, [0, 1, 2, 3]);
  assert.equal(y[0], 60);
  assert.ok(Number.isNaN(y[1]));
  assert.deepEqual([y[2], y[3]], [62, 62]);
  assert.deepEqual(stepLine([]), { x: [], y: [] });
});

test("a channel without notes or tied notes gets no rest point between touching notes", () => {
  const { x, y } = stepLine([note(60, 0, 1), note(64, 1, 1)]);
  assert.deepEqual(x, [0, 1, 2]);
  assert.deepEqual(y, [60, 64, 64]);
});

test("visibleUntil reveals the line up to the playhead and draws the current note up to it", () => {
  const line = { x: [0, 1, 2, 3], y: [60, NaN, 62, 62] };
  const shown = visibleUntil(line, 2.5);
  assert.deepEqual(shown.x, [0, 1, 2, 2.5]);
  assert.deepEqual(shown.y.map((value) => (Number.isNaN(value) ? null : value)), [60, null, 62, 62]);
  assert.deepEqual(visibleUntil(line, -1), { x: [], y: [] });
  assert.equal(Math.max(...visibleUntil(line, 5).x), 3, "after the last note the path stops at its end");
});

test("visibleUntil keeps the note that enters the window from the left", () => {
  const line = { x: [0, 1, 2, 3], y: [60, NaN, 62, 62] };
  assert.deepEqual(visibleUntil(line, 2.5, 2.2), { x: [2, 2.5], y: [62, 62] });
});

test("soundingPitch is the pitch at time t, and null in a rest or outside the line", () => {
  const line = { x: [0, 1, 2, 3], y: [60, NaN, 62, 62] };
  assert.equal(soundingPitch(line, 0.5), 60);
  assert.equal(soundingPitch(line, 1.5), null);
  assert.equal(soundingPitch(line, 3), null);
  assert.equal(soundingPitch(line, -0.1), null);
});
