// @ts-check
/**
 * Catalog search: find a song of the MPB MIDI catalog by title, composer or performer.
 *
 * `data/catalog.json` lists the songs of Beatriz Kauffmann's Web Site (title, composers,
 * performer, page and MIDI links), built once by `uv run src/main.py catalog`. The site does not
 * let other sites read its files from a browser, so the visitor downloads a picked song from the
 * site and drops it into the app; `matchDroppedFile` then recognizes the file, so the credit and
 * the page link follow it (spec 002, FR-029 to FR-032).
 *
 * Brazilian titles carry accents that visitors often skip ("voce" for "Você"), so the search
 * compares text with accents removed and in lowercase. Results are ranked as a person scans a
 * list: titles that start with the query, then titles that contain it, then composers and
 * performers, each group alphabetical.
 */

/** @typedef {{t: string, c: string, p: string, u: string, m: string[]}} CatalogEntry */
/** @typedef {{entry: CatalogEntry, title: string, key: string}} IndexedEntry */

/** Most results a search returns. */
export const MAX_RESULTS = 50;

/** Shortest query that searches. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Lowercase, without accents, with single spaces.
 *
 * @param {string} text
 * @returns {string}
 * @example
 * normalize("  Fico  Assim SEM Você ") // "fico assim sem voce"
 */
export function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text a search looks into: title, composers and performer, normalized.
 *
 * @param {CatalogEntry} entry
 * @returns {string}
 * @example
 * searchKey({t: "MULHER DE FASES", c: "Digão e Rodolfo", p: "Raimundos", u: "", m: []})
 * // "mulher de fases digao e rodolfo raimundos"
 */
export function searchKey(entry) {
  return normalize(`${entry.t} ${entry.c} ${entry.p}`);
}

/**
 * Precompute the normalized texts once, when the catalog loads.
 *
 * @param {CatalogEntry[]} entries
 * @returns {IndexedEntry[]}
 * @example
 * buildIndex(entries).length === entries.length // true
 */
export function buildIndex(entries) {
  return entries.map((entry) => ({ entry, title: normalize(entry.t), key: searchKey(entry) }));
}

/**
 * Entries whose title, composers or performer contain the query, best matches first.
 *
 * @param {IndexedEntry[]} index
 * @param {string} query
 * @returns {CatalogEntry[]} at most MAX_RESULTS; none for a query under MIN_QUERY_LENGTH
 * @example
 * search(buildIndex(entries), "voce").map((hit) => hit.t) // ["VOCÊ", "FICO ASSIM SEM VOCÊ", "POR VOCÊ"]
 */
export function search(index, query) {
  const wanted = normalize(query);
  if (wanted.length < MIN_QUERY_LENGTH) return [];
  /** @type {Array<{rank: number, item: IndexedEntry}>} */
  const hits = [];
  for (const item of index) {
    if (!item.key.includes(wanted)) continue;
    const rank = item.title.startsWith(wanted) ? 0 : item.title.includes(wanted) ? 1 : 2;
    hits.push({ rank, item });
  }
  hits.sort(
    (a, b) => a.rank - b.rank || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0),
  );
  return hits.slice(0, MAX_RESULTS).map((hit) => hit.item.entry);
}

/**
 * Whether a dropped file is the MIDI file of the picked entry.
 *
 * Browsers keep the file name of the link and add " (1)" when the name is taken, so the match
 * ignores letter case and that suffix.
 *
 * @param {string} fileName name of the dropped file
 * @param {CatalogEntry | null} entry the picked entry, or null
 * @returns {boolean}
 * @example
 * matchDroppedFile("Mulher-De-Fases (1).mid", entry) // true for ".../som/mulher-de-fases.mid"
 */
export function matchDroppedFile(fileName, entry) {
  if (!entry) return false;
  const plain = (/** @type {string} */ name) =>
    name.toLowerCase().replace(/\s*\(\d+\)(?=\.[^.]+$)/, "");
  const dropped = plain(fileName);
  return entry.m.some((url) => plain(decodeURIComponent(url.split("/").pop() ?? "")) === dropped);
}
