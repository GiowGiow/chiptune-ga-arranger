// @ts-check
// Read a lead sheet written in ABC notation.
//
// ABC is a plain-text music notation: a header of `field:value` lines (T: title, M: meter, Q:
// tempo, K: key) followed by the tune body, where letters are notes, `|` are bar lines and quoted
// strings such as "Am" are chord symbols. A `P:` line in the body marks where a part (verse,
// chorus) starts. The arranger works bar by bar, in the order the bars are played, so the reader
// turns a tune into that list of bars: the meter of each bar, its melody notes, the chord in
// effect at every moment, and the part each bar belongs to.
//
// The meter (time signature) says how long a bar is and where its strong beats fall. The header's
// `M:` field gives the first bar's meter; an inline field such as `[M:3/4]`, or an `M:` line in
// the body, changes it from the bar where it is written, so a tune may move from 4/4 to 2/4 and
// back. The reader takes the nine meters of core/meter.js (2/2, 2/4, 3/4, 4/4, 6/8, 9/8, 12/8,
// 5/4, 7/8) and checks that every bar lasts as long as its own meter says.
//
// This module ports src/leadsheet/abc_reader.py. The Python reader leaves the parsing to music21;
// here the abcjs parser (vendored in arranger/vendor/abcjs/) reads the notation, and this module
// reduces what abcjs gives to bars (research R3):
//
// 1. Parse `%%freegchord true` + the text, so chord names stay ASCII ("F#", not "F♯").
// 2. Call abcjs's `setUpAudio` only for its side effect: it writes on every note the MIDI pitch
//    (`midiPitches`), with the key signature, in-bar accidentals and inline key changes applied.
// 3. Walk the first voice of the first staff. A bar can continue on the next line of the text.
// 4. Count time in integer ticks, 480 per quarter note. abcjs gives durations as fractions of a
//    whole note, and leaves tuplets unscaled: the scale (2/3 for a triplet) is carried from the
//    tuplet's first note to its last, so a triplet adds no float noise.
// 5. Merge ties inside a bar. A tie continuation has no MIDI pitch of its own and takes the pitch
//    of the note before it; a note tied across a bar line gives one note in each bar, as in the
//    Python reader.
// 6. Take the top note of a chord of notes `[CEG]` as the melody. Grace notes take no time, and
//    neither do spacers `y`; an invisible rest `x` is a rest.
// 7. Play out repeats and endings, with the rules abcjs uses when it plays the tune.
// 8. Read a decimal Q: tempo from the text, because abcjs truncates it to an integer.
// 9. Give each bar the meter in effect when its bar line closes it: abcjs reports the header
//    meter on the first line, an `M:` line in the body on the line that follows it, and an inline
//    `[M:x]` as an element of the voice (spec 003, research R7).
// 10. Pad a short first bar (a pickup) with a leading rest, up to its own meter's length.
//
// The Python reader refuses repeat signs and pickups; on the tunes it accepts, both readers give
// the same lead sheet (tests/abc-reader.test.js checks the committed lead sheets and the meter
// test tunes).
//
// Known limits:
// - Only the first bar may be short (a pickup), so a tune whose last bar completes the pickup is
//   refused.
// - A key change inside a repeated section keeps the pitches of its last pass (abcjs behavior).
// - Chord symbols on spacer rests are read from the parse, not from abcjs's audio sequence.
// - Repeats follow abcjs, quirks included (an ending that closes with `:|` plays the common bars
//   once more), with two exceptions: a last bar without a closing bar line is kept (abcjs drops
//   it after a repeat), and an ending not closed before the next ending does not borrow the next
//   ending's first note.
// - The key is named as music21 names it ("e- minor", "D dorian"); abcjs reports K:Aaeo and
//   K:Cion as minor and major, and the locrian mode and bagpipe keys give no key, as in music21.

import { chordTones } from "./chords.js";
import { chordSegments, phraseMarks, sectionRole } from "./leadsheet.js";
import { parseMeter } from "./meter.js";

