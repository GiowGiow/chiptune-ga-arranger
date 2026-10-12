# Feature Specification: Meters and Allowed Textures

**Feature Branch**: `002-browser-arranger` (post-submission work continues on this branch; `main` stays at the submitted state)

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Spec 003, on the post-deadline branch (not main):

(1) Meter support beyond 4/4 in both the Python CLI (the reference) and the browser arranger. The
parity rules of constitution 1.3.0 apply.
- Read ABC and MIDI songs in simple meters (2/2, 2/4, 3/4, 4/4) and compound meters (6/8, 9/8,
  12/8). At lower priority, read irregular meters (5/4, 7/8) by beat grouping. 2/4 becomes a
  native meter instead of being joined in pairs.
- Bars keep the GA genome of 4 genes per bar, and the realizers adapt to the bar's meter:
  - the octave pump runs on the beat subdivisions;
  - root-fifth alternates per beat;
  - the walking bass approaches the next bar's root on the last beat;
  - drum patterns are built from the meter's strong and weak beats (waltz in 3/4, 6/8 feel, fill
    on the last beat).
- Score tables count steps per bar from the meter instead of a fixed 16, and validation checks
  complete bars of each bar's meter.
- MIDI files with meter changes are read with the time-signature map: bar lines come from it, and
  a count-in in another meter is included.
- Chord detection uses half bars in duple and quadruple meters, and whole bars (or beats)
  otherwise.
- All committed samples are 4/4 and must keep exactly their plans, fitness and MIDI (parity
  fixtures unchanged).

(2) Allowed textures. A new setting lists, per gene (P2 texture, TR texture, NO pattern, P1
octave), the values the GA may use, for example P2 without the fast 32nd-note arpeggio or without
arpeggios at all.
- The random initial population and mutation draw only allowed values.
- The default allows everything, so existing results are unchanged.
- The app's settings panel offers it as checkboxes with explanations, and the CLI as a config key.

Motivation: the student found 32nd-note arpeggios "unnecessary" in some sections. Measured:
arp32 and arp16 score the same on every criterion (activity is capped at 1), so the GA picks
between them almost at random (25–43% of bars use arp32)."

## Context

Specs 001 (command line) and 002 (browser arranger) arrange songs in 4/4 only. 2/4 is accepted in
the browser by joining pairs of bars, and only a count-in in another meter is skipped. Many songs
are in other meters, and a visitor whose file is in another meter gets an error:
- Brazilian music has waltzes (valsa, 3/4) and toadas and sambas notated in 2/4.
- Folk tunes in ABC are often jigs (6/8) and slip jigs (9/8).

The student also wants control over the fast arpeggios. The two arpeggio textures (sixteenths,
"arp16", and thirty-seconds, "arp32") score the same on every fitness criterion, so the choice
between them is close to random. The student hears that as "unnecessary fast arpeggios".

Both changes touch the method, so they apply to the command line (the reference implementation)
and to the browser app alike. The 10 committed samples are all in 4/4 and use the default
settings, so they must not change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrange a waltz and other simple meters (Priority: P1)

The student, or a visitor of the app, gives a song in 3/4 (ABC or MIDI) and gets an NES
arrangement whose bars have 3 beats:
- the bass plays "oom-pah-pah" (root, then the chord on beats 2 and 3), or walks across the 3 beats;
- the drums play a waltz pattern: kick on beat 1, snare or hi-hat on beats 2 and 3;
- fills fall on the last beat of a phrase.

The same works for 2/2 and for 2/4 as a native meter, with bars of 2 beats.

**Why this priority**: 3/4 is the most common meter after 4/4, in MPB (valsas) and in folk tunes,
and it is the error the student hit first.

**Independent Test**:
1. Arrange a 16-bar ABC waltz written for the tests (M:3/4) with seed 1.
2. Check that every bar of every channel spans 3 beats, that the NES rules pass, and that the
   drums of an "eighth beat" bar hit beat 1 with the kick.
