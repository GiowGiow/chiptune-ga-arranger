// @ts-check
/**
 * Runs view: the last 5 runs of the visit, each with its seed, its changed settings and its
 * best fitness (spec 002, FR-019). A click brings a run back: its plan, its curve and its sound.
 */

import { describeRun } from "./run-list.js";

/**
 * Build the view inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{defaults: import("../core/settings.js").Settings, onSelect: (id: string) => void}} options
 * @returns {{render: (runs: import("./run-list.js").RunEntry[], activeId: string | null) => void}}
 */
export function createRunsView(container, options) {
  container.classList.add("runs");
  return {
    render(runs, activeId) {
      container.innerHTML = runs.length
        ? `<h3 class="subhead">Runs of this visit</h3><ol class="run-list"></ol>`
        : "";
      const list = container.querySelector("ol");
      for (const run of runs) {
        const described = describeRun(run, options.defaults);
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "run";
        button.setAttribute("aria-pressed", String(run.id === activeId));
        button.innerHTML = `<span class="mono fitness"></span><span class="mono seed"></span><span class="changes"></span>`;
        /** @type {HTMLElement} */ (button.querySelector(".fitness")).textContent = described.fitness;
        /** @type {HTMLElement} */ (button.querySelector(".seed")).textContent = `seed ${described.seed}`;
        const changes = /** @type {HTMLElement} */ (button.querySelector(".changes"));
        if (described.changed.length === 0) {
          changes.textContent = "default settings";
        }
        for (const { key, value } of described.changed) {
          const chip = document.createElement("span");
          chip.className = "changed mono";
          chip.textContent = `${key} ${value}`;
          changes.append(chip);
        }
        button.title = run.id;
        button.addEventListener("click", () => options.onSelect(run.id));
        item.append(button);
        list?.append(item);
      }
    },
  };
}
