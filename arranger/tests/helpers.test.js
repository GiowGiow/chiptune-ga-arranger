// @ts-check
// Self-test of tests/helpers.js, the small toolbox every other test file uses: where the
// repository is, how to read the JSON fixtures that the Python reference writes (NaN stored as
// null), how to compare numbers to a number of decimal places as numpy's assert_almost_equal
// does, and how to load the vendored abcjs parser in Node.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertClose,
  fixturesDir,
  loadAbcjs,
  nullToNaN,
  rawMidiPath,
  readFixture,
  readJson,
  repoRoot,
} from "./helpers.js";

test("repoRoot is the repository root, which holds configs/default.json", () => {
  assert.ok(existsSync(join(repoRoot, "configs", "default.json")));
  assert.ok(existsSync(join(repoRoot, "arranger", "package.json")));
});

test("loadAbcjs returns the abcjs object, with parseOnly", () => {
  const ABCJS = loadAbcjs();
  assert.equal(typeof ABCJS.parseOnly, "function");
});

test("loadAbcjs gives a parser that reads a chord symbol and a note without a DOM", () => {
  const tunes = loadAbcjs().parseOnly('X:1\nT:Test\nM:4/4\nL:1/4\nK:C\n"C"C D E F|\n');
  assert.equal(tunes.length, 1);
  assert.deepEqual(tunes[0].metaText.title, "Test");
});

test("assertClose passes when the numbers agree to 6 decimal places", () => {
  assertClose(0.1 + 0.2, 0.3);
  assertClose(0.9221234, 0.9221239);
});

test("assertClose fails when the numbers differ in the 6th decimal place", () => {
  assert.throws(() => assertClose(0.922123, 0.922126), /0\.922123/);
});

test("assertClose takes the number of decimal places as its third argument", () => {
  assertClose(0.91, 0.93, 1);
  assert.throws(() => assertClose(0.91, 0.93, 2));
});

test("assertClose treats NaN and null (NaN in a fixture) as equal to each other", () => {
  assertClose(Number.NaN, null);
  assertClose(Number.NaN, Number.NaN);
  assert.throws(() => assertClose(0.5, null));
  assert.throws(() => assertClose(Number.NaN, 0.5));
});

test("assertClose compares nested arrays element by element and names the failing index", () => {
  assertClose(
    [
      [1, Number.NaN],
      [0.5, 0.25],
    ],
    [
      [1.0000001, null],
      [0.5, 0.25],
    ],
  );
  assert.throws(
    () =>
      assertClose(
        [
          [1, 2],
          [3, 4],
        ],
        [
          [1, 2],
          [3, 5],
        ],
      ),
    /\[1\]\[1\]/,
  );
  assert.throws(() => assertClose([1, 2], [1, 2, 3]), /length/);
});

test("assertClose compares objects key by key, numbers to the decimals and other values exactly", () => {
  assertClose({ fitness: 0.9221234, name: "korobeiniki" }, { fitness: 0.9221236, name: "korobeiniki" });
  assert.throws(() => assertClose({ name: "a" }, { name: "b" }));
  assert.throws(() => assertClose({ a: 1 }, { a: 1, b: 2 }), /keys/);
});

test("nullToNaN turns every null of a nested array into NaN and keeps the other values", () => {
  assert.deepEqual(nullToNaN([[1, null], null, "x"]), [[1, Number.NaN], Number.NaN, "x"]);
});

test("fixturesDir is arranger/tests/fixtures", () => {
  assert.equal(fixturesDir, join(repoRoot, "arranger", "tests", "fixtures"));
});

/**
 * Write a JSON text to a temporary file, call `use` with its path, then delete the folder.
 *
 * @param {string} text
 * @param {(path: string) => void} use
 */
function withJsonFile(text, use) {
  const folder = mkdtempSync(join(tmpdir(), "arranger-helpers-"));
  try {
    const path = join(folder, "fixture.json");
    writeFileSync(path, text);
    use(path);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const TABLE_TEXT = '{"act_p2": [[0.5, null], [null, 1]], "tempo_bpm": null}';

test("readJson keeps null as null when the caller does not ask for NaN", () => {
  withJsonFile(TABLE_TEXT, (path) => {
    assert.deepEqual(readJson(path), { act_p2: [[0.5, null], [null, 1]], tempo_bpm: null });
  });
});

test("readJson turns every null into NaN with nullAsNaN true", () => {
  withJsonFile(TABLE_TEXT, (path) => {
    assert.deepEqual(readJson(path, { nullAsNaN: true }), {
      act_p2: [
        [0.5, Number.NaN],
        [Number.NaN, 1],
      ],
      tempo_bpm: Number.NaN,
    });
  });
});

test("readJson turns null into NaN only under the keys the caller names", () => {
  withJsonFile(TABLE_TEXT, (path) => {
    assert.deepEqual(readJson(path, { nullAsNaN: ["act_p2"] }), {
      act_p2: [
        [0.5, Number.NaN],
        [Number.NaN, 1],
      ],
      tempo_bpm: null,
    });
  });
});

test("readFixture fails with the path when the fixture file is missing", () => {
  assert.throws(() => readFixture("no-such-folder/no-such-file.json"), /no-such-file\.json/);
});

test("rawMidiPath returns null when data/raw lacks the file", () => {
  assert.equal(rawMidiPath("no-such-folder/no-such-song.mid"), null);
});

test("rawMidiPath returns the absolute path when data/raw has the file", (t) => {
  if (!existsSync(join(repoRoot, "data", "raw", "mpb", "amor_i_love_you.mid"))) {
    t.skip("run uv run src/main.py fetch");
    return;
  }
  assert.equal(rawMidiPath("mpb/amor_i_love_you.mid"), join(repoRoot, "data", "raw", "mpb", "amor_i_love_you.mid"));
});
