// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIndex, matchDroppedFile, normalize, search, searchKey } from "../src/core/catalog.js";

const entry = (/** @type {string} */ t, /** @type {string} */ c, /** @type {string} */ p, /** @type {string} */ slug) => ({
  t,
  c,
  p,
  u: `https://www.beakauffmann.com/mpb_x/${slug}.html`,
  m: [`https://www.beakauffmann.com/mpb_x/som/${slug}.mid`],
});

const entries = [
  entry("MULHER DE FASES", "Digão e Rodolfo", "Raimundos", "mulher-de-fases"),
  entry("POR VOCÊ", "Frejat, Maurício Barros e Mauro Santa Cecília", "Barão Vermelho", "por-voce"),
  entry("FICO ASSIM SEM VOCÊ", "Abdullah e Cacá Moraes", "Adriana Calcanhotto", "fico-assim-sem-voce"),
  entry("VOCÊ", "Tim Maia", "Tim Maia", "voce"),
  entry("AMOR I LOVE YOU", "Carlinhos Brown e Marisa Monte", "Marisa Monte", "amor-i-love-you"),
  entry("O QUE É O AMOR", "Arlindo Cruz", "Maria Rita", "o-que-e-o-amor"),
];

test("normalizing drops accents, letter case and extra spaces", () => {
  assert.equal(normalize("  Fico  Assim SEM Você "), "fico assim sem voce");
  assert.equal(normalize("Digão"), "digao");
});

test("the search key joins title, composers and performer", () => {
  assert.equal(searchKey(entries[0]), "mulher de fases digao e rodolfo raimundos");
});

test("a search matches any part of title, composer or performer, accents ignored", () => {
  const index = buildIndex(entries);
  assert.deepEqual(search(index, "fases").map((hit) => hit.t), ["MULHER DE FASES"]);
  assert.ok(search(index, "voce").some((hit) => hit.t === "POR VOCÊ"));
  assert.deepEqual(search(index, "raimundos").map((hit) => hit.t), ["MULHER DE FASES"]);
  assert.deepEqual(search(index, "calcanhotto").map((hit) => hit.t), ["FICO ASSIM SEM VOCÊ"]);
  assert.deepEqual(search(index, "brown").map((hit) => hit.t), ["AMOR I LOVE YOU"]);
});

test("results rank title prefix, then title substring, then composer or performer, then A to Z", () => {
  const index = buildIndex(entries);
  assert.deepEqual(search(index, "voce").map((hit) => hit.t), ["VOCÊ", "FICO ASSIM SEM VOCÊ", "POR VOCÊ"]);
  assert.deepEqual(search(index, "amor").map((hit) => hit.t), ["AMOR I LOVE YOU", "O QUE É O AMOR"]);
  assert.deepEqual(search(index, "maria").map((hit) => hit.t), ["O QUE É O AMOR"]);
});

test("a search needs 2 characters and returns at most 50 results", () => {
  const many = Array.from({ length: 80 }, (_, i) => entry(`SAMBA ${i}`, "", "", `samba-${i}`));
  const index = buildIndex(many);
  assert.equal(search(index, "s").length, 0);
  assert.equal(search(index, " ").length, 0);
  assert.equal(search(index, "samba").length, 50);
});

test("a dropped file matches the picked entry by its MIDI file name, whatever the case", () => {
  assert.equal(matchDroppedFile("mulher-de-fases.mid", entries[0]), true);
  assert.equal(matchDroppedFile("Mulher-De-Fases.MID", entries[0]), true);
  assert.equal(matchDroppedFile("mulher-de-fases (1).mid", entries[0]), true);
  assert.equal(matchDroppedFile("other.mid", entries[0]), false);
  assert.equal(matchDroppedFile("mulher-de-fases.mid", null), false);
});
