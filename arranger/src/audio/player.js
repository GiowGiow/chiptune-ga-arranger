// @ts-check
/**
 * Player: plays the rendered arrangement and the original together, so A/B keeps the position.
 *
 * Both versions are rendered beforehand into sample buffers on the same beat timeline
 * (`chip-synth.js`, `plain-synth.js`), so beat b sounds at the same second in both. Playing
 * starts one Web Audio source per version at the same instant, each through its own gain:
 * the version you hear has gain 1, the other gain 0. Switching only moves the two gains over
 * 10 ms, so the music never restarts or jumps (spec 002, FR-022). A seek restarts both sources
 * at the new offset. This is the only module that touches Web Audio (constitution, "Web App
 * Constraints": audio stays at the edges).
 */

/** Gain ramp of an A/B switch, in seconds: long enough to avoid a click, short enough to feel instant. */
const SWITCH_SECONDS = 0.01;

/** @typedef {"arrangement" | "original"} Version */

/**
 * Create a player. The AudioContext is created by `ensureContext`, which must run inside a
 * click or key handler: browsers keep audio silent until the visitor interacts with the page.
 *
 * @returns {{
 *   ensureContext: () => AudioContext,
 *   load: (buffers: Partial<Record<Version, Float32Array>>, sampleRate: number) => void,
 *   play: () => void, pause: () => void, toggle: () => void,
 *   seek: (seconds: number) => void, switchTo: (version: Version) => void,
 *   currentTime: () => number, duration: () => number, isPlaying: () => boolean,
 *   active: () => Version, has: (version: Version) => boolean,
 *   onChange: (listener: () => void) => void,
 * }}
 */
export function createPlayer() {
  /** @type {AudioContext | null} */
  let context = null;
  /** @type {Partial<Record<Version, AudioBuffer>>} */
  let buffers = {};
  /** @type {Array<{source: AudioBufferSourceNode, gain: GainNode, version: Version}>} */
  let voices = [];
  /** @type {Version} */
  let active = "arrangement";
  let offset = 0;
  let startedAt = 0;
  let playing = false;
  /** @type {Array<() => void>} */
  const listeners = [];
  const notify = () => listeners.forEach((listener) => listener());

  function ensureContext() {
    if (!context) context = new AudioContext();
    if (context.state === "suspended") context.resume();
    return context;
  }

  function duration() {
    return Math.max(0, ...Object.values(buffers).map((buffer) => buffer?.duration ?? 0));
  }

  function currentTime() {
    if (!playing || !context) return offset;
    return Math.min(duration(), offset + context.currentTime - startedAt);
  }

  function stopVoices() {
    for (const { source } of voices) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that never started cannot stop; nothing to undo.
      }
    }
    voices = [];
  }

  function startVoices() {
    const audio = ensureContext();
    stopVoices();
    startedAt = audio.currentTime + 0.02;
    for (const [version, buffer] of Object.entries(buffers)) {
      if (!buffer) continue;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      const gain = audio.createGain();
      gain.gain.value = version === active ? 1 : 0;
      source.connect(gain).connect(audio.destination);
      if (offset < buffer.duration) source.start(startedAt, offset);
      voices.push({ source, gain, version: /** @type {Version} */ (version) });
    }
    const longest = voices.reduce(
      (best, voice) =>
        (voice.source.buffer?.duration ?? 0) > (best?.source.buffer?.duration ?? 0) ? voice : best,
      voices[0],
    );
    if (longest) {
      longest.source.onended = () => {
        if (!playing) return;
        playing = false;
        offset = 0;
        stopVoices();
        notify();
      };
    }
  }

  return {
    ensureContext,
    load(newBuffers, sampleRate) {
      const audio = ensureContext();
      const wasPlaying = playing;
      if (playing) this.pause();
      buffers = {};
      for (const [version, samples] of Object.entries(newBuffers)) {
        if (!samples || samples.length === 0) continue;
        const buffer = audio.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        buffers[/** @type {Version} */ (version)] = buffer;
      }
      if (!buffers[active]) active = "arrangement";
      offset = Math.min(offset, duration());
      if (wasPlaying) this.play();
      notify();
    },
    play() {
      if (playing || duration() === 0) return;
      if (offset >= duration()) offset = 0;
      startVoices();
      playing = true;
      notify();
    },
    pause() {
      if (!playing) return;
      offset = currentTime();
      playing = false;
      stopVoices();
      notify();
    },
    toggle() {
      if (playing) this.pause();
      else this.play();
    },
    seek(seconds) {
      offset = Math.max(0, Math.min(duration(), seconds));
      if (playing) startVoices();
      notify();
    },
    switchTo(version) {
      if (!buffers[version]) return;
      active = version;
      if (context) {
        const now = context.currentTime;
        for (const voice of voices) {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
          voice.gain.gain.linearRampToValueAtTime(voice.version === version ? 1 : 0, now + SWITCH_SECONDS);
        }
      }
      notify();
    },
    currentTime,
    duration,
    isPlaying: () => playing,
    active: () => active,
    has: (version) => Boolean(buffers[version]),
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
