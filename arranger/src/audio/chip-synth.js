// @ts-check
// Play an arrangement with NES chip sounds: a port of `src/export/chip_audio.py` (research R7).
//
// The NES sound chip (the 2A03 audio processing unit) makes music with a few very simple tone
// generators. Each channel of the arrangement belongs to one of them (Donahue et al., 2018, p. 3):
//
// - P1 and P2 are pulse waves: a square wave whose high part lasts only a fraction of each
//   cycle, the duty cycle (12.5%, 25% or 50%; 75% sounds like 25%). A narrower pulse sounds
//   thinner and more nasal, so P1 (25%) and P2 (12.5%) stay apart. Pulse loudness is a 4-bit
//   volume: 15 levels plus silence.
// - TR is a triangle wave drawn as a 32-step staircase with only 16 levels, which gives the
//   bass its slightly buzzy edge. It has no volume control: it is on or off.
// - NO is a noise generator. A 15-bit linear feedback shift register (LFSR) shifts one bit per
//   clock tick and feeds back the XOR of two of its bits, which gives a long pseudo-random
//   stream of bits. The clock rate (set by a "period") makes the noise darker or brighter, and
//   a "short mode" makes the stream repeat after 93 ticks, which sounds metallic. The drum
//   notes (kick, snare, hi-hat) each choose one noise setting and a short decay.
//
// Each note is synthesized on its own, the channels are mixed with the chip's fixed gains, and
// the mix is scaled to peak at -3 dBFS. Unlike the command line, which reads the MIDI file it
// wrote, this module reads the arrangement directly and turns beats into seconds with the
// tempo. It returns a Float32Array, the sample format of a Web Audio AudioBuffer; matching the
// loudness of the input render is the job of `audio/loudness.js`, not of this module. The code
// is pure (no Web Audio, no DOM) and deterministic: the noise register always starts at 1.
//
// Reference: C. Donahue, H. H. Mao and J. McAuley, "The NES Music Database: a
// multi-instrumental dataset with expressive performance attributes", ISMIR 2018 (channel
// roles, 4 duty cycles, 15 volume levels for pulse and noise, no volume for the triangle).

/** @typedef {"P1" | "P2" | "TR" | "NO"} ChannelName */

/**
 * One note of a channel. For NO, `pitch` is a General MIDI drum note (36 kick, 38 snare,
 * 42 hi-hat).
 * @typedef {object} ChipNote
 * @property {number} pitch MIDI note number
 * @property {number} onset start, in beats from the start of the piece
 * @property {number} duration length in beats, greater than 0
 * @property {number} velocity MIDI velocity, 1 to 127
 */

/**
 * The part of an Arrangement that the synthesizer reads; other fields are ignored.
 * @typedef {object} ChipArrangement
 * @property {number} tempoBpm quarter notes per minute
 * @property {Partial<Record<ChannelName, ChipNote[]>>} channels a missing channel is silent
 */

/**
 * How the noise channel plays one drum note.
 * @typedef {object} DrumSound
 * @property {number} period noise period in CPU cycles (one of NOISE_PERIODS; longer is darker)
 * @property {boolean} shortMode true for the metallic 93-step noise
 * @property {number} decaySeconds length of the hit; its envelope falls by 40 dB over this time
 */

/**
 * The sample rate of the command line's renders, in samples per second.
 * @example
 * SAMPLE_RATE; // 44100
 */
export const SAMPLE_RATE = 44100;

/**
 * NTSC NES CPU clock in Hz; the noise register ticks once every `period` CPU cycles.
 * @example
 * CPU_CLOCK_HZ / NOISE_PERIODS[0]; // ≈ 447443 ticks per second, the brightest noise
 */
export const CPU_CLOCK_HZ = 1789773;

/**
 * The 16 noise periods of the chip, in CPU cycles.
 * @type {readonly number[]}
 * @example
 * NOISE_PERIODS.length; // 16
 * NOISE_PERIODS[13]; // 1016, the kick's period
 */
export const NOISE_PERIODS = Object.freeze([
  4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068,
]);

