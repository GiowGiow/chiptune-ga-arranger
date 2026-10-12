// @ts-check
/**
 * Evolution view: the fitness curve and the two stopping counters, drawn while the GA runs.
 *
 * Every generation of the genetic algorithm has a best plan and a population mean. The curve
 * shows both: the best line climbs in steps (elitism keeps the best plan, so it never goes down)
 * and the mean line follows it as selection fills the population with copies of good plans. Two
 * counters show why a run stops: the generation counter against the maximum, and the stagnation
 * counter, the generations since the best fitness last improved, against its window. The page
 * figure of the command line's `evolution.png` (`src/export/figures.py`) shows the same curves
 * after a run; here they grow live from the worker's `progress` messages
 * (contracts/worker-protocol.md).
 */

/** @typedef {{generation: number, best: number, mean: number, diversity: number, stagnation: number}} GenerationStats */

/**
 * Build the view inside `container` and return its controls.
 *
 * @param {HTMLElement} container element that receives the chart, the counters and the caption
 * @returns {{
 *   reset: (limits: {maxGenerations: number, stagnationWindow: number}) => void,
 *   append: (generations: GenerationStats[]) => void,
 *   show: (log: GenerationStats[], limits: {maxGenerations: number, stagnationWindow: number}) => void,
 *   finish: (summary: {stopReason: string, generations: number, durationMs: number}) => void,
 * }}
 */
export function createEvolutionView(container) {
  container.innerHTML = `
    <div class="counters">
      <div class="counter"><span class="label">Generation</span>
        <span class="value mono" data-generation>0 / 0</span>
        <span class="meter"><span data-generation-bar></span></span></div>
      <div class="counter"><span class="label">Without improvement</span>
        <span class="value mono" data-stagnation>0 / 0</span>
        <span class="meter stagnation"><span data-stagnation-bar></span></span></div>
      <div class="counter"><span class="label">Best fitness</span>
        <span class="value mono" data-best>–</span>
        <span class="status" data-status>Waiting for a run</span></div>
    </div>
    <canvas class="chart" data-chart role="img"
      aria-label="Fitness per generation: best and mean of the population"></canvas>
    <p class="caption">Best fitness (blue) and population mean (gray) per generation. The best line
    only climbs, because the best plans pass unchanged to the next generation (elitism). The run
    stops when the counter "without improvement" fills its window, or at the maximum.</p>`;
  const $ = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (container.querySelector(selector));
  const canvas = /** @type {HTMLCanvasElement} */ ($("[data-chart]"));
  /** @type {GenerationStats[]} */
  let log = [];
  let limits = { maxGenerations: 1, stagnationWindow: 1 };
  let frame = 0;

  function redraw() {
    frame = 0;
    const last = log.at(-1);
    if (last) {
      $("[data-generation]").textContent = `${last.generation} / ${limits.maxGenerations}`;
      $("[data-stagnation]").textContent = `${last.stagnation} / ${limits.stagnationWindow}`;
      $("[data-best]").textContent = last.best.toFixed(4);
      setBar($("[data-generation-bar]"), last.generation / limits.maxGenerations);
      setBar($("[data-stagnation-bar]"), last.stagnation / limits.stagnationWindow);
    }
    drawChart(canvas, log);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(redraw);
  }

  new ResizeObserver(schedule).observe(canvas);

  return {
    reset(newLimits) {
      limits = newLimits;
      log = [];
      $("[data-status]").textContent = "Evolving…";
      $("[data-best]").textContent = "–";
      $("[data-generation]").textContent = `0 / ${limits.maxGenerations}`;
      $("[data-stagnation]").textContent = `0 / ${limits.stagnationWindow}`;
      setBar($("[data-generation-bar]"), 0);
      setBar($("[data-stagnation-bar]"), 0);
      schedule();
    },
    append(generations) {
      log.push(...generations);
      schedule();
    },
    show(fullLog, newLimits) {
      limits = newLimits;
      log = [...fullLog];
      schedule();
    },
    finish({ stopReason, generations, durationMs }) {
      const reasons = {
        stagnation: "stopped by stagnation",
        max_generations: "reached the maximum",
        stopped: "stopped by you",
      };
      const reason = reasons[/** @type {keyof typeof reasons} */ (stopReason)] ?? stopReason;
      $("[data-status]").textContent =
        `${generations} generations, ${reason}, in ${(durationMs / 1000).toFixed(1)} s`;
      schedule();
    },
  };
}

/**
 * @param {HTMLElement} bar
 * @param {number} share from 0 to 1
 */
function setBar(bar, share) {
  bar.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
}

/**
 * Draw best and mean fitness against the generation, scaled to the canvas size.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {GenerationStats[]} log
 */
function drawChart(canvas, log) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const style = getComputedStyle(canvas);
  const color = (/** @type {string} */ name) => style.getPropertyValue(name).trim();

  const pad = { left: 44, right: 10, top: 10, bottom: 24 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const lastGeneration = Math.max(50, log.at(-1)?.generation ?? 0);
  const low = log.length ? Math.min(...log.map((entry) => entry.mean)) : 0;
  const yMin = Math.max(0, Math.floor(low * 10) / 10 - 0.05);
  const yMax = 1;
  const x = (/** @type {number} */ generation) => pad.left + (generation / lastGeneration) * plotWidth;
  const y = (/** @type {number} */ value) =>
    pad.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

  context.font = `11px ${color("--mono")}`;
  context.fillStyle = color("--muted");
  context.strokeStyle = color("--line");
  context.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + ((yMax - yMin) * tick) / 4;
    context.beginPath();
    context.moveTo(pad.left, y(value));
    context.lineTo(width - pad.right, y(value));
    context.stroke();
    context.fillText(value.toFixed(2), 4, y(value) + 4);
  }
  context.fillText("0", pad.left, height - 6);
  const lastLabel = String(lastGeneration);
  context.fillText(lastLabel, width - pad.right - context.measureText(lastLabel).width, height - 6);

  if (log.length < 2) return;
  // Long runs have thousands of generations: one point per pixel column is enough.
  const step = Math.max(1, Math.floor(log.length / plotWidth));
  for (const [key, name, lineWidth] of /** @type {const} */ ([
    ["mean", "--muted", 1.5],
    ["best", "--p1", 2.5],
  ])) {
    context.strokeStyle = color(name);
    context.lineWidth = lineWidth;
    context.beginPath();
    for (let index = 0; index < log.length; index += step) {
      const entry = log[index];
      if (index === 0) context.moveTo(x(entry.generation), y(entry[key]));
      else context.lineTo(x(entry.generation), y(entry[key]));
    }
    const last = /** @type {GenerationStats} */ (log.at(-1));
    context.lineTo(x(last.generation), y(last[key]));
    context.stroke();
  }
}
