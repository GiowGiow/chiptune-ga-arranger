// @ts-check
// Standard MIDI files: read one into instruments and notes in seconds, and write one from tracks.
//
// A MIDI file is a header chunk ("MThd": format, track count, ticks per quarter note) followed by
// track chunks ("MTrk"). A track is a list of events, each after a delta time in ticks written
// as a variable-length number. Channel events (note on/off, program change, ...) may omit a
// repeated status byte ("running status"); meta events carry the track name, the tempo
// (microseconds per quarter note) and the time signature.
//
// The reader copies the semantics of the Python reference, pretty_midi 0.2.11 on top of mido 1.3
// (`pretty_midi.PrettyMIDI`: `_load_tempo_changes`, `_update_tick_to_time`, `_load_instruments`,
// `time_to_tick`), because the CLI config names the melody by pretty_midi's instrument index and
// the lead-sheet reduction (core/midi-song.js, src/leadsheet/midi_reader.py) must see the same
// notes at the same times (research R4):
//
// - one instrument per (program, channel, track), in the order their first note ends; a note
//   belongs to the program in effect on its channel when it ends. Events before a channel's
//   first note go to a provisional "straggler" in pretty_midi, which never reaches the list;
// - a note-off (or a note-on at velocity 0) closes every open note of that channel and pitch,
//   except notes that start on the same tick, which stay open; a lone zero-length note is dropped;
// - drums are channel 10 (index 9); an instrument's name is its track's name when it is created;
// - the tempo map comes from track 0 only; seconds of tick t are summed segment by segment as in
//   `_update_tick_to_time`, so the times are the same floating-point numbers;
// - like mido, a meta event of an unknown type loses its delta time.
//
// The writer (`writeMidiFile`) emits format 1: track 0 holds the tempo and the time signature and
// every other track one instrument (src/export/midi.py writes the same layout with pretty_midi).

/** pretty_midi refuses files whose last tick reaches this value: they are likely corrupt. */
const MAX_TICK = 1e7;

/** Meta event types that mido knows; any other type loses its delta time (mido quirk). */
const KNOWN_META_TYPES = new Set([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x09, 0x20, 0x21, 0x2f, 0x51, 0x54, 0x58, 0x59, 0x7f,
]);

/**
 * A note of a MIDI file, in seconds.
 * @typedef {object} MidiNote
 * @property {number} start onset, in seconds.
 * @property {number} end release, in seconds.
 * @property {number} pitch MIDI pitch number (0–127).
 * @property {number} velocity loudness (1–127).
 */

/**
 * One instrument as pretty_midi lists it: the notes of one (program, channel, track).
 * @typedef {object} MidiInstrument
 * @property {string} name name of the track that holds it ("" when the track has none).
 * @property {number} program General MIDI program (0–127).
 * @property {boolean} isDrum true on MIDI channel 10 (index 9).
 * @property {number} channel MIDI channel index (0–15).
 * @property {MidiNote[]} notes in the order their note-offs come in the file.
 */

/**
 * A tempo change: from `tick` (at `time` seconds) on, `bpm` quarter notes per minute.
 * @typedef {object} TempoChange
 * @property {number} tick
 * @property {number} time
 * @property {number} bpm
 */

/**
 * A time signature of track 0, for example 4/4, from `time` seconds on.
 * @typedef {object} TimeSignature
 * @property {number} numerator
 * @property {number} denominator
 * @property {number} time
 */

/**
 * A MIDI file read into pretty_midi's model.
 * @typedef {object} MidiSong
 * @property {number} resolution ticks per quarter note.
 * @property {TempoChange[]} tempoChanges at least one; 120 BPM when the file sets none.
 * @property {TimeSignature[]} timeSignatures those of track 0, in file order.
 * @property {MidiInstrument[]} instruments in pretty_midi's order.
 * @property {(seconds: number) => number} timeToTick nearest tick of a time, as pretty_midi.
 * @property {(tick: number) => number} tickToTime seconds of a tick.
 */

