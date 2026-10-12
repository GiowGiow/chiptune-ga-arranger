// @ts-check
/**
 * Catalog panel: search the MPB MIDI catalog, then download a song from its site and drop it in.
 *
 * The catalog site sends no permission for other sites to read its files, and the app uses no
 * relay (spec 002, FR-031), so a picked song reaches the app in two steps that the panel spells
 * out: open the song's MIDI link on the catalog site, where the browser saves the file, then drop
 * the saved file back here (or anywhere on the Song card). The panel remembers the pick, so the dropped file keeps
 * the catalog's credit and the song page link (FR-032). The catalog list loads only when the
 * search box is first used.
 */

import { buildIndex, matchDroppedFile, search } from "../core/catalog.js";

/** @typedef {import("../core/catalog.js").CatalogEntry} CatalogEntry */

/**
 * Build the panel inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{onFile: (file: File) => void}} options `onFile` reads a file chosen in step 2
 * @returns {{claim: (fileName: string) => CatalogEntry | null}} `claim` tells whether a dropped
 *   file is the picked song
 */
export function createCatalogPanel(container, options) {
  container.insertAdjacentHTML(
    "beforeend",
    `<p class="hint">Songs of <a href="https://www.beakauffmann.com/" rel="noopener">Beatriz
     Kauffmann's Web Site</a>, a non-commercial site of MIDI sequences of Brazilian popular music.
     The app keeps only titles, names and links; the files stay on that site.</p>
     <label class="block">Search by title, composer or performer
       <input type="search" data-catalog-query autocomplete="off" placeholder="for example: fases, Raimundos, Jobim"></label>
     <p class="status" data-catalog-status role="status" aria-live="polite"></p>
     <ol class="catalog-results" data-catalog-results></ol>
     <div class="catalog-pick" data-catalog-pick hidden></div>`,
  );
  const query = /** @type {HTMLInputElement} */ (container.querySelector("[data-catalog-query]"));
  const status = /** @type {HTMLElement} */ (container.querySelector("[data-catalog-status]"));
  const results = /** @type {HTMLElement} */ (container.querySelector("[data-catalog-results]"));
  const pickBox = /** @type {HTMLElement} */ (container.querySelector("[data-catalog-pick]"));
  /** @type {import("../core/catalog.js").IndexedEntry[] | null} */
  let index = null;
  /** @type {Promise<void> | null} */
  let loading = null;
  /** @type {CatalogEntry | null} */
  let picked = null;

  function load() {
    loading ??= fetch("data/catalog.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((catalog) => {
        index = buildIndex(catalog.entries);
        status.textContent = `${catalog.entries.length} songs (list of ${catalog.retrieved}).`;
        render();
      })
      .catch((error) => {
        loading = null;
        status.textContent = `The catalog list could not be loaded (${error.message}). The rest of the app still works.`;
        status.classList.add("error");
      });
    return loading;
  }

  function render() {
    results.innerHTML = "";
    if (!index) return;
    const hits = search(index, query.value);
    if (query.value.trim().length >= 2 && hits.length === 0) {
      status.textContent = "No song matches.";
    }
    for (const entry of hits) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-hit";
      button.innerHTML = `<span class="title"></span><span class="names"></span>`;
      /** @type {HTMLElement} */ (button.querySelector(".title")).textContent = entry.t;
      /** @type {HTMLElement} */ (button.querySelector(".names")).textContent =
        [entry.c, entry.p].filter(Boolean).join(" — ");
      button.addEventListener("click", () => pick(entry));
      item.append(button);
      results.append(item);
    }
  }

  /** @param {CatalogEntry} entry */
  function pick(entry) {
    picked = entry;
    const links = entry.m
      .map(
        (url, number) =>
          `<a class="button" href="${encodeURI(url)}" target="_blank" rel="noopener" download>Open the MIDI on the catalog site${
            entry.m.length > 1 ? ` (${number + 1})` : ""
          }</a>`,
      )
      .join(" ");
    pickBox.innerHTML = `<p class="picked"><strong></strong><span class="names"></span>
      <a href="${encodeURI(entry.u)}" target="_blank" rel="noopener">song page</a></p>
      <ol class="two-steps">
        <li>${links}<span class="hint">Your browser saves the file.</span></li>
        <li><label class="button">Choose the saved file
            <input type="file" accept=".mid,.midi,.kar" data-catalog-file hidden></label>
          <span class="hint">Or drop it anywhere on this card. The arranger recognizes it and keeps the credit.</span></li>
      </ol>`;
    const chooser = /** @type {HTMLInputElement} */ (pickBox.querySelector("[data-catalog-file]"));
    chooser.addEventListener("change", () => {
      const file = chooser.files?.[0];
      chooser.value = "";
      if (file) options.onFile(file);
    });
    /** @type {HTMLElement} */ (pickBox.querySelector("strong")).textContent = entry.t;
    /** @type {HTMLElement} */ (pickBox.querySelector(".names")).textContent =
      ` — ${[entry.c, entry.p].filter(Boolean).join(", ")} · `;
    pickBox.hidden = false;
  }

  query.addEventListener("focus", () => load(), { once: true });
  query.addEventListener("input", async () => {
    await load();
    if (index) {
      status.classList.remove("error");
      status.textContent = query.value.trim().length < 2 ? "Type at least 2 letters." : "";
    }
    render();
  });

  return {
    claim(fileName) {
      return matchDroppedFile(fileName, picked) ? picked : null;
    },
  };
}
