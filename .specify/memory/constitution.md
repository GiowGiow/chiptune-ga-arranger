# DCC831 TP1 Algorithmic Composition Constitution

This project is the first assignment (TP1) of DCC831 – Generative AI for Music (UFMG, 2026/2).
It implements one classic algorithmic composition method end to end, from a symbolic
representation to synthesized audio, and reports it in an ISMIR-format abstract.

The code has two goals of equal weight: produce correct, reproducible music, and teach a human
reader how the method works. Every principle below serves one or both goals.

**Audience.** Primary readers are the student, the course staff and classmates. They know
Python and basic music theory (notes, intervals, scales, meter). They do not know the internals
of the method this project implements. AI coding agents are secondary readers and follow the
same rules.

## Core Principles

### I. Deterministic Reproducibility (NON-NEGOTIABLE)

- Every generation run MUST take an explicit integer seed. The same configuration and seed MUST
  produce the same MIDI content.
- Randomness MUST come from a `numpy.random.Generator` (`np.random.default_rng(seed)`) passed as
  a parameter. Global random state (`random.seed`, `np.random.seed`, module-level generators) is
  forbidden.
- Every generated piece MUST be saved with a `config.json` next to it that records the seed, all
  hyperparameters, the git commit hash and the creation date.
- Every result in the README and in the abstract (MIDI, audio, figures, tables) MUST be
  regenerable with commands documented in the README.

Rationale: the assignment requires reproducible symbolic output, and MIR results are only
credible when implementation details can be rerun.

### II. Test-First Development (NON-NEGOTIABLE)

- Production code MUST follow red-green-refactor: write a test, run it and see it fail for the
  expected reason, write the minimum code to pass, then refactor with the tests green.
- No production function is written without a failing test that requires it. A bug fix starts
  with a test that reproduces the bug.
- Tests MUST cover the method core (for example: transition rows sum to 1, the grammar derives
  only valid terminals, genetic operators keep genotype length) and one end-to-end path
  (generate, write MIDI, read it back with music21).
- Test names MUST state the behavior in plain language, so the test suite reads as an
  executable specification of the method.
- Scripts that only produce figures or audio are exempt from test-first, but the functions they
  call are not.

Rationale: tests written first force a clear definition of each musical rule before the code,
and they double as worked examples for the reader.

### III. Explicit Symbolic Representation and Style Contract

- The method core MUST work on an internal representation with explicit units: pitches as MIDI
  numbers 0–127, durations in quarter-note beats (`quarterLength`), and declared meter, key and
  tempo. Seconds and MIDI ticks appear only in the export layer.
- Export to MIDI (and to MusicXML or audio) MUST live in its own module, separate from the
  method core.
- Every generated piece MUST pass validation before export: pitches inside the instrument
  range, durations greater than zero, and complete bars for the declared meter.
- The chosen stylistic constraint (for example, a 12-bar blues or an AABA form) MUST be encoded
  as checkable rules (bar count, harmonic progression, scale membership) and verified by tests.

Rationale: separating musical meaning from file formats makes the method testable and easy to
explain, and the assignment requires an explicit stylistic constraint.

### IV. Learnable Code

- Every module in `src/` MUST open with a docstring that explains the musical or algorithmic
  idea it implements, in plain language, before any implementation detail.
- Every public function MUST have type hints and a docstring. Functions in the method core MUST
  include a small worked example in the docstring (doctest format) that runs under pytest.
- Names MUST use domain vocabulary (`transition_matrix`, `bar`, `chord_progression`), not
  generic names (`data`, `tmp`, `arr`).
- Comments explain the why: a trade-off, a boundary condition, a musical rule, or a link to the
  literature. They MUST NOT restate what the code does. Use 1 to 3 lines before a non-trivial
  block; do not flood the code with comments.
- Every music-theory or method term MUST be defined on first use in the documentation and
  collected in `docs/glossary.md`.
- Documentation follows the Diátaxis split: a tutorial (the walkthrough notebook), how-to
  guides (README commands), reference (docstrings and `--help`), and explanation
  (`docs/explanation.md`: why this method and how it works).

Rationale: the course is about understanding generative methods; code that a classmate cannot
follow fails half of the project's goal.

### V. Visual and Explorable Explanations

- Each core concept MUST have a visual that a human can inspect: a piano roll for every
  generated piece, plus the method's own structure (transition matrix heatmap for Markov,
  fitness-per-generation curve for genetic algorithms, derivation tree for grammars).
- A walkthrough notebook in `notebooks/` MUST take the reader from the input (corpus or rules)
  to a generated piece step by step, with visuals, rendered score and audio playback, and with
  controls for at least one hyperparameter. Notebooks MUST be marimo notebooks (stored as plain
  Python, reactive, runnable as scripts), not `.ipynb` files.