/**
 * A note of a track to write, in seconds.
 * @typedef {object} TrackNote
 * @property {number} start
 * @property {number} end
 * @property {number} pitch
 * @property {number} velocity
 */

/**
 * A track to write: one instrument on one channel.
 * @typedef {object} MidiTrackSpec
 * @property {string} name track name (Latin-1 text).
 * @property {number} channel MIDI channel index (0–15; 9 is drums).
 * @property {number} program General MIDI program (0–127).
 * @property {TrackNote[]} notes in seconds.
 */

/**
 * One parsed event, with its absolute tick in the track.
 * @typedef {{tick: number, kind: "note_on" | "note_off" | "program_change" | "track_name"
 *   | "set_tempo" | "time_signature" | "other", channel?: number, data?: number[],
 *   name?: string, tempo?: number, numerator?: number, denominator?: number}} TrackEvent
 */

/**
 * Read a standard MIDI file into instruments and notes in seconds, as pretty_midi does.
 *
 * @param {Uint8Array} bytes the whole file.
 * @returns {MidiSong}
 * @throws {Error} when the bytes are not a MIDI file or the file is damaged.
 * @example
 * const bytes = writeMidiFile({ resolution: 480, tempoBpm: 120, timeSignature: [4, 4],
 *   tracks: [{ name: "P1", channel: 0, program: 80,
 *     notes: [{ start: 0.5, end: 1, pitch: 72, velocity: 100 }] }] });
 * const song = readMidiFile(bytes);
 * [song.resolution, song.instruments[0].name, song.instruments[0].notes[0].start];
 * // [480, "P1", 0.5]
 */
export function readMidiFile(bytes) {
  const { resolution, tracks } = parseChunks(bytes);
  if (tracks.length === 0) throw new Error("the MIDI file has no track");

  const lastTick = Math.max(...tracks.map((track) => (track.length ? track[track.length - 1].tick : 0)));
  const maxTick = lastTick + 1;
  if (maxTick > MAX_TICK) throw new Error(`the MIDI file has a largest tick of ${maxTick}; it is likely corrupt`);

  const tickScales = loadTickScales(tracks[0], resolution);
  const clock = tickClock(tickScales, maxTick);
  const tempoChanges = tickScales.map(([tick, scale]) => ({
    tick,
    time: clock.tickToTime(tick),
    bpm: 60.0 / (scale * resolution),
  }));
  const timeSignatures = tracks[0]
    .filter((event) => event.kind === "time_signature")
    .map((event) => ({
      numerator: /** @type {number} */ (event.numerator),
      denominator: /** @type {number} */ (event.denominator),
      time: clock.tickToTime(event.tick),
    }));
  return {
    resolution,
    tempoChanges,
    timeSignatures,
    instruments: loadInstruments(tracks, clock.tickToTime),
    timeToTick: clock.timeToTick,
    tickToTime: clock.tickToTime,
  };
}

/**
 * Split the file into its header and parsed tracks (mido's `MidiFile._load`).
 *
 * @param {Uint8Array} bytes
 * @returns {{resolution: number, tracks: TrackEvent[][]}}
 */
function parseChunks(bytes) {
  const reader = byteReader(bytes);
  if (bytes.length < 8 || reader.text(4) !== "MThd") {
    throw new Error("not a MIDI file: it does not start with MThd");
  }
  const headerSize = reader.u32();
  const headerEnd = reader.position() + headerSize;
  if (headerSize < 6 || headerEnd > bytes.length) throw new Error("the MIDI header is too short");
  reader.u16(); // format: pretty_midi reads formats 0 and 1 alike
  const trackCount = reader.u16();
  const division = reader.u16();
  if (division & 0x8000) throw new Error("SMPTE time division is not supported; use ticks per quarter note");
  if (division === 0) throw new Error("the MIDI header gives 0 ticks per quarter note");
  reader.seek(headerEnd);

  /** @type {TrackEvent[][]} */
  const tracks = [];
  while (tracks.length < trackCount) {
    if (reader.position() + 8 > bytes.length) {
      throw new Error(`the MIDI file ends before track ${tracks.length} (header says ${trackCount})`);
    }
    const name = reader.text(4);
    const size = reader.u32();
    const end = reader.position() + size;
    if (name === "MTrk") {
      tracks.push(parseTrack(reader, end, tracks.length));
    }
    // Chunks of other types are not tracks, and a track that overruns its length resumes at the
    // next chunk: mido refuses both, so this reads a superset of the files the CLI reads.
    reader.seek(end);
  }
  return { resolution: division, tracks };
}

