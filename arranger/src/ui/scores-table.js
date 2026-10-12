// @ts-check
/**
 * Scores table: how the best plan scored on each of the seven fitness criteria.
 *
 * The fitness is the weighted mean of the criterion scores, each from 0 to 1 (`core/fitness.js`).
 * The table lists every criterion with its weight and its score, and draws the score as a bar on
 * the same 0 to 1 scale, so the criterion that holds the fitness back is the shortest bar. Scores
 * show two decimals, enough to tell plans apart by ear. A criterion that does not apply to the
 * song (contrast without a chorus) has no score and drops out of the mean.
 */

import { CRITERIA } from "../core/fitness.js";

/** Criterion names as the settings panel shows them. */
const CRITERION_LABELS = Object.freeze({
  complementarity: "Complementarity",
  register: "Register",
  coherence: "Coherence",
  contrast: "Contrast",
  bass_smoothness: "Bass smoothness",
  idiom: "NES idiom",
  fidelity: "Fidelity",
});

/**
 * @typedef {{name: string, label: string, weight: string, score: string, bar: number | null}} ScoreRow
 */

/**
 * What the table shows for a plan's scores.
 *
 * @param {Record<string, number | null>} scores score of each criterion, null or NaN when it does not apply
 * @param {number} fitness the weighted mean of the scores
 * @param {Record<string, number>} weights
 * @returns {{rows: ScoreRow[], fitness: string}}
 * @example
 * describeScores({...scores, register: 0.976}, 0.9106, weights).rows[1].score // "0.98"
 */
export function describeScores(scores, fitness, weights) {
  const rows = CRITERIA.map((name) => {
    const score = scores[name];
    const applies = score !== null && score !== undefined && !Number.isNaN(score);
    return {
      name,
      label: CRITERION_LABELS[/** @type {keyof typeof CRITERION_LABELS} */ (name)] ?? name,
      weight: String(weights[name]),
      score: applies ? score.toFixed(2) : "not applicable",
      bar: applies ? score : null,
    };
  });
  return { rows, fitness: fitness.toFixed(2) };
}

/**
 * Draw the table inside `container`, replacing what was there.
 *
 * @param {HTMLElement} container
 * @param {Record<string, number | null>} scores
 * @param {number} fitness
 * @param {Record<string, number>} weights
 */
export function renderScores(container, scores, fitness, weights) {
  const table = describeScores(scores, fitness, weights);
  const rows = table.rows
    .map(
      (row) => `<tr><th scope="row">${row.label}</th><td class="num mono">${row.weight}</td>
        <td class="num mono">${row.score}</td>
        <td class="bar-cell">${row.bar === null ? "" : `<span class="score-bar"><span style="width: ${row.bar * 100}%"></span></span>`}</td></tr>`,
    )
    .join("");
  container.innerHTML = `<table>
    <thead><tr><th scope="col">Criterion</th><th scope="col" class="num">Weight</th>
      <th scope="col" class="num">Score</th><th scope="col"><span class="visually-hidden">Score from 0 to 1</span>
      <span class="scale" aria-hidden="true"><span>0</span><span>1</span></span></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th scope="row">Fitness <span class="hint">(weighted mean)</span></th><td></td>
      <td class="num mono">${table.fitness}</td>
      <td class="bar-cell"><span class="score-bar"><span style="width: ${fitness * 100}%"></span></span></td></tr></tfoot>
  </table>`;
}
