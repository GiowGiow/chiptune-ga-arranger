// @ts-check
// Tests for src/runner.js, the GA side of the page ↔ worker protocol
// (contracts/worker-protocol.md). The runner gets its clock, its pauses and its postMessage from
// outside, so these tests drive it with a fake clock: time moves only when the runner reads the
// clock (a little, as if work took time) or sleeps (by the requested amount). A run that lasts
// seconds at the "watch" pace then takes a fraction of a second here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { criterionScores, fitness } from "../src/core/fitness.js";
import { leadSheetFromJson } from "../src/core/leadsheet.js";
import { buildTables } from "../src/core/tables.js";
import { createRunner } from "../src/runner.js";
import { readFixture, readJson, repoRoot } from "./helpers.js";

const DEFAULT_CONFIG = readJson(join(repoRoot, "configs", "default.json"));
const KOROBEINIKI = leadSheetFromJson(readFixture("leadsheets/korobeiniki.json"));

/**
 * Small settings so that a run takes a fraction of a second: 151 generations of 16 plans.
 * @param {Record<string, unknown>} [overrides]
 */
function smallSettings(overrides = {}) {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    seed: 1,
    population_size: 16,
    max_generations: 150,
    stagnation_window: 1000,
    ...overrides,
  };
}

/**
 * A fake worker environment: a clock that advances `tick` ms per reading, sleeps that advance it
 * by the requested time and let other messages in, and a record of every posted message.
 * @param {{tick?: number, onPost?: (message: any) => void}} [options]
 */
function fakeWorld({ tick = 0.02, onPost = () => {} } = {}) {
  let time = 1000;
  /** @type {{time: number, message: any}[]} */
  const posted = [];
  /** @type {number[]} */
  const sleeps = [];
  const runner = createRunner({
    post: (message) => {
      posted.push({ time, message });
      onPost(message);
    },
    now: () => (time += tick),
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      time += Math.max(0, milliseconds);
      return new Promise((resolve) => setImmediate(resolve));
    },
  });
  return { runner, posted, sleeps };
}

/** @param {string} runId @param {string} pace @param {Record<string, unknown>} [settings] */
function runMessage(runId, pace, settings = smallSettings()) {
  return { type: "run", runId, leadSheet: KOROBEINIKI, settings, pace };
}

/** @param {{message: any}[]} posted @param {string} [runId] */
function messagesOf(posted, runId) {
  return posted.map((entry) => entry.message).filter((message) => !runId || message.runId === runId);
}

/** Every generation stats object carried by the progress messages, in order. @param {any[]} messages */
function progressLog(messages) {
  return messages.filter((message) => message.type === "progress").flatMap((message) => message.generations);
}

test("a run message produces started, then progress messages, then done", async () => {
  const { runner, posted } = fakeWorld();
  await runner.handle(runMessage("korobeiniki-s1-test", "full"));
  const messages = messagesOf(posted);
  assert.deepEqual(
    [messages[0].type, messages.at(-1).type],
    ["started", "done"],
  );
  assert.ok(messages.length >= 3);
  assert.ok(messages.slice(1, -1).every((message) => message.type === "progress"));
  assert.ok(messages.every((message) => message.runId === "korobeiniki-s1-test"));

  const [started] = messages;
  assert.equal(started.nBars, 32);
  assert.deepEqual(started.tables, {
    applicable: { contrast: true, coherence: true, bass_smoothness: true },
  });

  const done = messages.at(-1);
  assert.equal(done.stopReason, "max_generations");
  assert.equal(done.generations, 150);
  assert.ok(done.bestPlan instanceof Uint8Array && done.bestPlan.length === 128);
  assert.ok(done.initialBestPlan instanceof Uint8Array && done.initialBestPlan.length === 128);
  assert.ok(typeof done.durationMs === "number" && done.durationMs >= 0);
  const tables = buildTables(KOROBEINIKI);
  assert.equal(fitness(tables, done.bestPlan, 32, smallSettings().weights)[0], done.bestFitness);
  const scores = criterionScores(tables, done.bestPlan, 32);
  const expectedScores = Object.entries(scores).map(([name, [score]]) => [name, score]);
  assert.deepEqual(done.scores, Object.fromEntries(expectedScores));
});

test("started marks the criteria that cannot apply to the tune", async () => {
  // Every bar a verse in its own phrase: no chorus to contrast, no pair of bars to keep coherent.
  const flat = {
    ...KOROBEINIKI,
    bars: KOROBEINIKI.bars.map((bar, index) => ({ ...bar, role: "verse", phrase: index, phraseEnd: true })),
  };
  const { runner, posted } = fakeWorld();
  const message = runMessage("flat", "full", smallSettings({ max_generations: 3 }));
  await runner.handle({ ...message, leadSheet: flat });
  const [started] = messagesOf(posted);
  assert.deepEqual(started.tables.applicable, { contrast: false, coherence: false, bass_smoothness: true });
  const done = messagesOf(posted).at(-1);
  assert.equal(done.scores.contrast, null);
  assert.equal(done.scores.coherence, null);
  assert.equal(typeof done.scores.bass_smoothness, "number");
});