/**
 * Read one track's events (mido's `read_track`), with absolute ticks.
 *
 * @param {ReturnType<typeof byteReader>} reader positioned at the first event.
 * @param {number} end position just after the track chunk.
 * @param {number} trackIndex for error messages.
 * @returns {TrackEvent[]}
 */
function parseTrack(reader, end, trackIndex) {
  /** @type {TrackEvent[]} */
  const events = [];
  let tick = 0;
  /** @type {number | null} */
  let runningStatus = null;
  while (reader.position() < end) {
    let delta = reader.varInt();
    let status = reader.u8();
    /** @type {number[]} */
    const peeked = [];
    if (status < 0x80) {
      if (runningStatus === null) throw new Error(`track ${trackIndex}: running status without a status byte`);
      peeked.push(status);
      status = runningStatus;
    } else if (status !== 0xff) {
      // Meta events do not change the running status.
      runningStatus = status;
    }

    /** @type {Omit<TrackEvent, "tick">} */
    let event;
    if (status === 0xff) {
      const type = reader.u8();
      const data = reader.bytes(reader.varInt());
      if (!KNOWN_META_TYPES.has(type)) delta = 0; // mido builds unknown meta events without their time
      event = metaEvent(type, data);
    } else if (status === 0xf0 || status === 0xf7) {
      reader.bytes(reader.varInt()); // system exclusive: skipped
      event = { kind: "other" };
    } else {
      const length = channelMessageLength(status, trackIndex);
      const data = [...peeked, ...reader.bytes(Math.max(0, length - 1 - peeked.length))];
      if (data.some((byte) => byte > 127)) throw new Error(`track ${trackIndex}: data byte above 127`);
      event = channelEvent(status, data);
    }
    tick += delta;
    events.push({ tick, ...event });
  }
  return events;
}

/**
 * The length in bytes (status included) of a channel or system message, as mido's table.
 *
 * @param {number} status
 * @param {number} trackIndex
 * @returns {number}
 */
function channelMessageLength(status, trackIndex) {
  const kind = status & 0xf0;
  if (kind === 0xc0 || kind === 0xd0) return 2;
  if (kind < 0xf0) return 3;
  /** @type {Record<number, number>} */
  const system = { 0xf1: 2, 0xf2: 3, 0xf3: 2, 0xf6: 1, 0xf8: 1, 0xfa: 1, 0xfb: 1, 0xfc: 1, 0xfe: 1 };
  if (!(status in system)) {
    throw new Error(`track ${trackIndex}: undefined status byte 0x${status.toString(16)}`);
  }
  return system[status];
}

/**
 * @param {number} status
 * @param {number[]} data
 * @returns {Omit<TrackEvent, "tick">}
 */
function channelEvent(status, data) {
  const channel = status & 0x0f;
  switch (status & 0xf0) {
    case 0x80:
      return { kind: "note_off", channel, data };
    case 0x90:
      return { kind: "note_on", channel, data };
    case 0xc0:
      return { kind: "program_change", channel, data };
    default:
      return { kind: "other" };
  }
}

/**
 * @param {number} type meta event type byte.
 * @param {number[]} data
 * @returns {Omit<TrackEvent, "tick">}
 */
