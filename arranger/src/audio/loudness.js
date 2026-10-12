// @ts-check
// Make the chip arrangement and the plain input equally loud, so that A/B compares the music and
// not the volume (research R7).
//
// A louder version tends to sound "better", so a fair comparison plays both at the same level.
// The command line does this with ffmpeg's EBU R128 loudness filter, at -16 LUFS for every MP3
// (`normalize_loudness` in `src/export/audio.py`). The browser uses a simpler measure of the
// same kind, without R128's K-weighting filter (it models the ear's sensitivity to high
// frequencies) and without its relative gate:
//
// - the gated RMS: the signal is cut into 400 ms blocks, blocks quieter than -70 dBFS (near
//   silence) are left out, and the root mean square of the rest is the level. Silences and the
//   tail after the last note therefore do not lower the measured level;
// - `matchLoudness` gains each render to the same target level, -16 dBFS RMS, close to the level
//   of the command line's MP3s. If that would push a peak above -1 dBFS, both renders go down by
//   the same amount, so they stay equally loud and nothing clips.
//
// The functions are pure: they return new arrays and never change their inputs.

/** Length of a measuring block, in seconds (EBU R128's momentary window). */
export const BLOCK_SECONDS = 0.4;

/** Blocks quieter than this, in dBFS, are left out of the level (R128's absolute gate). */
export const GATE_DB = -70;

/** The level both renders are brought to, in dBFS RMS. */
export const TARGET_DB = -16;

/** @param {number} db */
const dbToAmplitude = (db) => 10 ** (db / 20);

/**
 * The level of a render: the RMS of its 400 ms blocks louder than -70 dBFS.
 *
 * The last block may be shorter; each block counts in proportion to its length. A render with
 * no block above the gate (silence) has level 0.
 * @param {Float32Array} samples
 * @param {number} sampleRate samples per second
 * @returns {number} the gated RMS, as a linear amplitude (1 is a full-scale square wave)
 * @example
 * gatedRms(Float32Array.of(0.5, -0.5, 0.5, -0.5), 4); // 0.5
 * gatedRms(new Float32Array(10), 4); // 0, silence
 */
export function gatedRms(samples, sampleRate) {
  const blockLength = Math.max(1, Math.round(BLOCK_SECONDS * sampleRate));
  const gatePower = dbToAmplitude(GATE_DB) ** 2;
  let keptEnergy = 0;
  let keptSamples = 0;
  for (let start = 0; start < samples.length; start += blockLength) {
    const end = Math.min(start + blockLength, samples.length);
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    if (energy / (end - start) > gatePower) {
      keptEnergy += energy;
      keptSamples += end - start;
    }
  }
  return keptSamples > 0 ? Math.sqrt(keptEnergy / keptSamples) : 0;
}

/**
 * Bring two renders to the same gated RMS, with neither peak above the ceiling.
 *
 * Each render gets the gain that takes its level to `targetDb`. When a peak would then pass
 * `peakCeilingDb`, both gains shrink by the same factor, so the levels stay equal and the
 * louder peak sits at the ceiling. A silent render stays silent.
 * @param {Float32Array} a one render, for example the plain input
 * @param {Float32Array} b the other, for example the chip arrangement
 * @param {number} sampleRate samples per second of both
 * @param {{targetDb?: number, peakCeilingDb?: number}} [options] the level to reach (default
 *   -16 dBFS RMS) and the highest peak allowed (default -1 dBFS)
 * @returns {{a: Float32Array, b: Float32Array}} new arrays, the inputs scaled
 * @example
 * const { a, b } = matchLoudness(new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.05), 100);
 * [a[0], b[0]]; // both ≈ 0.1585, that is -16 dBFS
 */
export function matchLoudness(a, b, sampleRate, options = {}) {
  const { targetDb = TARGET_DB, peakCeilingDb = -1 } = options;
  const target = dbToAmplitude(targetDb);
  const gainOf = (/** @type {Float32Array} */ samples) => {
    const level = gatedRms(samples, sampleRate);
    return level > 0 ? target / level : 0;
  };
  let gainA = gainOf(a);
  let gainB = gainOf(b);
  const loudestPeak = Math.max(peakOf(a) * gainA, peakOf(b) * gainB);
  const ceiling = dbToAmplitude(peakCeilingDb);
  if (loudestPeak > ceiling) {
    gainA *= ceiling / loudestPeak;
    gainB *= ceiling / loudestPeak;
  }
  return { a: scaled(a, gainA), b: scaled(b, gainB) };
}

/**
 * @param {Float32Array} samples
 * @param {number} gain
 * @returns {Float32Array} a new array, `samples` times `gain`
 */
function scaled(samples, gain) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/**
 * @param {Float32Array} samples
 * @returns {number} the largest absolute sample
 */
function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}
