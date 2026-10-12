// @ts-check
// The GA worker: runs the genetic algorithm off the page's main thread, so drawing, sound and
// clicks stay responsive while a run evolves (constitution, Web App Constraints; research R6).
//
// This file only wires the worker's message channel, clock and timers to the runner
// (runner.js), which holds the protocol of contracts/worker-protocol.md and is tested without a
// browser. The page creates it with
// `new Worker(new URL("../worker.js", import.meta.url), { type: "module" })`.

import { createRunner } from "./runner.js";

/**
 * The parts of the dedicated worker scope used here.
 * @type {{
 *   postMessage: (message: unknown) => void,
 *   onmessage: ((event: MessageEvent) => void) | null,
 * }}
 */
const scope = /** @type {any} */ (self);

const runner = createRunner({
  post: (message) => scope.postMessage(message),
  now: () => performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

scope.onmessage = (event) => {
  runner.handle(event.data);
};