/**
 * The duty cycle of each pulse channel: the share of a cycle that the wave stays high.
 * @type {Readonly<{P1: number, P2: number}>}
 * @example
 * PULSE_DUTY; // { P1: 0.25, P2: 0.125 }
 */
export const PULSE_DUTY = Object.freeze({ P1: 0.25, P2: 0.125 });

/**
 * Channel gains from the linear approximation of the chip's mixer (NESdev wiki, "APU Mixer"):
 * 0.00752 per pulse volume step, 0.00851 per triangle step and 0.00494 per noise step.
 * @type {Readonly<Record<ChannelName, number>>}
 * @example
 * CHANNEL_GAINS.TR; // ≈ 1.1316
 * CHANNEL_GAINS.NO; // ≈ 0.6569
 */
export const CHANNEL_GAINS = Object.freeze({ P1: 1.0, P2: 1.0, TR: 0.00851 / 0.00752, NO: 0.00494 / 0.00752 });

/**
 * The peak of the mix, -3 dBFS (10 ** (-3 / 20)), the same headroom as the General MIDI render.
 * @example
 * 20 * Math.log10(PEAK_LEVEL); // -3
 */
export const PEAK_LEVEL = 0.7079457843841379;

/**
 * Length of the ramp at each note edge, in seconds; it removes the click of a sudden jump.
 * @example
 * Math.round(FADE_SECONDS * 44100); // 88 samples
 */
export const FADE_SECONDS = 0.002;

/**
 * The 32-step triangle sequence of the chip: 15, 14, ..., 0, 0, 1, ..., 15.
 * @type {readonly number[]}
 * @example
 * TRIANGLE_STEPS.slice(14, 18); // [1, 0, 0, 1], the bottom of the staircase
 */