3. Arrange a 2/4 tune and check that its bars have 2 beats and that its phrases count 2-beat bars.

**Acceptance Scenarios**:

1. **Given** an ABC tune in M:3/4 with chord symbols, **When** it is arranged, **Then** each bar
   lasts 3 beats in every channel, and no note crosses a bar line.
2. **Given** the same tune, **When** a bar's bass gene is root-fifth, **Then** the bass plays root
   on beat 1 and the fifth on beats 2 and 3.
3. **Given** a bar with the walking gene, **Then** the bass plays three quarter notes and the last
   one leads by a semitone into the next bar's root.
4. **Given** a MIDI song with a 3/4 time signature throughout, **When** it is reduced, **Then** its
   bars have 3 beats and its chords are detected per bar.
5. **Given** an ABC tune in M:2/4, **When** it is read, **Then** its bars have 2 beats (not joined
   in pairs), and a phrase of 4 bars lasts 8 beats.

---

### User Story 2 - Arrange compound meters (Priority: P2)

A tune in 6/8, 9/8 or 12/8 is arranged with the dotted-quarter beat:
- the bass and the drums feel two (6/8), three (9/8) or four (12/8) beats per bar;
- the pump and the hi-hats move in eighths;
- arpeggios keep their sixteenth and thirty-second subdivisions.

**Why this priority**: jigs and many ballads are in 6/8. This is the next most common family after
the simple meters.

**Independent Test**: arrange a 16-bar 6/8 jig written for the tests. Check that bars span 3
quarter beats (6 eighths), that the kick falls on eighths 1 and 4, and that the walking bass plays
two dotted quarters.

**Acceptance Scenarios**:

1. **Given** a 6/8 tune, **When** it is arranged, **Then** the TR root-fifth texture plays root on
   the first dotted-quarter beat and the fifth on the second.
2. **Given** a 6/8 tune with an "eighth beat" drum bar, **Then** the kick falls on eighths 1 and 4
   and the snare on the second beat.
3. **Given** a 12/8 MIDI song, **When** it is reduced, **Then** it has bars of 6 quarter beats and
   chord decisions on half bars.

---

### User Story 3 - Keep the fast arpeggios out (Priority: P1)

In the settings, the student unticks the fast 32nd-note arpeggio, or every arpeggio, or any other
texture, pattern or octave. The GA then never uses it. A tooltip explains each value. In the
command line, the same choice is a config key.

**Why this priority**: it answers a concrete complaint about the result with a small, predictable
control, and it is independent of the meter work.

**Independent Test**: arrange Korobeiniki with arp32 disallowed and seed 1. No bar's P2 gene is
arp32, the NES rules pass, and the arrangement downloads. With everything allowed, the result is
identical to today's.

**Acceptance Scenarios**:

1. **Given** arp32 is disallowed, **When** the GA runs, **Then** no plan of any generation uses
   arp32 in any bar.
2. **Given** both arpeggios are disallowed, **Then** P2 uses only hold, echo and third, and the
   idiom criterion can no longer reward arpeggios. The app says so next to the setting.
3. **Given** every value of a gene is disallowed, **When** the visitor tries to arrange, **Then**
   validation names the gene and asks for at least one value.
4. **Given** the default settings, **Then** the 10 samples' plans, fitness and MIDI are unchanged.
5. **Given** a `config.json` downloaded from the app with disallowed values, **When** the command
   line runs it, **Then** the command line respects the same allowed values.

---

### User Story 4 - Irregular meters and meter changes (Priority: P3)

A song in 5/4 or 7/8, or a MIDI song whose meter changes between sections (for example a bar of
2/4 inside a 4/4 song), is arranged bar by bar in each bar's own meter.

**Why this priority**: these songs are rarer, and they need the beat grouping of an irregular meter
(5/4 as 3+2, 7/8 as 2+2+3).

