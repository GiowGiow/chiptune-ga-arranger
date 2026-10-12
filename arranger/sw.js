// @ts-nocheck
/*
 * Service worker: keeps the arranger working offline after the first visit (spec 002, FR-035).
 *
 * On install it stores the app shell (the page, its modules, the ABC parser, the fonts) and the
 * repository files the app reads (the defaults, the song manifest and the 8 example lead sheets).
 * A deployed copy serves them cache first, so a repeat visit opens without the network; the cache
 * name holds the deployed commit, so a new deploy installs a fresh cache and deletes the old one.
 * A local copy ("dev") goes to the network first, so edits show up on reload. The catalog list is
 * cached the first time the catalog panel loads it. Only same-origin GET requests are handled:
 * catalog links open on their own site, untouched.
 */

const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "version.json",
  "src/audio/chip-synth.js",
  "src/audio/loudness.js",
  "src/audio/plain-synth.js",
  "src/audio/player.js",
  "src/core/abc-reader.js",
  "src/core/abc-writer.js",
  "src/core/arrangement.js",
  "src/core/catalog.js",
  "src/core/chords.js",
  "src/core/evolution.js",
  "src/core/fitness.js",
  "src/core/genome.js",
  "src/core/leadsheet.js",
  "src/core/midi-export.js",
  "src/core/midi-file.js",
  "src/core/midi-song.js",
  "src/core/operators.js",
  "src/core/random.js",
  "src/core/settings.js",
  "src/core/tables.js",
  "src/core/textures.js",
  "src/runner.js",
  "src/ui/catalog-panel.js",
  "src/ui/channel-paths.js",
  "src/ui/channel-view.js",
  "src/ui/downloads.js",
  "src/ui/evolution-view.js",
  "src/ui/examples.js",
  "src/ui/gm-programs.js",
  "src/ui/input-panel.js",
  "src/ui/main.js",
  "src/ui/plan-grid.js",
  "src/ui/run-list.js",
  "src/ui/runs.js",
  "src/ui/settings-form.js",
  "src/ui/settings-panel.js",
  "src/worker.js",
  "vendor/abcjs/abcjs-basic-min.js",
  "vendor/fonts/inter-latin.woff2",
  "vendor/fonts/jetbrains-mono-latin.woff2",
  "../configs/default.json",
  "../data/sources.json",
  "../data/leadsheets/amor_i_love_you.abc",
  "../data/leadsheets/aquarela.abc",
  "../data/leadsheets/fico_assim_sem_voce.abc",
  "../data/leadsheets/ievan_polkka.abc",
  "../data/leadsheets/korobeiniki.abc",
  "../data/leadsheets/mulher_de_fases.abc",
  "../data/leadsheets/por_voce.abc",
  "../data/leadsheets/voa_voa.abc",
];

const PREFIX = "nes-arranger-";

/** The deployed commit, or "dev" for a local copy. */
async function currentVersion() {
  try {
    const response = await fetch("version.json", { cache: "no-store" });
    return (await response.json()).commit || "dev";
  } catch {
    return "dev";
  }
}

let versionPromise = null;
function version() {
  versionPromise ??= currentVersion();
  return versionPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PREFIX + (await version()));
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = PREFIX + (await version());
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== keep) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const name = await version();
      const cache = await caches.open(PREFIX + name);
      if (name !== "dev") {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
