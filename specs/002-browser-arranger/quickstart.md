# Quickstart: Validate the Browser Arranger

## Prerequisites

- Node 22 or newer, which provides `node --test` and Web Crypto.
- uv and the project environment (`uv sync`).
- The MIDI songs, for the reduction-parity checks:

  ```bash
  uv run src/main.py fetch
  ```

## 1. Core tests and parity with the command line

```bash
uv run src/main.py fixtures
```

```bash
cd arranger && node --test
```

Expected:
- every test passes;
- `fitness.test.js` reports the 10 samples matching the CLI fitness to 6 decimal places
  (SC-010);
- `midi-song.test.js` reports the 5 public MIDI songs reduced to the committed lead sheets bar
  for bar (SC-006);
- without `data/raw/`, the MIDI-song tests are skipped, not failed.

```bash
uv run pytest
```

Expected: the new catalog-parser tests and the `load_config` run-record test pass, and the old
suite stays green.

## 2. Determinism (SC-005)

`determinism.test.js` arranges Ievan Polkka twice with seed 1 at full pace and compares the MIDI
bytes.

```bash
cd arranger && node --test tests/determinism.test.js
```

Manual check across browsers:
1. Arrange the bundled Korobeiniki example with seed 1 in Chrome, Firefox and Safari.
2. Download the MIDI in each and compare:

   ```bash
   sha256sum ~/Downloads/korobeiniki-s1-*.mid
   ```

Expected: three identical hashes.

## 3. Serve locally

Serve the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/arranger/.

## 4. Scenario walk-through (User Stories 1–4)

| # | Do | Expect |
|---|---|---|
| 1 | Open the app with an empty cache | The drop zone is usable within 10 s (SC-001); the examples list shows the 8 committed lead sheets |
| 2 | Pick "Korobeiniki" and press Arrange | The curve, counters and plan grid move within 1 s; at "watch" pace the run ends in about 5 s; the stop reason reads "stagnation" |
| 3 | Press Play | Chip sound, moving playhead, channel lines in the four colors |
| 4 | Switch Original ↔ Arrangement three times during playback | Position kept; drawing matches the sound (US3) |
| 5 | Drop `data/raw/mpb/mulher_de_fases.mid` | Track list appears; choose track 6, bars 8–40, sections A@0, Chorus@8, A@16, Chorus@24; the lead-sheet summary shows 32 bars |
| 6 | Arrange, press Stop mid-run | The run ends within 0.5 s, "stopped by visitor", and the best plan so far plays |
| 7 | Set the population to 1, then press Arrange | The message names the population size and its range "at least 2"; no run starts |
| 8 | Arrange Ievan Polkka with fidelity 0 | Several bars show P1 at +12 or −12 in the grid |
| 9 | Download all three files | `.mid` (4 tracks), `.config.json`, `.abc`, all named with the run id |
| 10 | `uv run src/main.py arrange data/raw/mpb/mulher_de_fases.mid --config <downloaded>.config.json --seed 1` | The CLI accepts the file and writes a run folder |
| 11 | Open the catalog, type "fases" | "Mulher de Fases — Digão e Rodolfo — Raimundos" within 0.3 s; "voce" finds "Você" |
| 12 | Pick it, follow the two steps, drop the saved file | The credit and page link appear next to the input |
| 13 | Run the last 5 runs, open the run list | 5 runs with changed settings and best fitness; each plays |
| 14 | Turn the network off and reload | The app opens and arranges an example (FR-035) |
| 15 | Phone width 375 px (browser device mode) | No horizontal scroll; every control works by keyboard (FR-036) |

## 5. Privacy check (SC-008)

1. Open DevTools → Network, with "Preserve log" on.
2. Drop a file, arrange, play and download.
3. Read the log.

Expected: only requests for the app's own files and the examples, all under the same origin. No
request has a body, and no request goes to a third-party host.

## 6. Catalog build (maintainer)

```bash
uv run src/main.py catalog --letters "0-9"
```

It is a quick check on one index page (12 songs, about 13 requests). Then run the full build:

```bash
uv run src/main.py catalog
```

The full build makes about 3,700 requests, about 62 minutes at 1 request per second. It
resumes from `data/raw/catalog/`. Commit the updated `arranger/data/catalog.json`.

## 7. Deploy (after the student merges)

1. In the repository settings, set Pages → Source to "GitHub Actions" (one time).
2. Push to `main`. The `pages.yml` workflow runs `node --test`, writes `arranger/version.json`
   and deploys.
3. Check https://giowgiow.github.io/chiptune-ga-arranger/arranger/. Its footer shows the commit.
4. Check that `listen/` still works.