/** @typedef {import("./meter.js").Meter} Meter */

/** Ticks per quarter-note beat: the time grid of the reader, as in a MIDI file. */
const TICKS_PER_BEAT = 480;

/** Tempo when the tune has no Q: field, in quarter notes per minute (as in the Python reader). */
const DEFAULT_TEMPO_BPM = 140;

const TICKS_PER_WHOLE_NOTE = 4 * TICKS_PER_BEAT;
const TEMPO_DECIMALS = 6;

/** Without this directive, abcjs rewrites chord names with Unicode accidentals (F♯, B♭). */
const FREE_CHORD_NAMES = "%%freegchord true\n";

/** abcjs's key modes, named as music21 names them (`Key.mode`). Locrian has no music21 key. */
const MODE_NAMES = {
  "": "major",
  m: "minor",
  Dor: "dorian",
  Phr: "phrygian",
  Lyd: "lydian",
  Mix: "mixolydian",
};

/**
 * One tune of an ABC file, for the visitor to pick.
 * @typedef {object} TuneEntry
 * @property {number} index position of the tune in the file (the `tuneIndex` to read it).
 * @property {string} title its T: field, or "" when it has none.
 */

/**
 * Options of `readLeadSheetAbc`, as in the Python `read_lead_sheet_text`.
 * @typedef {object} ReadOptions
 * @property {number} [tuneIndex] which tune of the file to read (0 for the first).
 * @property {number} [phraseLength] number of bars per phrase, counted from the start of each
 *   part (and of each repeated pass).
 * @property {Record<string, import("./leadsheet.js").Role> | null} [roleMap] part label → role;
 *   labels it does not list get the role `sectionRole` guesses.
 * @property {number | null} [tempoOverride] tempo in quarter notes per minute that replaces the
 *   tune's own Q: field.
 */

/**
 * A melody note while the tune is read: times in ticks from the bar start.
 * @typedef {object} TickNote
 * @property {number} pitch MIDI pitch.
 * @property {number} onset
 * @property {number} duration
 * @property {boolean} tied true when a tie from the note before leads into this note.
 */

/**
 * A bar as written in the tune, before repeats are played out.
 * @typedef {object} WrittenBar
 * @property {number} number position in the text, counted from 1 as musicians do (for messages).
 * @property {Meter} meter the meter in effect when the bar line closes the bar.
 * @property {number} ticks length of the bar.
 * @property {TickNote[]} notes
 * @property {Array<[number, string]>} chordChanges `[onset in ticks, symbol]` of each chord
 *   symbol written in the bar.
 * @property {string} label part label in effect when the bar starts.
 * @property {number} section counts the part labels met so far: each P: starts a new section.
 */

/**
 * A repeat sign or an ending, at a bar boundary: `position` bars of the text come before it.
 * @typedef {{type: "repeatStart" | "repeatEnd", position: number}
 *   | {type: "endingStart", position: number, numbers: number[]}} RepeatMarker
 */

/**
 * List the tunes of an ABC text (one per X: field), so the visitor can pick one.
 *
 * @param {any} ABCJS the abcjs library object (`globalThis.ABCJS` in the page).
 * @param {string} text the ABC file.
 * @returns {TuneEntry[]} one entry per tune that holds music, in file order.
 * @example
 * listTunes(ABCJS, 'X:1\nT:One\nK:C\n"C"C8|\n\nX:2\nT:Two\nK:G\n"G"G8|\n');
 * // [{index: 0, title: "One"}, {index: 1, title: "Two"}]
 */
export function listTunes(ABCJS, text) {
  /** @type {any[]} */
  const tunes = ABCJS.parseOnly(abcjsInput(text));
  return tunes.flatMap((tune, index) =>
    firstVoice(tune).length > 0 ? [{ index, title: titleOf(tune) }] : [],
  );
}