**Independent Test**: arrange a 5/4 ABC tune and a MIDI file whose time-signature map goes
4/4 → 2/4 → 4/4. Each bar has its own length, and the NES rules pass.

**Acceptance Scenarios**:

1. **Given** a 5/4 tune, **Then** its drums group the beats 3+2 (kick on beats 1 and 4).
2. **Given** a 7/8 tune, **Then** its beats group 2+2+3 eighths, and the bass changes on each
   group.
3. **Given** a MIDI song whose meter changes in the middle, **Then** bar lines follow the
   time-signature map, and each bar is realized in its own meter.
4. **Given** an ABC tune with an inline meter change (`[M:3/4]`), **Then** the bars after it have
   3 beats.

### Edge Cases

- A meter the app does not support (for example 11/16, or a numerator above 12): the app refuses
  it with a message that names the meter and the bar.
- A pickup in 3/4 or 6/8: the first bar is padded with a leading rest to the bar's length, as in
  4/4.
- A song whose last bar is incomplete in its meter: padded with a trailing rest when it completes
  the pickup, refused otherwise, naming the bar (as in 4/4).
- A phrase length that does not divide a section: the last phrase of the section is shorter, as
  in 4/4.
- Allowed values for the P1 octave that exclude 0 (the written octave): allowed; the fidelity
  criterion then scores every bar 0, and the app warns about it.
- A disallowed value in a plan loaded from an older settings file: the GA never produces it. Only
  the settings decide what is allowed.
- A 2/4 song arranged with the browser app before this feature (bars joined in pairs) gives
  different bars now. The run record's app version tells them apart.

## Requirements *(mandatory)*

### Functional Requirements

#### Meters

- **FR-001**: The system MUST read and arrange bars in these meters:
  - simple: 2/2, 2/4, 3/4, 4/4;
  - compound: 6/8, 9/8, 12/8;
  - at lower priority, irregular: 5/4 and 7/8.
- **FR-002**: Each bar MUST carry its meter. Its length in quarter-note beats is
  `numerator × 4 / denominator`. Its beats are:
  - in simple meters, the denominator note;
  - in compound meters, the dotted quarter (numerator / 3 beats);
  - in irregular meters, the groups 3+2 (5/4) and 2+2+3 (7/8).
- **FR-003**: The ABC reader MUST read the M: field and inline meter changes. The MIDI reader MUST
  read the time-signature map.
  - Bar lines follow the map.
  - A count-in in another meter is part of the map. The visitor can leave it out with the bar
    range.
- **FR-004**: 2/4 MUST be read as 2/4 bars (2 beats). The pairing of spec 002 FR-004 is withdrawn.
- **FR-005**: The plan keeps 4 genes per bar with the same values. Each realizer MUST adapt to the
  bar's meter:
  - P1 plays the written melody. P2's hold, arpeggios, echo and third follow the chords and the
    melody, as now.
  - TR root holds each chord. The octave pump alternates root and octave on the eighths. Root-fifth
    alternates root and fifth per beat, starting on the root. Walking plays one note per beat, and
    the last note approaches the next bar's root by a semitone (the fifth again at the end of the
    piece).
  - NO patterns are built from the bar's beats:
    - half time: kick on beat 1 and snare on the bar's middle strong beat, if it has one;
    - eighth beat: kick on the strong beats, snare on the weak beats, hi-hat on the eighths;
    - sixteenth beat: the same, with hi-hats on sixteenths;
    - fill: the eighth beat with a snare roll on the last beat.

    A drummer's priority (kick over snare over hi-hat) holds on shared steps.
- **FR-006**: For 4/4 bars, every realizer MUST give exactly the notes it gives today.
- **FR-007**: The score tables and the fitness MUST measure each bar on its own grid of sixteenth
  steps (`4 × beats in quarters`) instead of a fixed 16. Activity is onsets per step, capped at 1.
