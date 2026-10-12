// @ts-check
/**
 * Examples: the lead sheets committed with the project, offered as one-click inputs.
 *
 * A visitor without a file at hand can arrange the same songs as the listening page's samples.
 * The two traditional tunes were written as lead sheets for the project; the six MIDI songs are
 * the project's reductions of fan-made MIDI files (`data/sources.json`), saved as ABC so that
 * no third-party file is needed. The app reads them from the repository at run time
 * (`../data/leadsheets/`), so the examples never drift from the committed files.
 *
 * MIDI songs are longer, and the samples evolved them with up to 4000 generations and a
 * stagnation window of 400 (README, "Reproduce"); their examples carry those settings.
 */

/**
 * @typedef {{
 *   id: string, title: string, artist: string, path: string,
 *   overrides: Partial<Record<"max_generations" | "stagnation_window", number>>
 * }} Example
 */

/** The hand-written lead sheets of the two traditional tunes. */
export const TRADITIONAL_EXAMPLES = Object.freeze([
  { id: "korobeiniki", title: "Korobeiniki (Tetris theme)", artist: "Traditional (Russia)" },
  { id: "ievan_polkka", title: "Ievan Polkka", artist: "Traditional (Finland)" },
]);

/** Stopping limits of the MIDI-song samples. */
const MIDI_SONG_OVERRIDES = Object.freeze({ max_generations: 4000, stagnation_window: 400 });

/**
 * The example list: traditional tunes first, then the MIDI songs in manifest order.
 *
 * @param {{songs: Array<{id: string, title: string, artist: string, abc: string}>}} sources
 *   the parsed `data/sources.json`
 * @returns {Example[]} paths relative to the app folder
 * @example
 * buildExamples(sources).map((example) => example.id).slice(0, 3)
 * // ["korobeiniki", "ievan_polkka", "voa_voa"]
 */
export function buildExamples(sources) {
  const traditional = TRADITIONAL_EXAMPLES.map((tune) => ({
    ...tune,
    path: `../data/leadsheets/${tune.id}.abc`,
    overrides: {},
  }));
  const songs = sources.songs.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    path: `../${song.abc}`,
    overrides: { ...MIDI_SONG_OVERRIDES },
  }));
  return [...traditional, ...songs];
}