/**
 * Read one tune of an ABC text into a lead sheet.
 *
 * @param {any} ABCJS the abcjs library object (`globalThis.ABCJS` in the page).
 * @param {string} text the ABC file.
 * @param {ReadOptions} [options]
 * @returns {import("./leadsheet.js").LeadSheet} the lead sheet, with one bar per bar played, each
 *   in its own meter.
 * @throws {Error} for a missing or unsupported meter, a bar whose length differs from its meter
 *   (other than a pickup), a tune without chord symbols or with an unknown one. The message names
 *   the bar when it can.
 * @example
 * const sheet = readLeadSheetAbc(ABCJS, 'X:1\nT:Scale\nM:4/4\nL:1/4\nK:C\n"C"CDEF|"G7"GABc|');
 * [sheet.bars.map((bar) => bar.chords[0].symbol), sheet.bars[1].melody[0].pitch];
 * // [["C", "G7"], 67]
 * readLeadSheetAbc(ABCJS, 'X:1\nM:3/4\nL:1/4\nK:C\n"C"CDE|[M:2/4]FG|').bars.map((bar) => String(bar.meter));
 * // ["3/4", "2/4"]
 */
export function readLeadSheetAbc(ABCJS, text, options = {}) {
  const { tuneIndex = 0, phraseLength = 4, roleMap = null, tempoOverride = null } = options;
  if (!(phraseLength >= 1)) {
    throw new Error(`phrase_length must be at least 1, got ${phraseLength}`);
  }
  const parsedText = abcjsInput(text);
  /** @type {any[]} */
  const tunes = ABCJS.parseOnly(parsedText);
  const tune = tunes[tuneIndex];
  if (tune === undefined) {
    throw new Error(`the text has ${tunes.length} tune(s), so there is no tune number ${tuneIndex + 1}`);
  }
  const lines = tune.lines.filter((/** @type {any} */ line) => line.staff !== undefined);
  if (lines.length === 0) {
    throw new Error("the tune has no notes");
  }
  tune.setUpAudio({ chordsOff: true });

  const headerMeter = lines[0].staff[0].meter;
  if (headerMeter === undefined) {
    throw new Error("the tune has no M: (meter) field; write one, for example M:4/4");
  }
  const { bars, markers } = readWrittenBars(lines, parseMeter(abcjsMeterText(headerMeter), 1));
  if (bars.length === 0) {
    throw new Error("the tune has no notes");
  }
  checkBarLengths(bars);

  const played = playedBars(bars, playOrder(markers, bars.length));
  const chordsPerBar = chordSegments(
    played.map((bar) => bar.chordChanges.map(([onset, symbol]) => [onset / TICKS_PER_BEAT, symbol])),
    chordTones,
    played.map((bar) => bar.meter.barBeats),
  );
  const marks = phraseMarks(
    played.map((bar) => bar.sectionKey),
    phraseLength,
  );
  return {
    title: titleOf(tune),
    key: keyName(lines[0].staff[0].key),
    tempoBpm: tempoOverride != null ? Number(tempoOverride) : tempoBpm(tune, parsedText),
    bars: played.map((bar, index) => ({
      index,
      melody: melody(bar.notes),
      chords: chordsPerBar[index],
      label: bar.label,
      role: sectionRole(bar.label, roleMap),
      phrase: marks[index][0],
      phraseEnd: marks[index][1],
      meter: bar.meter,
    })),
    sourceGrid: null,
  };
}

/**
 * The text given to abcjs: the chord-name directive, then the file with Unix line endings (abcjs
 * counts the character positions of a Windows file as if it had none, which would misplace the
 * Q: field read back from the text).
 * @param {string} text the ABC file.
 * @returns {string}
 */
function abcjsInput(text) {
  return FREE_CHORD_NAMES + text.replace(/\r\n?/g, "\n");
}

/**
 * @param {any} tune an abcjs tune.
 * @returns {string} its first T: field, or "".
 */
function titleOf(tune) {
  return tune.metaText?.title ?? "";
}

/**
 * @param {any} tune an abcjs tune.
 * @returns {any[]} the elements of its first voice, over all lines.
 */
