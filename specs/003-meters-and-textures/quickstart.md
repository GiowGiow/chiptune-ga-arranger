# Quickstart: validating meters and allowed textures

Run every command from the repository root on the branch `002-browser-arranger`. Contracts:
[contracts/config.md](contracts/config.md), [contracts/files.md](contracts/files.md). Entities:
[data-model.md](data-model.md).

## 1. Test suites

```bash
uv run pytest
```

```bash
cd arranger && npm test
```

Expected:
- both suites pass;
- the JavaScript parity tests cover the meter tunes and the synthetic MIDI songs (SC-003).

## 2. The samples do not change (SC-002, FR-017)

Regenerate the fixtures and check that no committed value moved:

```bash
uv run src/main.py fixtures
```

```bash
git diff --stat arranger/tests/fixtures
```

Expected:
- The 4/4 fixture files change only by format: each bar has `"meter": "4/4"`, `beats_per_bar`
  is gone, and `act_no` is per bar.
- The semantic check of the polish phase passes: it loads the old and new JSON and compares
  every shared value.
- The command prints no "sample no longer matches" notice.

Rerun one sample and compare its MIDI bytes:

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 \
  --config samples/korobeiniki-s1/config.json --no-audio
```

```bash
cmp outputs/<new run id>/piece.mid samples/korobeiniki-s1/piece.mid
```

Expected: `cmp` prints nothing. The run id differs from the sample's, because the default
config gained `allowed`.

## 3. A waltz from the command line (US1, SC-001)

```bash
uv run src/main.py arrange tests/data/meters/waltz.abc --seed 1 --no-audio
```

Open `outputs/<run id>/pianoroll.png`. Expected:
- grey bar lines every 3 beats;
- the triangle bass in "oom-pah-pah" where the plan chose root–fifth;
- the drums kick on beat 1 of each bar in "eighth beat" bars;
- the run's `piece.mid` declares 3/4 (check with `uv run python -c "import pretty_midi;
  print(pretty_midi.PrettyMIDI('outputs/<run id>/piece.mid').time_signature_changes)"`).

Repeat with `polka.abc` (2/4), `jig.abc` (6/8), `slow_twelve.abc` (12/8), `five.abc` (5/4),
`seven.abc` (7/8) and `changes.abc`. Each run must finish with no NES rule violation.

## 4. No fast arpeggios (US3, SC-004)

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 --no-audio \
  --set 'allowed.p2=["hold","arp16","echo","third"]'
```

Expected:
- `metrics.json` shows no bar with P2 = 2 (arp32);
- `config.json` records the `allowed` lists.

The test suite checks the same on all 8 committed lead sheets with seeds 1–3, with a short
generation cap.

Invalid values fail before the GA runs:

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 --set 'allowed.no=[]'
```

Expected: `allowed.no must keep at least one value`.

## 5. In the app

Serve the repository root:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/arranger/ and check:

1. **Waltz.** Drop `tests/data/meters/waltz.abc`. The Song card shows "3/4". Arrange it. The
   plan grid shows 16 bars, playback is in time, and the downloaded MIDI declares 3/4.
2. **Allowed textures (SC-005).**
   - Open Settings, then "Allowed textures", and untick "fast arpeggio (32nd notes)". Its (i)
     tooltip says it plays 32nd notes.
   - Arrange Korobeiniki. No bar of the plan grid shows arp32.
   - Untick arp16 too: the warning about the idiom criterion appears.
   - Untick every P2 value: Arrange is refused, with the message naming `allowed.p2`.
3. **Export.** Download the run's `config.json`. It holds `allowed`. Rerun it on the command line
   with `--config` and check that no bar uses arp32.
4. **Count-in.** Drop `arranger/tests/fixtures/midi-songs/synthetic-count-in.mid`. The default bar
   range starts after the drum-only count-in.

## 6. Catalog songs in other meters (SC-006, student's check)

The student picks 20 catalog songs in meters other than 4/4. For each, they:
1. download it with the app's catalog panel;
2. drop it in the app;
3. pick the melody track and arrange.

At least 16 must arrange without other changes. This is a listening and usability check, so the
test suite cannot run it, and its result goes in the student's notes.