function metaEvent(type, data) {
  if (type === 0x03) return { kind: "track_name", name: latin1(data) };
  if (type === 0x51 && data.length >= 3) return { kind: "set_tempo", tempo: (data[0] << 16) | (data[1] << 8) | data[2] };
  if (type === 0x58 && data.length >= 2) {
    return { kind: "time_signature", numerator: data[0], denominator: 2 ** data[1] };
  }
  return { kind: "other" };
}

/**
 * Text bytes decoded as Latin-1, mido's default charset.
 * @param {number[]} data
 * @returns {string}
 */
function latin1(data) {
  return data.map((byte) => String.fromCharCode(byte)).join("");
}

/**
 * The tempo map as pretty_midi's `_tick_scales`: `[tick, seconds per tick]` pairs from track 0.
 *
 * @param {TrackEvent[]} firstTrack
 * @param {number} resolution
 * @returns {Array<[number, number]>}
 */
function loadTickScales(firstTrack, resolution) {
  /** @type {Array<[number, number]>} */
  let scales = [[0, 60.0 / (120.0 * resolution)]];
  for (const event of firstTrack) {
    if (event.kind !== "set_tempo") continue;
    const bpm = 6e7 / /** @type {number} */ (event.tempo);
    if (event.tick === 0) {
      scales = [[0, 60.0 / (bpm * resolution)]];
    } else {
      const scale = 60.0 / (bpm * resolution);
      // Files often repeat the same tempo; pretty_midi keeps only real changes.
      if (scale !== scales[scales.length - 1][1]) scales.push([event.tick, scale]);
    }
  }
  return scales;
}

/**
 * Conversions between ticks and seconds over pretty_midi's tick table.
 *
 * pretty_midi fills an array `tick → seconds` up to the last tick + 1, segment by segment:
 * inside a tempo segment the time is `segment start time + seconds per tick × ticks since the
 * segment start`. This computes the same numbers on demand instead of storing the array.
 *
 * @param {Array<[number, number]>} tickScales
 * @param {number} maxTick last event tick + 1.
 * @returns {{tickToTime: (tick: number) => number, timeToTick: (seconds: number) => number}}
 */
function tickClock(tickScales, maxTick) {
  const starts = tickScales.map(([tick]) => tick);
  const scales = tickScales.map(([, scale]) => scale);
  /** Seconds at the start of each segment, summed as `_update_tick_to_time` does. */
  const startTimes = [0];
  for (let index = 1; index < tickScales.length; index += 1) {
    startTimes.push(startTimes[index - 1] + scales[index - 1] * (starts[index] - starts[index - 1]));
  }
  const tableLength = Math.max(maxTick, ...starts) + 1;

  /** @param {number} tick */
  function tickToTime(tick) {
    // The last segment that starts at or before the tick.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= tick) low = middle;
      else high = middle - 1;
    }
    return startTimes[low] + scales[low] * (tick - starts[low]);
  }

  /** @param {number} seconds */
  function timeToTick(seconds) {
    // numpy.searchsorted(table, seconds, side="left"): the first tick whose time is ≥ seconds.
    let low = 0;
    let high = tableLength;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tickToTime(middle) < seconds) low = middle + 1;
      else high = middle;
    }
    if (low === tableLength) {
      // Past the table: extend it with the last tempo, then round half to even like Python.
      const last = tableLength - 1;
      return roundHalfEven(last + (seconds - tickToTime(last)) / scales[scales.length - 1]);
    }
    if (low > 0 && Math.abs(seconds - tickToTime(low - 1)) < Math.abs(seconds - tickToTime(low))) {
      return low - 1;
    }
    return low;
  }

  return { tickToTime, timeToTick };
}

/**
 * Python's `round(x)`: to the nearest integer, ties to the even one.
 * @param {number} value
 * @returns {number}
 */
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor + 0;
  return floor % 2 === 0 ? floor + 0 : floor + 1;
}