function firstVoice(tune) {
  return tune.lines.flatMap((/** @type {any} */ line) => line.staff?.[0]?.voices?.[0] ?? []);
}

/**
 * @param {Meter} meter
 * @returns {number} the length of one bar of `meter` in ticks.
 */
function barTicks(meter) {
  return Math.round(meter.barBeats * TICKS_PER_BEAT);
}

/**
 * @param {any} meter an abcjs meter.
 * @returns {string} the meter as ABC writes it ("3/4", "C", "C|"), for `parseMeter`.
 */
function abcjsMeterText(meter) {
  if (meter.type === "common_time") return "C";
  if (meter.type === "cut_time") return "C|";
  if (meter.type === "specified") {
    return meter.value.map((/** @type {any} */ part) => `${part.num}/${part.den}`).join(" ");
  }
  return String(meter.type);
}

/**
 * Walk the first voice and cut it into written bars, collecting the repeat signs on the way.
 *
 * @param {any[]} lines abcjs lines that hold a staff.
 * @param {Meter} headerMeter the meter of the M: field, in effect until the tune changes it.
 * @returns {{bars: WrittenBar[], markers: RepeatMarker[]}}
 */
function readWrittenBars(lines, headerMeter) {
  /** @type {WrittenBar[]} */
  const bars = [];
  /** @type {RepeatMarker[]} */
  const markers = [];
  /** @type {WrittenBar | null} */
  let bar = null;
  let meter = headerMeter;
  let label = "";
  let section = 0;
  /** @type {number | null} */
  let previousPitch = null;
  /** @type {Array<[number, string]>} chord symbols written on a bar line start the next bar. */
  let carriedChords = [];
  /** @type {{actual: number, normal: number, written: number, scaled: number} | null} */
  let tuplet = null;

  const openBar = () => {
    if (bar === null) {
      bar = { number: bars.length + 1, meter, ticks: 0, notes: [], chordChanges: carriedChords, label, section };
      carriedChords = [];
    }
    return bar;
  };
  const closeBar = () => {
    if (bar !== null && bar.ticks > 0) {
      // As in the Python reader's text scan, a bar is in the meter in effect at its bar line.
      bar.meter = meter;
      bars.push(bar);
    } else if (bar !== null) {
      // A bar without time (two bar lines in a row) keeps its chords for the next bar.
      carriedChords = bar.chordChanges;
    }
    bar = null;
  };
  /**
   * @param {any[] | undefined} chords abcjs `chord` list of an element.
   * @param {number} onset ticks from the bar start.
   * @param {Array<[number, string]>} into
   */
  const addChordSymbols = (chords, onset, into) => {
    for (const chord of chords ?? []) {
      // Other positions (^ above, _ below, < > @) are text annotations, not chord symbols.
      if (chord.position !== "default") continue;
      // abcjs joins the chord symbols written on one note with newlines ("C\nG"); the last wins.
      for (const name of String(chord.name).split("\n")) {
        const symbol = name.trim();
        try {
          chordTones(symbol);
        } catch (error) {
          throw new Error(`bar ${bars.length + 1}: ${/** @type {Error} */ (error).message}`);
        }
        into.push([onset, symbol]);
      }
    }
  };

  lines.forEach((line, lineIndex) => {
    // abcjs puts an M: line of the body on the staff of the line that follows it.
    const lineMeter = line.staff[0].meter;
    if (lineIndex > 0 && lineMeter !== undefined) meter = parseMeter(abcjsMeterText(lineMeter), bars.length + 1);
    for (const element of line.staff[0].voices?.[0] ?? []) {
      if (element.el_type === "part") {
        label = String(element.title ?? "").trim();
        section += 1;
      } else if (element.el_type === "meter") {
        meter = parseMeter(abcjsMeterText(element), bars.length + 1);
      } else if (element.el_type === "bar") {
        closeBar();
        addBarLineMarkers(markers, element, bars.length);
        addChordSymbols(element.chord, 0, carriedChords);
      } else if (element.el_type === "note") {
        const current = openBar();
        addChordSymbols(element.chord, current.ticks, current.chordChanges);
        const restType = element.rest?.type;
        if (restType === "spacer") continue;
        if (restType === "multimeasure") {
          // Z or Zn: n whole bars of silence.
          const count = Number(element.rest.text) || 1;
          for (let index = 0; index < count; index += 1) {
            if (index > 0) closeBar();
            openBar().ticks += barTicks(meter);
          }
          continue;
        }

        const written = Math.round(element.duration * TICKS_PER_WHOLE_NOTE);
        if (element.startTriplet) {
          // (p:q: plays p notes in the time of q; abcjs gives the ratio q/p as a float.
          const actual = element.startTriplet;
          tuplet = { actual, normal: Math.round(actual * element.tripletMultiplier), written: 0, scaled: 0 };
        }
        let duration = written;
        if (tuplet !== null) {
          // Scale the running total, not each note, so the tuplet lasts exactly q/p of its notes.
          tuplet.written += written;
          const scaledTotal = Math.round((tuplet.written * tuplet.normal) / tuplet.actual);
          duration = scaledTotal - tuplet.scaled;
          tuplet.scaled = scaledTotal;
          if (element.endTriplet) tuplet = null;
        }

        if (restType === undefined) {
          /** @type {any[]} */
          const midiPitches = element.midiPitches ?? [];
          const pitch =
            midiPitches.length > 0 ? Math.max(...midiPitches.map((midi) => midi.pitch)) : previousPitch;
          if (pitch !== null) {
            const tied = (element.pitches ?? []).some((/** @type {any} */ p) => p.endTie);
            current.notes.push({ pitch, onset: current.ticks, duration, tied });
            previousPitch = pitch;
          }
        }
        current.ticks += duration;
      }
    }
  });
  closeBar();
  return { bars, markers };
}