test("the progress messages carry every generation once, in order, up to the last one", async () => {
  const { runner, posted } = fakeWorld();
  await runner.handle(runMessage("r", "full"));
  const messages = messagesOf(posted);
  const log = progressLog(messages);
  assert.deepEqual(
    log.map((stats) => stats.generation),
    Array.from({ length: 151 }, (_, generation) => generation),
  );
  for (const stats of log) {
    assert.deepEqual(Object.keys(stats).sort(), ["best", "diversity", "generation", "mean", "stagnation"]);
  }
  const lastProgress = messages.filter((message) => message.type === "progress").at(-1);
  const done = messages.at(-1);
  assert.deepEqual(lastProgress.bestPlan, done.bestPlan);
  assert.equal(lastProgress.bestFitness, done.bestFitness);
});

test("progress messages come at most every 50 ms, except the one after the last generation", async () => {
  // Each clock reading costs 1 ms, as if a generation took about 1 ms: about 8 per slice.
  const { runner, posted } = fakeWorld({ tick: 1 });
  await runner.handle(runMessage("r", "full"));
  const times = posted.filter((entry) => entry.message.type === "progress").map((entry) => entry.time);
  assert.ok(times.length >= 3, `${times.length} progress messages`);
  for (let index = 1; index < times.length - 1; index++) {
    const gap = times[index] - times[index - 1];
    assert.ok(gap >= 50, `progress ${index} came after ${gap} ms`);
  }
});

test("a progress message holds a copy of the best plan, which later generations leave intact", async () => {
  const { runner, posted } = fakeWorld({ tick: 0.05 });
  await runner.handle(runMessage("r", "full"));
  const progress = messagesOf(posted).filter((message) => message.type === "progress");
  const copies = progress.map((message) => message.bestPlan.slice());
  progress.forEach((message, index) => assert.deepEqual(message.bestPlan, copies[index]));
  for (let index = 1; index < progress.length; index++) {
    assert.notEqual(progress[index].bestPlan, progress[index - 1].bestPlan);
  }
});

test("at the full pace the runner works in slices of at most 8 ms and pauses 0 ms between them", async () => {
  const { runner, posted, sleeps } = fakeWorld({ tick: 1 });
  await runner.handle(runMessage("r", "full"));
  assert.ok(sleeps.length > 1, "the runner never paused");
  assert.ok(sleeps.every((milliseconds) => milliseconds === 0));
  // A slice stops at the first clock reading at or past 8 ms: at most 8 generations of 1 ms.
  const progress = messagesOf(posted).filter((message) => message.type === "progress");
  const generationsPerSlice = progressLog(progress).length / sleeps.length;
  assert.ok(generationsPerSlice <= 8 + 1, `${generationsPerSlice} generations per slice`);
});

test("at the watch pace generation g comes no earlier than g / 400 s after the start", async () => {
  const { runner, posted } = fakeWorld();
  await runner.handle(runMessage("r", "watch"));
  const startedAt = posted[0].time;
  for (const { time, message } of posted) {
    if (message.type !== "progress") continue;
    const latest = message.generations.at(-1).generation;
    const elapsed = time - startedAt;
    assert.ok(latest * 2.5 <= elapsed, `generation ${latest} posted ${elapsed} ms after the start`);
  }
  const done = messagesOf(posted).at(-1);
  // About 400 generations per second: 150 generations take about 375 ms, not much more.
  assert.ok(done.durationMs >= 150 * 2.5 && done.durationMs < 150 * 2.5 + 60, `${done.durationMs} ms`);
});

test("the watch and full paces, and a pace change mid-run, give the same plan and log", async () => {
  const full = fakeWorld();
  await full.runner.handle(runMessage("r", "full"));
  const watch = fakeWorld();
  await watch.runner.handle(runMessage("r", "watch"));
  let switched = false;
  const changing = fakeWorld({
    onPost: (message) => {
      if (message.type === "progress" && !switched) {
        switched = true;
        queueMicrotask(() => changing.runner.handle({ type: "pace", runId: "r", pace: "full" }));
      }
    },
  });
  await changing.runner.handle(runMessage("r", "watch"));

  const reference = messagesOf(full.posted);
  for (const other of [messagesOf(watch.posted), messagesOf(changing.posted)]) {
    assert.deepEqual(progressLog(other), progressLog(reference));
    const [expected, actual] = [reference.at(-1), other.at(-1)];
    assert.deepEqual(actual.bestPlan, expected.bestPlan);
    assert.deepEqual(actual.initialBestPlan, expected.initialBestPlan);
    assert.equal(actual.bestFitness, expected.bestFitness);
    assert.deepEqual(actual.scores, expected.scores);
  }
  const [changedEnd, watchEnd] = [changing.posted.at(-1)?.time ?? 0, watch.posted.at(-1)?.time ?? 0];
  assert.ok(changedEnd < watchEnd, "the pace change did not speed the run up");
});

