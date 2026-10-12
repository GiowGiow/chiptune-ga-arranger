// @ts-check
/**
 * Channel paths: each NES channel drawn as a step line that the playhead reveals.
 *
 * A monophonic channel is a melody line: one pitch at a time, held until the next note or a
 * rest. Drawn as a step line (pitch on y, time on x), each note is a flat segment and each jump is
 * an interval, so a listener can follow every channel at once. These pure functions port the
 * command line's video (`src/export/figures.py` `step_line`, `src/export/video.py`
 * `visible_until` and `sounding_pitch`): the line is revealed up to the playhead, the note that
 * sounds is drawn only up to now, and the glowing tip marks the pitch that plays.
 */

/** @typedef {{x: number[], y: number[]}} StepLine x in seconds (or beats), y in MIDI pitch, NaN at rests */

/**
 * The points of a step line for a monophonic channel, with a NaN point where a rest starts.
 *
 * @param {Array<{pitch: number, onset: number, duration: number}>} notes in one time unit
 * @returns {StepLine}
 * @example
 * stepLine([{pitch: 60, onset: 0, duration: 1}, {pitch: 62, onset: 2, duration: 1}])
 * // {x: [0, 1, 2, 3], y: [60, NaN, 62, 62]}
 */
export function stepLine(notes) {
  /** @type {StepLine} */
  const line = { x: [], y: [] };
  /** @type {number | null} */
  let previousEnd = null;
  for (const note of [...notes].sort((a, b) => a.onset - b.onset)) {
    if (previousEnd !== null && note.onset > previousEnd + 1e-9) {
      line.x.push(previousEnd);
      line.y.push(NaN);
    }
    line.x.push(note.onset);
    line.y.push(note.pitch);
    previousEnd = note.onset + note.duration;
  }
  if (previousEnd !== null) {
    line.x.push(previousEnd);
    line.y.push(/** @type {number} */ (line.y.at(-1)));
  }
  return line;
}

/**
 * The part of a step line between `start` and the playhead `t`, as seen at time `t`.
 *
 * @param {StepLine} line
 * @param {number} t playhead time
 * @param {number} [start] left edge of the window; the note sounding there enters from the left
 * @returns {StepLine}
 * @example
 * visibleUntil({x: [0, 1, 2, 3], y: [60, NaN, 62, 62]}, 2.5) // {x: [0, 1, 2, 2.5], y: [60, NaN, 62, 62]}
 */
export function visibleUntil(line, t, start = -Infinity) {
  const current = lastAtOrBefore(line.x, t);
  if (current < 0) return { x: [], y: [] };
  const first = Math.max(lastAtOrBefore(line.x, start), 0);
  if (current === line.x.length - 1) {
    // The piece has ended for this channel: the path stops where its last note stops.
    return { x: line.x.slice(first), y: line.y.slice(first) };
  }
  return {
    x: [...line.x.slice(first, current + 1), t],
    y: [...line.y.slice(first, current + 1), line.y[current]],
  };
}

/**
 * The pitch a step line plays at time `t`, or null when it is silent.
 *
 * @param {StepLine} line
 * @param {number} t
 * @returns {number | null}
 * @example
 * soundingPitch({x: [0, 1, 2, 3], y: [60, NaN, 62, 62]}, 0.5) // 60
 */
export function soundingPitch(line, t) {
  const current = lastAtOrBefore(line.x, t);
  if (current < 0 || current >= line.x.length - 1) return null;
  const pitch = line.y[current];
  return Number.isNaN(pitch) ? null : pitch;
}

/**
 * Index of the last x at or before t (numpy `searchsorted(x, t, side="right") - 1`).
 *
 * @param {number[]} x sorted ascending
 * @param {number} t
 */
function lastAtOrBefore(x, t) {
  let low = 0;
  let high = x.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (x[middle] <= t) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