- **FR-008**: The NES rule check MUST verify complete bars of each bar's own length.
- **FR-009**: MIDI chord detection MUST decide one chord per half bar in duple and quadruple
  meters, and one per bar otherwise.
- **FR-010**: The ABC writer MUST write the meter, and a meter change where it happens, so a lead
  sheet in any supported meter reads back identically.
- **FR-011**: Unsupported meters MUST be refused with a message that names the meter and the bar.

#### Allowed textures

- **FR-012**: A new setting `allowed` MUST list, per gene, the values the GA may use:
  - `allowed.p2`: subset of hold, arp16, arp32, echo, third;
  - `allowed.tr`: subset of root, octave_pump, root_fifth, walking;
  - `allowed.no`: subset of none, half_time, eighth_beat, sixteenth_beat, fill;
  - `allowed.p1_octave`: subset of 0, +12, −12.

  The default is every value.
- **FR-013**: The random initial population and mutation MUST draw only allowed values. A gene
  with one allowed value never changes.
- **FR-014**: Validation MUST refuse a gene with no allowed value, naming the gene.
- **FR-015**: The app's settings panel MUST show the allowed values as checkboxes, grouped by
  channel, each with a tooltip on what the value plays. The fast arpeggio's tooltip says it plays
  32nd notes.
- **FR-016**: The command line MUST accept `allowed` in the config and record it in the run's
  `config.json`. The app's `config.json` MUST carry it, so both rerun the same choice.
- **FR-017**: With the default `allowed` and 4/4 inputs, the 10 samples' plans, fitness and MIDI,
  and every parity fixture of spec 002, MUST be unchanged.

### Key Entities

- **Meter**: numerator, denominator, beat grouping (a list of beat lengths in quarters), and bar
  length in quarters.
- **Bar** (extended): its meter, in addition to melody, chords, label, role and phrase.
- **Allowed values**: for each of the four genes, the subset of values the GA may draw.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 3/4 waltz, a 2/4 tune, a 6/8 jig and a 12/8 song (test inputs written for the
  project) arrange without error in the command line and in the app. Every arrangement passes the
  NES rule check with bars of the right length.
- **SC-002**: The 10 committed samples rerun to the same plan, fitness and MIDI bytes as before,
  and every spec 002 parity fixture still matches.
- **SC-003**: The app and the command line give the same score tables and fitness for a given plan
  on the 3/4, 6/8 and 2/4 test inputs, to 6 decimal places (parity, as in spec 002 SC-010).
- **SC-004**: With arp32 disallowed, 0% of the bars of any run use arp32, on the 8 committed lead
  sheets and seeds 1–3.
- **SC-005**: A visitor can open the settings and disallow the fast arpeggio in under 30 seconds,
  and the tooltip says what it plays.
- **SC-006**: Of 20 catalog songs in meters other than 4/4 (picked by the student), at least 16
  arrange without manual changes other than choosing the melody track.

## Assumptions

- The genome stays 4 genes per bar with the same value sets. Meters change how a gene value
  sounds, not which values exist.
- Odd meters other than 5/4 and 7/8 are out of scope. Their grouping is ambiguous without a
  notation hint.
- Tempo stays in quarter notes per minute, as `Q:` and MIDI give it. A 6/8 jig at "dotted quarter
  = 120" is read as quarter = 180.
- The new test inputs (waltz, jig, 2/4 tune, 12/8 song) are written for the project and committed
  as ABC. MIDI tests use synthetic files built in the tests. No third-party file is committed.
- Work continues on the branch `002-browser-arranger`. `main` changes only when the student
  merges.

## Dependencies and Constraints

- Constitution 1.3.0: the command line stays the reference. Both implementations change together,
  test-first, and the parity tests extend to the new meters (SC-003).
- Spec 002 FR-004 (2/4 joined in pairs) is replaced by FR-004 here.
- The abstract and the samples are 4/4. They are not regenerated, and SC-002 checks that they
  could be.