test("stop ends the run after the current slice, 'stopped', with the best plan so far", async () => {
  /** @type {any[]} */
  const reported = [];
  /** @type {(value?: unknown) => void} */
  let firstProgress = () => {};
  const progressSeen = new Promise((resolve) => (firstProgress = resolve));
  const world = fakeWorld({
    onPost: (message) => {
      if (message.type === "progress") {
        reported.push(message);
        firstProgress();
      }
    },
  });
  const run = world.runner.handle(runMessage("r", "watch", smallSettings({ max_generations: 3000 })));
  await progressSeen;
  const lastReported = reported.at(-1);
  const lastGeneration = lastReported.generations.at(-1).generation;
  world.runner.handle({ type: "stop", runId: "r" });
  await run;

  const done = messagesOf(world.posted).at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.stopReason, "stopped");
  assert.equal(done.generations, lastGeneration, "a new slice ran after the stop");
  assert.equal(reported.at(-1), lastReported, "progress was posted after the stop");
  assert.ok(done.bestFitness >= Math.max(...reported.map((message) => message.bestFitness)));
  assert.deepEqual(done.bestPlan, lastReported.bestPlan);
});

test("a stop or pace message for another run is ignored", async () => {
  const world = fakeWorld({
    onPost: (message) => {
      if (message.type === "started") {
        queueMicrotask(() => {
          world.runner.handle({ type: "stop", runId: "older" });
          world.runner.handle({ type: "pace", runId: "older", pace: "full" });
        });
      }
    },
  });
  await world.runner.handle(runMessage("r", "watch"));
  const done = messagesOf(world.posted).at(-1);
  assert.equal(done.stopReason, "max_generations");
  assert.ok(done.durationMs >= 150 * 2.5, "the pace message of another run changed this run");
});

test("invalid settings give an error message and no run", async () => {
  const { runner, posted } = fakeWorld();
  await runner.handle(runMessage("bad", "full", smallSettings({ population_size: 1, elite_count: 0 })));
  const messages = messagesOf(posted);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "error");
  assert.equal(messages[0].runId, "bad");
  assert.match(messages[0].message, /population_size/);
});

test("an elite as large as the population gives an error", async () => {
  const { runner, posted } = fakeWorld();
  await runner.handle(runMessage("bad", "full", smallSettings({ elite_count: 16 })));
  const messages = messagesOf(posted);
  assert.deepEqual(messages.map((message) => message.type), ["error"]);
  assert.match(messages[0].message, /elite_count/);
});

test("a second run cancels the first, which never sends done", async () => {
  /** @type {(value?: unknown) => void} */
  let firstProgress = () => {};
  const progressSeen = new Promise((resolve) => (firstProgress = resolve));
  const world = fakeWorld({
    onPost: (message) => {
      if (message.type === "progress" && message.runId === "first") firstProgress();
    },
  });
  const first = world.runner.handle(runMessage("first", "watch", smallSettings({ max_generations: 3000 })));
  await progressSeen;
  const second = world.runner.handle(runMessage("second", "full", smallSettings({ seed: 2 })));
  await Promise.all([first, second]);

  const firstMessages = messagesOf(world.posted, "first");
  assert.ok(firstMessages.every((message) => message.type !== "done"));
  const secondStarted = world.posted.findIndex((entry) => entry.message.runId === "second");
  assert.ok(world.posted.slice(secondStarted).every((entry) => entry.message.runId === "second"));
  const secondMessages = messagesOf(world.posted, "second");
  assert.equal(secondMessages[0].type, "started");
  assert.equal(secondMessages.at(-1).type, "done");
  assert.equal(secondMessages.at(-1).stopReason, "max_generations");
});

test("the worker adapter hands self.onmessage to the runner and answers with self.postMessage", async () => {
  /** @type {any[]} */
  const posted = [];
  /** @type {(value?: unknown) => void} */
  let finish = () => {};
  const finished = new Promise((resolve) => (finish = resolve));
  // A stand-in for the worker's global scope, which Node does not have.
  const scope = {
    /** @param {any} message */
    postMessage(message) {
      posted.push(message);
      if (message.type === "done" || message.type === "error") finish();
    },
    /** @type {((event: {data: unknown}) => void) | null} */
    onmessage: null,
  };
  /** @type {any} */ (globalThis).self = scope;
  try {
    await import("../src/worker.js");
    assert.equal(typeof scope.onmessage, "function");
    const message = runMessage("w", "full", smallSettings({ max_generations: 20 }));
    /** @type {any} */ (scope.onmessage)({ data: message });
    await finished;
  } finally {
    delete (/** @type {any} */ (globalThis).self);
  }
  assert.equal(posted[0].type, "started");
  assert.equal(posted.at(-1).type, "done");
  assert.equal(posted.at(-1).generations, 20);
});
