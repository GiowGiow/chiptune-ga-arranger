# Contract: the `allowed` configuration key

This key is shared by the command line (`configs/default.json`, `--config`, `--set`) and by the
app (its settings form, and the `config.json` it imports and exports).

## Shape

```json
{
  "allowed": {
    "p2": ["hold", "arp16", "arp32", "echo", "third"],
    "tr": ["root", "octave_pump", "root_fifth", "walking"],
    "no": ["none", "half_time", "eighth_beat", "sixteenth_beat", "fill"],
    "p1_octave": [0, 12, -12]
  }
}
```

- The four sub-keys are fixed: `allowed.x` for another `x` is an "unknown configuration key"
  error.
- A file may give only some sub-keys (`{"allowed": {"p2": ["hold", "arp16"]}}`), and the others
  keep their defaults, as `weights` does.
- Each value replaces the whole list. Lists do not merge.
- `p1_octave` values are integers in semitones. The app's form shows them as "as written",
  "octave up" and "octave down".

## Command-line overrides

The value is parsed as JSON:

```bash
uv run src/main.py arrange data/leadsheets/korobeiniki.abc --seed 1 --no-audio \
  --set 'allowed.p2=["hold","arp16","echo","third"]'
```

## Validation

Python `config.load_config`; JavaScript `settings.js` `checkSettings`. Both use the same messages.

| Input | Error message |
|---|---|
| not a list | `allowed.p2 must be a list of P2 textures` |
| empty list | `allowed.p2 must keep at least one value` |
| unknown value | `allowed.p2: unknown value "arp64"; valid values: hold, arp16, arp32, echo, third` |
| duplicate | `allowed.tr: "walking" is listed twice` |

For `allowed.tr`, `allowed.no` and `allowed.p1_octave`, the message names that key and its
values.

## App warnings (not errors)

The app shows these under the "Allowed textures" group.

| Condition | Warning |
|---|---|
| `p2` has neither `arp16` nor `arp32` | "Without arpeggios, the idiom criterion can no longer reward single-chord bars." |
| `p1_octave` lacks `0` | "Without the written octave, the fidelity criterion scores 0 in every bar." |
| `no` is only `["none"]` | "The noise channel stays silent." |

## Run records

- `configs/default.json` holds the full default.
- A run's `config.json` (command line or app) records the resolved `allowed`.
- A record without `allowed` (every sample committed before this feature) reruns with the default,
  which is everything allowed.
- `RUN_RECORD_KEYS` is unchanged: `allowed` is a hyperparameter, not a run key.