/**
 * Record the repeat signs and ending of one bar line, as abcjs's player does (RepeatsSequence).
 * @param {RepeatMarker[]} markers
 * @param {any} barLine abcjs bar element.
 * @param {number} position number of bars written before the bar line.
 */
function addBarLineMarkers(markers, barLine, position) {
  const type = barLine.type;
  if (type === "bar_right_repeat" || type === "bar_dbl_repeat") {
    const last = markers[markers.length - 1];
    // Two end repeats in a row: the second goes back to the first, so A :| B :| plays A A B B.
    if (last !== undefined && last.type === "repeatEnd") {
      markers.push({ type: "repeatStart", position: last.position });
    }
    markers.push({ type: "repeatEnd", position });
  }
  if (barLine.startEnding) {
    markers.push({ type: "endingStart", position, numbers: endingNumbers(String(barLine.startEnding)) });
  }
  if (type === "bar_left_repeat" || type === "bar_dbl_repeat") {
    markers.push({ type: "repeatStart", position });
  }
}

/**
 * @param {string} ending the text after `[` or `|`, for example "1", "1,3" or "1-3".
 * @returns {number[]} the passes that play this ending.
 */
function endingNumbers(ending) {
  if (ending.includes(",")) {
    return ending.split(",").map((part) => Number.parseInt(part, 10)).filter((number) => number > 0);
  }
  if (ending.includes("-")) {
    const [first, last] = ending.split("-").map((part) => Number.parseInt(part, 10));
    const numbers = [];
    for (let number = first; number <= last; number += 1) numbers.push(number);
    return numbers;
  }
  const number = Number.parseInt(ending, 10);
  return number > 0 ? [number] : [];
}

/**
 * Pad a short first bar (a pickup) with a leading rest, and refuse any other bar whose length
 * differs from its meter's.
 * @param {WrittenBar[]} bars
 */
