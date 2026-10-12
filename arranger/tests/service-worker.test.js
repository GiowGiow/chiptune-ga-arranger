// @ts-check
// The service worker precaches the app shell for offline use (spec 002, FR-035). Its list is
// written by hand in sw.js, so this test keeps it in step with the files the app loads.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { repoRoot } from "./helpers.js";

const appDir = join(repoRoot, "arranger");
const source = readFileSync(join(appDir, "sw.js"), "utf8");

/** @param {string} directory */
function filesUnder(directory) {
  /** @type {string[]} */
  const found = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(relative(appDir, path));
  }
  return found;
}

function precacheList() {
  const block = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, "sw.js declares const APP_SHELL = [...]");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("every module, style, font and vendor script of the app is precached", () => {
  const expected = [
    "./",
    "index.html",
    "style.css",
    "version.json",
    ...filesUnder(join(appDir, "src")),
    "vendor/abcjs/abcjs-basic-min.js",
    ...filesUnder(join(appDir, "vendor/fonts")).filter((path) => path.endsWith(".woff2")),
  ].sort();
  const listed = precacheList().filter((path) => !path.startsWith("../")).sort();
  assert.deepEqual(listed, expected);
});

test("the defaults, the manifest and the 8 example lead sheets are precached from the repository", () => {
  const outside = precacheList().filter((path) => path.startsWith("../"));
  const leadSheets = readdirSync(join(repoRoot, "data/leadsheets")).filter((name) => name.endsWith(".abc"));
  assert.deepEqual(
    outside.sort(),
    ["../configs/default.json", "../data/sources.json", ...leadSheets.map((name) => `../data/leadsheets/${name}`)].sort(),
  );
});