/**
 * Group the notes into instruments as pretty_midi's `_load_instruments` does.
 *
 * @param {TrackEvent[][]} tracks
 * @param {(tick: number) => number} tickToTime
 * @returns {MidiInstrument[]}
 */
function loadInstruments(tracks, tickToTime) {
  /** @type {Map<string, MidiInstrument>} keyed by "program,channel,track", in creation order */
  const instruments = new Map();
  tracks.forEach((events, trackIndex) => {
    let trackName = "";
    const programs = new Array(16).fill(0);
    /** @type {Map<number, Array<[number, number]>>} open notes [start tick, velocity] by channel × 128 + pitch */
    const openNotes = new Map();
    for (const event of events) {
      if (event.kind === "track_name") {
        trackName = /** @type {string} */ (event.name);
        continue;
      }
      const channel = /** @type {number} */ (event.channel);
      const data = /** @type {number[]} */ (event.data);
      if (event.kind === "program_change") {
        programs[channel] = data[0];
      } else if (event.kind === "note_on" && data[1] > 0) {
        const key = channel * 128 + data[0];
        const open = openNotes.get(key) ?? [];
        open.push([event.tick, data[1]]);
        openNotes.set(key, open);
      } else if (event.kind === "note_off" || event.kind === "note_on") {
        const key = channel * 128 + data[0];
        const open = openNotes.get(key);
        if (open === undefined) continue; // a note-off with no open note is ignored
        const toClose = open.filter(([startTick]) => startTick !== event.tick);
        const toKeep = open.filter(([startTick]) => startTick === event.tick);
        for (const [startTick, velocity] of toClose) {
          const program = programs[channel];
          const instrumentKey = `${program},${channel},${trackIndex}`;
          let instrument = instruments.get(instrumentKey);
          if (instrument === undefined) {
            instrument = { name: trackName, program, isDrum: channel === 9, channel, notes: [] };
            instruments.set(instrumentKey, instrument);
          }
          instrument.notes.push({
            start: tickToTime(startTick),
            end: tickToTime(event.tick),
            pitch: data[0],
            velocity,
          });
        }
        // A note restruck on the tick of this note-off keeps sounding; a lone zero-length note
        // (nothing else to close) is dropped, as in pretty_midi.
        if (toClose.length > 0 && toKeep.length > 0) openNotes.set(key, toKeep);
        else openNotes.delete(key);
      }
    }
  });
  return [...instruments.values()];
}

/**
 * Write a format-1 standard MIDI file: track 0 with the tempo and time signature, then one
 * track per entry of `tracks` (name, program change, notes).
 *
 * Seconds become ticks at `tempoBpm`, rounded to the nearest tick. At one tick, note-offs come
 * before note-ons, so a repeated note is released before it is struck again.
 *
 * @param {{resolution?: number, tempoBpm: number, timeSignature?: [number, number],
 *   tracks: MidiTrackSpec[]}} song `resolution` defaults to 480 ticks per quarter note and
 *   `timeSignature` to [4, 4]; the denominator must be a power of two.
 * @returns {Uint8Array} the file's bytes.
 * @example
 * const bytes = writeMidiFile({ tempoBpm: 120, tracks: [{ name: "P1", channel: 0, program: 80,
 *   notes: [{ start: 0.5, end: 1, pitch: 72, velocity: 100 }] }] });
 * readMidiFile(bytes).instruments[0].notes[0].start; // 0.5
 */