function checkBarLengths(bars) {
  const pickup = bars[0];
  const pickupTicks = barTicks(pickup.meter);
  if (pickup.ticks < pickupTicks) {
    // The rest goes before the notes: a pickup leads into the downbeat of the next bar.
    const rest = pickupTicks - pickup.ticks;
    pickup.notes = pickup.notes.map((note) => ({ ...note, onset: note.onset + rest }));
    // A chord on the pickup's first note is in effect from the start of the padded bar.
    pickup.chordChanges = pickup.chordChanges.map(([onset, symbol]) => [onset > 0 ? onset + rest : 0, symbol]);
    pickup.ticks = pickupTicks;
  }
  for (const bar of bars) {
    if (bar.ticks !== barTicks(bar.meter)) {
      throw new Error(
        `bar ${bar.number} lasts ${bar.ticks / TICKS_PER_BEAT} beats instead of ` +
          `${bar.meter.barBeats} (${bar.meter}); only the first bar (a pickup) may be shorter`,
      );
    }
  }
}

/**
 * The order in which the written bars are played, with repeats and endings played out.
 *
 * This follows abcjs's player (RepeatsSequence.resolveRepeats), so the reader plays a tune in
 * the order abcjs plays it. A start repeat `|:` (or the start of the tune) opens a group. In the
 * group, the common bars run up to the first ending or end repeat. A group with an end repeat and
 * no endings plays its common bars twice; a group with endings plays, for each ending number in
 * order, the common bars and then that ending. Bars between groups play once.
 *
 * @param {RepeatMarker[]} markers in text order.
 * @param {number} barCount number of written bars.
 * @returns {number[]} written bar indices, in the order played.
 */
function playOrder(markers, barCount) {
  /** @type {RepeatMarker[]} */
  const sections = [{ type: "repeatStart", position: 0 }, ...markers];
  const last = sections[sections.length - 1];
  if (last.type !== "repeatStart" && last.position < barCount) {
    sections.push({ type: "repeatStart", position: last.position });
  }

  /** @typedef {{start: number, end?: number}} Span bars [start, end) */
  /** @type {Array<{common: Span, endings: Span[] | null}>} */
  const groups = [];
  /** @type {{common: Span, endings: Span[] | null} | null} */
  let group = null;
  for (const [index, marker] of sections.entries()) {
    if (marker.type === "repeatStart") {
      if (group !== null) {
        group.common.end ??= marker.position;
        for (const ending of group.endings ?? []) {
          if (ending && ending.end === undefined && ending.start !== marker.position) {
            ending.end = marker.position;
          }
        }
        // abcjs plays the common bars once more when the last ending closed with an end repeat.
        if (sections[index - 1].type === "repeatEnd" && group.endings && group.endings.length > 0) {
          group.endings.push({ start: -1, end: -1 });
        }
        groups.push(group);
        // Bars after the group and before this repeat start play once.
        // An ending left open (no end yet) makes `reached` NaN, so no bars play here (as in abcjs).
        const endings = (group.endings ?? []).filter(Boolean);
        const reached = Math.max(group.common.end, ...endings.map((ending) => ending.end ?? Number.NaN));
        if (reached < marker.position) {
          groups.push({ common: { start: reached, end: marker.position }, endings: null });
        }
      }
      group = { common: { start: marker.position }, endings: null };
    } else if (group !== null && marker.type === "endingStart") {
      group.common.end ??= marker.position;
      group.endings ??= [];
      for (const number of marker.numbers) group.endings[number] = { start: marker.position };
    } else if (group !== null && marker.type === "repeatEnd") {
      group.endings ??= [];
      for (const ending of group.endings) {
        if (ending && ending.end === undefined) ending.end = marker.position;
      }
      group.common.end ??= marker.position;
    }
  }
  if (group !== null) {
    group.common.end ??= barCount;
    for (const ending of group.endings ?? []) {
      if (ending && ending.end === undefined) ending.end = barCount;
    }
    groups.push(group);
  }

  /** @type {number[]} */
  const order = [];
  /** @param {Span} span */
  const play = (span) => {
    for (let bar = Math.max(span.start, 0); bar < (span.end ?? 0); bar += 1) order.push(bar);
  };
  for (const { common, endings } of groups) {
    if (endings === null) {
      play(common);
    } else if (endings.length === 0) {
      play(common);
      play(common);
    } else {
      for (const ending of endings) {
        if (!ending) continue;
        play(common);
        if (ending.start >= 0) play(ending);
      }
    }
  }
  return order;
}