- The README and `docs/explanation.md` MUST include a pipeline diagram written in Mermaid so it
  renders on GitHub and stays diffable.
- A visual MUST NOT be the only source of meaning: every figure or diagram has a caption or a
  short text that states what the reader should see in it.
- Figures MUST be generated by scripts, never edited by hand, and use a colorblind-safe palette
  (`tableau-colorblind10`, as the ISMIR template recommends). Figures for the abstract are
  saved as vector PDF in `paper/figures/`.

Rationale: generated music is hard to judge from code alone; seeing and hearing intermediate
steps is how humans (and reviewers) build intuition about the method.

### VI. Measurable Evaluation

- Every experiment MUST report simple objective metrics: pitch-class histogram, interval
  distribution, note density and pitch entropy. When a corpus is used, compare the generated
  pieces against it.
- Every experiment MUST state what was varied (seed or hyperparameter) and what stayed fixed.
- Listening notes (qualitative observations) complement the metrics and are recorded next to
  each piece.

Rationale: the abstract needs a results section that goes beyond "it sounds good", and metrics
make the effect of each hyperparameter visible.

### VII. Simplicity

- Write only the code that the assignment, the abstract and principles IV–V require. No
  speculative abstractions, plugin systems or configuration layers.
- Keep the method core made of pure functions; file and network I/O happen only at the edges
  (command line, export, notebooks).
- Add a dependency only when the code uses it, and prefer the libraries already in the project.

Rationale: a small, direct codebase is easier to test, explain and grade.

## Technology and Assignment Constraints

- Stack: Python 3.12, uv for every environment and dependency operation, ruff for lint and
  format, pytest for tests, music21 and pretty_midi for symbolic music, numpy for numerics,
  matplotlib for plots, marimo for notebooks.
- Type hints are required on public functions. Pyright runs in the editor; it is not a commit
  gate.
- Layout: code lives directly in `src/`, in subfolders by responsibility, with `src/main.py` as
  the argparse entry point (`uv run src/main.py`). Tests live in `tests/`, the abstract in
  `paper/`, notebooks in `notebooks/`, long-form docs in `docs/`, and curated pieces in
  `samples/`.
- Language: all repository text is in English: code, identifiers, docstrings, comments, Spec
  Kit artifacts, README, glossary, explanation document, notebook narrative and the abstract.
  Every Markdown code block carries a language tag.
- Method fidelity: the project uses exactly one method (generative grammar, genetic algorithm
  or Markov chain), as the assignment requires, and exposes that method's required elements
  (Markov order; GA genotype, operators and fitness log; formal probabilistic grammar).
  Hyperparameters come from the command line or a config file, never from constants in code.
- Outputs: each run writes `outputs/<run-id>/` with `piece.mid`, `piece.mp3`, `pianoroll.png`
  and `config.json`. `outputs/` is not versioned. The pieces chosen for the deliverables are
  copied, with all four files, to `samples/<name>/` by a documented command, and only
  `samples/` is versioned. Audio is rendered only from the generated MIDI with FluidSynth and a
  General MIDI soundfont, never edited by hand, and each audio file stays under 5 MB.
- Data: if a corpus is used, its source and license are recorded in the README; large corpora
  stay out of git in `data/raw/` and are downloaded by a documented command.
- Deliverables: public GitHub repository with README (install, reproduce, pieces, AI usage
  statement) and `requirements.txt`; at least 3 synthesized pieces in the repository; an ISMIR
  abstract of at most 3 pages of content (postgraduate rule) with at least 4 references, 3 of
  them on the chosen method applied to music.

## Development Workflow and Quality Gates

- pre-commit runs on every commit: file hygiene, ruff check and format, `uv.lock` sync and
  `requirements.txt` export. pytest, including doctests, runs before every push.
- Each commit is small and leaves the test suite green. Under principle II, the failing test
  and the code that makes it pass may land in the same commit, but the test is written first.
- Before a feature is done, its docstrings, glossary entries, visuals and README commands are
  updated in the same change (principles IV and V).
- Spec Kit flow for new work: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement`. Every plan includes a constitution check against this document.

## Governance

- This constitution supersedes other practices and Spec Kit artifacts. When a spec, plan or
  task conflicts with it, the constitution wins or is amended first.
- Amendments go through `/speckit-constitution`, need the student's approval, and update the
  version: MAJOR for removing or redefining a principle, MINOR for adding a principle or
  section, PATCH for wording.
- Every plan and review checks compliance with principles I–VII. A deviation is allowed only
  when it is written down in the plan with its reason.
- Agent guidance files in the repository (such as `CLAUDE.md`) must not contradict this
  document.

**Version**: 1.0.1 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11