export const TRIANGLE_STEPS = Object.freeze([
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);

// The triangle's 32 steps as samples in [-1, 1], computed once instead of at every sample.
const TRIANGLE_LEVELS = Float64Array.from(TRIANGLE_STEPS, (step) => step / 7.5 - 1);

// General MIDI drum notes of the arranger (src/arrangement/model.py).
const KICK = 36;
const SNARE = 38;
const HIHAT = 42;

/**
 * The noise setting and decay of each drum note.
 * @type {Readonly<Record<number, Readonly<DrumSound>>>}
 * @example
 * DRUM_SOUNDS[42]; // { period: 8, shortMode: true, decaySeconds: 0.04 }, the hi-hat
 */
export const DRUM_SOUNDS = Object.freeze({
  [KICK]: Object.freeze({ period: NOISE_PERIODS[13], shortMode: false, decaySeconds: 0.12 }),
  [SNARE]: Object.freeze({ period: NOISE_PERIODS[8], shortMode: false, decaySeconds: 0.15 }),
  [HIHAT]: Object.freeze({ period: NOISE_PERIODS[1], shortMode: true, decaySeconds: 0.04 }),
});

/** @type {readonly ChannelName[]} */
const CHANNELS = Object.freeze(["P1", "P2", "TR", "NO"]);

// The buffer runs this long past the last note end, so that a final drum hit can ring out.
const LONGEST_HIT_SECONDS = Math.max(...Object.values(DRUM_SOUNDS).map((drum) => drum.decaySeconds));

/**
 * Round to the nearest integer, halves to the even neighbor, as Python's `round()` does.
 * Math.round sends 5512.5 to 5513; Python, and so the command line, to 5512.
 * @param {number} value
 * @returns {number}
 */
function roundHalfEven(value) {
  const nearest = Math.round(value);
  return nearest - value === 0.5 && nearest % 2 !== 0 ? nearest - 1 : nearest;
}

/**
 * Position inside the current cycle, in [0, 1), after `cycles` cycles (cycles >= 0).
 *
 * It equals `cycles % 1` exactly (the subtraction of the floor loses no bit), but V8 runs the
 * floating-point `%` as a slow library call, and this runs once per sample.
 * @param {number} cycles
 * @returns {number}
 */
function cyclePhase(cycles) {
  return cycles - Math.floor(cycles);
}

/**
 * Map a MIDI velocity (1-127) to the chip's 4-bit volume (1-15; 0 would be silence).
 * @param {number} velocity MIDI velocity, 1 to 127
 * @returns {number} the volume, an integer from 1 to 15
 * @example
 * [127, 100, 60, 1].map(velocityToVolume); // [15, 12, 7, 1]
 */
export function velocityToVolume(velocity) {
  return Math.max(1, roundHalfEven((velocity * 15) / 127));
}

/**
 * A pulse wave: +1 for the first `duty` share of each cycle, -1 for the rest.
 * @param {number} frequency in Hz
 * @param {number} nSamples number of samples
 * @param {number} duty share of each cycle that is high, from 0 to 1
 * @param {number} [sampleRate] samples per second (default 44,100)
 * @param {Float64Array} [wave] where to write the samples (a new array by default)
 * @returns {Float64Array} the wave, starting at the beginning of a cycle
 * @example
 * pulseWave(44100 / 8, 8, 0.25, 44100); // [1, 1, -1, -1, -1, -1, -1, -1]
 */
export function pulseWave(frequency, nSamples, duty, sampleRate = SAMPLE_RATE, wave = new Float64Array(nSamples)) {
  const cyclesPerSample = frequency / sampleRate;
  for (let i = 0; i < nSamples; i++) {
    wave[i] = cyclePhase(i * cyclesPerSample) < duty ? 1 : -1;
  }
  return wave;
}

/**
 * The chip's triangle: the 32-step, 16-level sequence 15..0, 0..15 scaled to [-1, 1].
 * @param {number} frequency in Hz
 * @param {number} nSamples number of samples
 * @param {number} [sampleRate] samples per second (default 44,100)
 * @param {Float64Array} [wave] where to write the samples (a new array by default)
 * @returns {Float64Array} the wave, starting at the top of a cycle
 * @example
 * const triangle = triangleWave(44100 / 32, 32, 44100);
 * [0, 8, 15, 16, 31].map((i) => triangle[i]); // [1, -0.0667, -1, -1, 1]
 */
export function triangleWave(frequency, nSamples, sampleRate = SAMPLE_RATE, wave = new Float64Array(nSamples)) {
  const cyclesPerSample = frequency / sampleRate;
  for (let i = 0; i < nSamples; i++) {
    wave[i] = TRIANGLE_LEVELS[Math.floor(cyclePhase(i * cyclesPerSample) * TRIANGLE_LEVELS.length)];
  }
  return wave;
}

/**
 * Output bit (bit 0) of the noise register at every tick of one full cycle, from state 1.
 *
 * Each tick shifts the 15-bit register right and puts the XOR of bit 0 and a tap bit (bit 1,
 * or bit 6 in short mode) into bit 14. The update is invertible, so the register always comes
 * back to its start state, and one cycle is enough to make noise of any length.
 * @param {boolean} shortMode true for the 93-step metallic mode
 * @returns {Uint8Array} the bits, 32,767 in long mode and 93 in short mode
 * @example
 * [lfsrCycle(false).length, lfsrCycle(true).length]; // [32767, 93]
 * lfsrCycle(false).reduce((sum, bit) => sum + bit, 0); // 16384 ones; short mode has 16
 */
export function lfsrCycle(shortMode) {
  const tap = shortMode ? 6 : 1;
  const outputBits = [];
  let register = 1;
  do {
    outputBits.push(register & 1);
    const feedback = (register & 1) ^ ((register >> tap) & 1);
    register = (register >> 1) | (feedback << 14);
  } while (register !== 1);
  return Uint8Array.from(outputBits);
}

// Both cycles are fixed, so they are built once, like Python's functools.cache. Never mutated.
const LFSR_CYCLES = Object.freeze({ long: lfsrCycle(false), short: lfsrCycle(true) });

/**
 * Noise from the chip's 15-bit LFSR ticking at CPU_CLOCK_HZ / period, as +1/-1 samples.
 *
 * Each sample holds the register output at that moment: +1 when bit 0 is 0, since the chip
 * mutes the channel when bit 0 is 1. The register always starts at 1, so the noise is the same
 * on every call.
 * @param {number} nSamples number of samples
 * @param {number} period noise period in CPU cycles (one of NOISE_PERIODS)
 * @param {boolean} shortMode true for the 93-step metallic mode
 * @param {number} [sampleRate] samples per second (default 44,100)
 * @param {Float64Array} [wave] where to write the samples (a new array by default)
 * @returns {Float64Array} the noise, made of +1 and -1
 * @example
 * const noise = noiseWave(1000, 16, false, 44100);
 * new Set(noise); // {1, -1}, and noiseWave(1000, 16, false, 44100) gives the same samples
 */
export function noiseWave(nSamples, period, shortMode, sampleRate = SAMPLE_RATE, wave = new Float64Array(nSamples)) {
  const outputBits = shortMode ? LFSR_CYCLES.short : LFSR_CYCLES.long;
  const ticksPerSample = CPU_CLOCK_HZ / period / sampleRate;
  for (let i = 0; i < nSamples; i++) {
    wave[i] = 1 - 2 * outputBits[Math.floor(i * ticksPerSample) % outputBits.length];
  }
  return wave;
}

/**
 * Ramp the first and last `fadeSamples` of a note from and to silence, in place.
 * @param {Float64Array} tone
 * @param {number} fadeSamples
 * @returns {void}
 */
function fadeEdges(tone, fadeSamples) {
  const fade = Math.min(fadeSamples, Math.floor(tone.length / 2));
  if (fade <= 0) return;
  const rampStep = 1 / fade; // numpy's linspace(0, 1, fade, endpoint=False) is k * (1 / fade)
  for (let k = 0; k < fade; k++) {
    tone[k] *= k * rampStep;
    tone[tone.length - 1 - k] *= k * rampStep;
  }
}

/**
 * How long a note sounds, in seconds: its own length, or for a drum hit its decay, cut by the
 * next hit.
 * @param {ChannelName} channel
 * @param {{pitch: number, start: number, end: number}} note times in seconds
 * @param {number} nextOnset start of the channel's next note in seconds (Infinity if none)
 * @returns {number}
 */
function soundingSeconds(channel, note, nextOnset) {
  if (channel !== "NO") return note.end - note.start;
  const drum = DRUM_SOUNDS[note.pitch];
  if (drum === undefined) return 0; // a drum note without a chip sound stays silent
  // There is one noise channel, so a new hit cuts the previous one, as on the chip.
  return Math.min(drum.decaySeconds, nextOnset - note.start);
}

/**
 * Write the waveform of one note of `channel`, with its envelope, volume and edge fades, into
 * `tone` (the note lasts `tone.length` samples).
 * @param {ChannelName} channel
 * @param {number} pitch
 * @param {number} velocity
 * @param {Float64Array} tone
 * @param {number} sampleRate
 * @returns {Float64Array} `tone`
 */
function noteTone(channel, pitch, velocity, tone, sampleRate) {
  const nSamples = tone.length;
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  let decayPerSample = 1; // only drum hits decay
  if (channel === "NO") {
    const drum = DRUM_SOUNDS[pitch];
    noiseWave(nSamples, drum.period, drum.shortMode, sampleRate, tone);
    // Exponential decay that is 40 dB down (1%) after the drum's decay time: the envelope at
    // sample i is 0.01 ** (i / decaySamples), built as a running product of this factor (one
    // multiplication per sample instead of a power; the two agree to about 1e-12).
    decayPerSample = 0.01 ** (1 / (drum.decaySeconds * sampleRate));
  } else if (channel === "TR") {
    triangleWave(frequency, nSamples, sampleRate, tone);
  } else {
    pulseWave(frequency, nSamples, PULSE_DUTY[channel], sampleRate, tone);
  }
  // The triangle has no volume control, so it ignores the velocity.
  const volume = channel === "TR" ? 1 : velocityToVolume(velocity) / 15;
  // The console's output filter blocks constant offsets; a 12.5% pulse (and the short noise)
  // would otherwise sit far from zero, waste headroom and thump at every note.
  let sum = 0;
  for (let i = 0; i < nSamples; i++) sum += tone[i];
  const mean = sum / nSamples;
  let envelope = 1;
  for (let i = 0; i < nSamples; i++) {
    tone[i] = (tone[i] - mean) * envelope * volume;
    envelope *= decayPerSample;
  }
  fadeEdges(tone, roundHalfEven(FADE_SECONDS * sampleRate));
  return tone;
}

/**
 * Add `gain × tone` into `mix` from `firstSample` on, dropping what runs past the end.
 *
 * A function of its own, called once per note, so that the engine compiles this loop early
 * and keeps it fast for every channel.
 * @param {Float64Array} mix
 * @param {Float64Array} tone
 * @param {number} firstSample
 * @param {number} gain
 * @returns {void}
 */
function addTone(mix, tone, firstSample, gain) {
  const length = Math.min(tone.length, mix.length - firstSample);
  for (let i = 0; i < length; i++) mix[firstSample + i] += gain * tone[i];
}

/**
 * Synthesize the P1, P2, TR and NO channels of an arrangement with chip waveforms (mono).
 *
 * Pulse and noise loudness follow the note velocity on the 4-bit volume scale; the triangle is
 * always at full level. The buffer runs from beat 0 to the last note end plus 0.15 s (the
 * longest drum hit), as in the command line. The mix peaks at -3 dBFS, and a piece without
 * notes gives 0.15 s of zeros.
 * @param {ChipArrangement} arrangement the tempo and the four channels' notes, in beats
 * @param {number} [sampleRate] samples per second (default 44,100; use the AudioContext's)
 * @returns {Float32Array} the samples, in [-1, 1]
 * @example
 * const samples = renderChip({ tempoBpm: 120, channels: { P1: [{ pitch: 69, onset: 0, duration: 1, velocity: 100 }] } });
 * samples.length; // 28665: (0.5 s + 0.15 s) × 44,100
 * Math.max(...samples.map(Math.abs)); // ≈ 0.7079, -3 dBFS
 */
export function renderChip(arrangement, sampleRate = SAMPLE_RATE) {
  // First, when each note starts and how many samples it sounds; then the waveforms.
  const secondsPerBeat = 60 / arrangement.tempoBpm;
  let endSeconds = 0;
  /** @type {{channel: ChannelName, pitch: number, velocity: number, firstSample: number, nSamples: number}[]} */
  const sounding = [];
  for (const channel of CHANNELS) {
    const notes = (arrangement.channels[channel] ?? []).map((note) => ({
      pitch: note.pitch,
      velocity: note.velocity,
      start: note.onset * secondsPerBeat,
      end: (note.onset + note.duration) * secondsPerBeat,
    }));
    // At equal onsets the lowest note comes last and survives the cut, so a kick wins over a
    // snare and a snare over a hi-hat, the same priority the arranger uses.
    notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
    notes.forEach((note, index) => {
      endSeconds = Math.max(endSeconds, note.end);
      const nextOnset = index + 1 < notes.length ? notes[index + 1].start : Infinity;
      const firstSample = roundHalfEven(note.start * sampleRate);
      const end = note.start + soundingSeconds(channel, note, nextOnset);
      const nSamples = roundHalfEven(end * sampleRate) - firstSample;
      if (nSamples > 0) sounding.push({ channel, pitch: note.pitch, velocity: note.velocity, firstSample, nSamples });
    });
  }

  const mix = new Float64Array(Math.ceil((endSeconds + LONGEST_HIT_SECONDS) * sampleRate));
  // Every note is written in turn into one buffer as long as the longest note, instead of a
  // new array per note: a minute of music would otherwise allocate tens of megabytes.
  const scratch = new Float64Array(sounding.reduce((longest, note) => Math.max(longest, note.nSamples), 0));
  for (const { channel, pitch, velocity, firstSample, nSamples } of sounding) {
    const tone = noteTone(channel, pitch, velocity, scratch.subarray(0, nSamples), sampleRate);
    addTone(mix, tone, firstSample, CHANNEL_GAINS[channel]);
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const samples = new Float32Array(mix.length);
  if (peak > 0) {
    const scale = PEAK_LEVEL / peak;
    for (let i = 0; i < mix.length; i++) samples[i] = mix[i] * scale;
  }
  return samples;
}