/**
 * A bar in the order played, with the section it counts in for phrases.
 * @typedef {object} PlayedBar
 * @property {Meter} meter
 * @property {number} ticks
 * @property {TickNote[]} notes
 * @property {Array<[number, string]>} chordChanges
 * @property {string} label
 * @property {number} sectionKey consecutive bars with the same key form one section.
 */

/**
 * Take the written bars in the order played. A new part, or a jump back to an earlier bar (a
 * repeat), starts a new section, so phrases are counted again from there.
 * @param {WrittenBar[]} bars
 * @param {number[]} order
 * @returns {PlayedBar[]}
 */
function playedBars(bars, order) {
  let sectionKey = 0;
  return order.map((barIndex, position) => {
    const bar = bars[barIndex];
    if (position > 0) {
      const previous = order[position - 1];
      if (bar.section !== bars[previous].section || barIndex <= previous) sectionKey += 1;
    }
    const { meter, ticks, notes, chordChanges, label } = bar;
    return { meter, ticks, notes, chordChanges, label, sectionKey };
  });
}

/**
 * Turn the notes of one played bar into melody notes in beats, merging the ties inside it.
 * @param {TickNote[]} notes
 * @returns {import("./leadsheet.js").MelodyNote[]}
 */
function melody(notes) {
  /** @type {Array<{pitch: number, onset: number, duration: number}>} */
  const merged = [];
  for (const note of notes) {
    const previous = merged[merged.length - 1];
    const continuesPrevious =
      previous !== undefined && previous.pitch === note.pitch && previous.onset + previous.duration === note.onset;
    if (note.tied && continuesPrevious) {
      previous.duration += note.duration;
    } else {
      merged.push({ pitch: note.pitch, onset: note.onset, duration: note.duration });
    }
  }
  return merged.map((note) => ({
    pitch: note.pitch,
    onset: note.onset / TICKS_PER_BEAT,
    duration: note.duration / TICKS_PER_BEAT,
  }));
}

/**
 * Name the key as music21 does: "C major", "a minor", "e- minor"; "" for K:none.
 * @param {any} key abcjs key of the first staff line.
 * @returns {string}
 */
function keyName(key) {
  if (key === undefined || !/^[A-G]$/.test(key.root)) return "";
  const mode = MODE_NAMES[/** @type {keyof MODE_NAMES} */ (key.mode)];
  if (mode === undefined) return "";
  const tonic = key.root + (key.acc === "b" ? "-" : key.acc === "#" ? "#" : "");
  return `${mode === "minor" ? tonic.toLowerCase() : tonic} ${mode}`;
}

/**
 * The tempo in quarter notes per minute: the Q: field, or 140 without one.
 * @param {any} tune an abcjs tune.
 * @param {string} parsedText the text abcjs parsed, to read the Q: field's decimals.
 * @returns {number}
 */
function tempoBpm(tune, parsedText) {
  const tempo = tune.metaText?.tempo;
  if (!tempo?.bpm) return DEFAULT_TEMPO_BPM;
  // abcjs truncates the beats per minute to an integer; the Q: text keeps the decimals.
  const written = /=\s*(\d+(?:\.\d*)?)/.exec(parsedText.slice(tempo.startChar, tempo.endChar));
  const beatsPerMinute = written === null ? tempo.bpm : Number(written[1]);
  /** @type {number[]} */
  const beatNote = tempo.duration ?? [0.25];
  const quartersPerBeat = beatNote.reduce((sum, wholeNotes) => sum + wholeNotes, 0) * 4;
  return Number((beatsPerMinute * quartersPerBeat).toFixed(TEMPO_DECIMALS));
}