export function writeMidiFile({ resolution = 480, tempoBpm, timeSignature = [4, 4], tracks }) {
  const [numerator, denominator] = timeSignature;
  const denominatorPower = Math.log2(denominator);
  if (!Number.isInteger(denominatorPower)) throw new Error(`time signature denominator ${denominator} is not a power of 2`);
  const microsecondsPerQuarter = Math.round(6e7 / tempoBpm);
  const tempoTrack = [
    ...varIntBytes(0), 0xff, 0x51, 3,
    (microsecondsPerQuarter >> 16) & 0xff, (microsecondsPerQuarter >> 8) & 0xff, microsecondsPerQuarter & 0xff,
    ...varIntBytes(0), 0xff, 0x58, 4, numerator, denominatorPower, 24, 8,
    ...varIntBytes(0), 0xff, 0x2f, 0,
  ];
  const ticksPerSecond = (tempoBpm / 60) * resolution;
  const chunks = [tempoTrack, ...tracks.map((track) => trackBytes(track, ticksPerSecond))];

  const header = [...asciiBytes("MThd"), ...u32Bytes(6), 0, 1, ...u16Bytes(chunks.length), ...u16Bytes(resolution)];
  const body = chunks.flatMap((chunk) => [...asciiBytes("MTrk"), ...u32Bytes(chunk.length), ...chunk]);
  return Uint8Array.from([...header, ...body]);
}

/**
 * The event bytes of one instrument track.
 *
 * @param {MidiTrackSpec} track
 * @param {number} ticksPerSecond
 * @returns {number[]}
 */
function trackBytes(track, ticksPerSecond) {
  const { channel, program } = track;
  const name = [...track.name].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 0x3f));
  /** @type {Array<{tick: number, order: number, index: number, bytes: number[]}>} */
  const events = [];
  track.notes.forEach((note, index) => {
    const onTick = Math.round(note.start * ticksPerSecond);
    const offTick = Math.round(note.end * ticksPerSecond);
    events.push({ tick: onTick, order: 1, index, bytes: [0x90 | channel, note.pitch, note.velocity] });
    events.push({ tick: offTick, order: 0, index, bytes: [0x80 | channel, note.pitch, 0] });
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order || a.index - b.index);

  const bytes = [...varIntBytes(0), 0xff, 0x03, ...varIntBytes(name.length), ...name];
  bytes.push(...varIntBytes(0), 0xc0 | channel, program);
  let tick = 0;
  for (const event of events) {
    bytes.push(...varIntBytes(event.tick - tick), ...event.bytes);
    tick = event.tick;
  }
  bytes.push(...varIntBytes(0), 0xff, 0x2f, 0);
  return bytes;
}

/**
 * A variable-length quantity: 7 bits per byte, the high bit set on all but the last.
 * @param {number} value non-negative integer.
 * @returns {number[]}
 */
function varIntBytes(value) {
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
    bytes.unshift((rest & 0x7f) | 0x80);
  }
  return bytes;
}

/** @param {number} value @returns {number[]} */
function u16Bytes(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

/** @param {number} value @returns {number[]} */
function u32Bytes(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** @param {string} text @returns {number[]} */
function asciiBytes(text) {
  return [...text].map((c) => c.charCodeAt(0));
}

/**
 * A cursor over the file's bytes; every read past the end throws.
 *
 * @param {Uint8Array} bytes
 */
function byteReader(bytes) {
  let position = 0;
  /** @param {number} count */
  function need(count) {
    if (position + count > bytes.length) throw new Error("the MIDI file ends in the middle of an event");
  }
  return {
    position: () => position,
    /** @param {number} to */
    seek(to) {
      position = to;
    },
    u8() {
      need(1);
      return bytes[position++];
    },
    u16() {
      need(2);
      const value = (bytes[position] << 8) | bytes[position + 1];
      position += 2;
      return value;
    },
    u32() {
      need(4);
      const value = bytes[position] * 2 ** 24 + ((bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]);
      position += 4;
      return value;
    },
    /** @param {number} count */
    bytes(count) {
      need(count);
      const slice = Array.from(bytes.subarray(position, position + count));
      position += count;
      return slice;
    },
    /** @param {number} count */
    text(count) {
      return latin1(this.bytes(count));
    },
    varInt() {
      let value = 0;
      for (;;) {
        const byte = this.u8();
        value = value * 128 + (byte & 0x7f);
        if (byte < 0x80) return value;
      }
    },
  };
}
