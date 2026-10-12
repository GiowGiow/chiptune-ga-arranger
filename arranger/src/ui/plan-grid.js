// @ts-check
/**
 * Plan grid: the arrangement plan as four rows of genes, one column per bar.
 *
 * The genetic algorithm searches over plans, not notes: each bar has four genes, the P2 harmony
 * texture, the TR bass texture, the NO drum pattern and the P1 melody octave
 * (`core/genome.js`). The grid paints the best plan found so far, in the channel colors, so a
 * visitor sees the plan settle: coherent phrases become runs of the same color, and arpeggios
 * gather on bars with a single chord. Each cell names its gene in a tooltip and to screen
 * readers, and part labels mark where a section starts.
 */

import { NO_PATTERNS, P1_OCTAVES, P2_TEXTURES, TR_TEXTURES } from "../core/genome.js";

/** Readable gene names, in gene order (spec 002, User Story 3). */
export const GENE_NAMES = Object.freeze({
  p2: ["hold", "arp16", "arp32", "echo", "third"],
  tr: ["root", "octave pump", "root-fifth", "walking"],
  no: ["none", "half time", "8th beat", "16th beat", "fill"],
  oct: ["0", "+12", "−12"],
});

const ROWS = /** @type {const} */ ([
  { key: "p2", label: "P2", channel: "--p2", gene: 0, size: P2_TEXTURES.length },
  { key: "tr", label: "TR", channel: "--tr", gene: 1, size: TR_TEXTURES.length },
  { key: "no", label: "NO", channel: "--no", gene: 2, size: NO_PATTERNS.length },
  { key: "oct", label: "P1 oct", channel: "--p1", gene: 3, size: P1_OCTAVES.length },
]);

/**
 * How strongly a gene value lights its cell: the quietest choice is faint, the busiest bright.
 * For the octave, the written octave (0) is the middle level and +12 the brightest.
 *
 * @param {"p2" | "tr" | "no" | "oct"} row
 * @param {number} value gene value
 * @returns {number} opacity from 0.15 to 1
 * @example
 * cellStrength("no", 0) // 0.15 (no drums)
 * cellStrength("no", 3) // 0.8875 (16th beat)
 */
export function cellStrength(row, value) {
  if (row === "oct") return [0.55, 1, 0.25][value];
  const size = ROWS.find((entry) => entry.key === row)?.size ?? 2;
  return 0.15 + (0.85 * value) / (size - 1);
}

/**
 * Build the grid inside `container`.
 *
 * @param {HTMLElement} container
 * @returns {{
 *   setBars: (bars: Array<{label: string}>) => void,
 *   update: (plan: Uint8Array) => void,
 * }}
 */
export function createPlanGrid(container) {
  container.classList.add("plan-grid");
  /** @type {HTMLElement[][]} */
  let cells = [];
  /** @type {Uint8Array | null} */
  let shown = null;

  return {
    setBars(bars) {
      container.innerHTML = "";
      container.style.setProperty("--bars", String(bars.length));
      const parts = document.createElement("div");
      parts.className = "plan-row parts";
      parts.append(rowLabel(""));
      bars.forEach((bar, index) => {
        const mark = document.createElement("span");
        mark.className = "part-mark";
        if (index === 0 || bar.label !== bars[index - 1].label) mark.textContent = bar.label;
        parts.append(mark);
      });
      container.append(parts);
      cells = ROWS.map((row) => {
        const line = document.createElement("div");
        line.className = "plan-row";
        line.append(rowLabel(row.label));
        const rowCells = bars.map((_, index) => {
          const cell = document.createElement("span");
          cell.className = "gene";
          cell.style.setProperty("--c", `var(${row.channel})`);
          cell.dataset.bar = String(index + 1);
          line.append(cell);
          return cell;
        });
        container.append(line);
        return rowCells;
      });
      const legend = document.createElement("dl");
      legend.className = "plan-legend";
      for (const row of ROWS) {
        const term = document.createElement("dt");
        term.textContent = row.label;
        term.style.setProperty("--c", `var(${row.channel})`);
        const values = document.createElement("dd");
        values.textContent = GENE_NAMES[row.key].join(" · ");
        legend.append(term, values);
      }
      container.append(legend);
      shown = null;
    },
    update(plan) {
      ROWS.forEach((row, rowIndex) => {
        cells[rowIndex]?.forEach((cell, bar) => {
          const value = plan[bar * 4 + row.gene];
          if (shown && shown[bar * 4 + row.gene] === value) return;
          const name = GENE_NAMES[row.key][value];
          cell.style.opacity = String(cellStrength(row.key, value));
          cell.title = `Bar ${bar + 1} · ${row.label}: ${name}`;
          cell.setAttribute("aria-label", cell.title);
          cell.dataset.name = name;
        });
      });
      shown = plan.slice();
    },
  };
}

/** @param {string} text */
function rowLabel(text) {
  const label = document.createElement("span");
  label.className = "row-label mono";
  label.textContent = text;
  return label;
}
