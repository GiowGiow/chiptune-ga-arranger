# Contract: Page ↔ GA Worker

The GA runs in a module worker (`arranger/src/worker.js`, created with `{type: "module"}`).
The page and the worker exchange plain structured-clone messages. Plans travel as `Uint8Array`
(see data-model.md, Plan); every other value is JSON-compatible. One worker serves one run at a
time. A new `run` message cancels the current run.

## Page → worker

### `run`

```json
{
  "type": "run",
  "runId": "korobeiniki-s1-3fa2c901",
  "leadSheet": { "...": "Lead sheet, data-model.md" },
  "settings": { "...": "Settings, data-model.md" },
  "pace": "watch"
}
```

`pace` is `"watch"` (about 400 generations per second, research R6) or `"full"` (no pause).

### `stop`

```json
{ "type": "stop", "runId": "korobeiniki-s1-3fa2c901" }
```

The worker ends the run after the current slice, within 0.5 s (SC-003). It then answers with
`done`, with `stopReason: "stopped"`. A `stop` for a run that is not current is ignored.

### `pace`

```json
{ "type": "pace", "runId": "korobeiniki-s1-3fa2c901", "pace": "full" }
```

Changes the pace of the running GA; the plan it finds does not change (research R6).

## Worker → page

### `started`

```json
{ "type": "started", "runId": "…", "nBars": 32, "tables": { "applicable": { "contrast": true, "coherence": true, "bass_smoothness": true } } }
```

Sent after the score tables are built and before generation 0.

### `progress`

Sent at most every 50 ms, and always once after the last generation. It carries every generation
since the previous `progress`, so the page draws the curve without gaps.

```json
{
  "type": "progress",
  "runId": "…",
  "generations": [
    { "generation": 120, "best": 0.871, "mean": 0.803, "diversity": 0.93, "stagnation": 4 }
  ],
  "bestPlan": "Uint8Array(n_bars × 4), best plan so far",
  "bestFitness": 0.871
}
```

### `done`

```json
{
  "type": "done",
  "runId": "…",
  "bestPlan": "Uint8Array",
  "initialBestPlan": "Uint8Array",
  "bestFitness": 0.9221,
  "scores": { "complementarity": 0.91, "register": 1.0, "coherence": 0.88, "contrast": null, "bass_smoothness": 0.97, "idiom": 0.95, "fidelity": 1.0 },
  "stopReason": "stagnation",
  "generations": 1886,
  "durationMs": 4712
}
```

- `scores` holds `null` where a criterion does not apply.
- The page realizes the arrangement from `bestPlan` on the main thread. This is cheap: it is the
  `assemble` of one plan.

### `error`

```json
{ "type": "error", "runId": "…", "message": "elite_count must be at least 0 and smaller than population_size" }
```

The worker validates the settings again before it starts. The page has validated them already,
so this message only signals a bug.

## Guarantees

- Determinism: the same `leadSheet`, `settings` (seed included) and app version give the same
  `bestPlan` and the same `log`, whatever the pace and the timing of `progress` messages. A pause
  happens only between generations and never changes the random draws.
- Stop never yields a plan worse than the best one already reported.
- The worker loads no network resource and posts nothing but these messages.
