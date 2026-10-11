# Agent instructions

Read `.specify/memory/constitution.md` before any change. It holds the project rules
(reproducibility, strict TDD, educational and visual code, layout, deliverables) and wins over
any other guidance.

- Python and dependencies: always through uv (`uv run`, `uv add`). Never edit `requirements.txt`
  by hand; the `uv-export` pre-commit hook regenerates it.
- Run the generator with `uv run src/main.py` and the tests with `uv run pytest`.
- New work follows the Spec Kit flow: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
  `/speckit-implement`.
- Do not edit the official ISMIR template files in `paper/` (see `.pre-commit-config.yaml`).

## Literature and prior research

The student keeps a private research library for this assignment outside the repository, in
the course folder (`../../references/`). `literature/` is a gitignored symlink to it, so the
paths below work from the repository root. A fresh clone outside the course folder does not
have it.

- Read `literature/tp1/investigacao.md` first: the TP1 research report (method comparison,
  stylistic constraints, datasets, evaluation, recommendation). Per-topic syntheses sit next to
  it: `curso.md` (what the course slides teach, with slide pages), `markov.md`, `grammar.md`,
  `ga.md`, `geral.md` (surveys, evaluation metrics, datasets, tools) and `ga-arranjo-nes.md`
  (literature for the chosen design, the GA arranger for the NES, with a related-work kit).
- `literature/INDEX.md` lists every paper by method. Each paper has an entry
  `literature/entries/<key>.md` (BibTeX, summary, technique with PDF pages, TP1 relevance, a
  ready English related-work sentence, the student's notes) and, when open access, a PDF in
  `literature/pdfs/<key>.pdf`. The full text with one `## Página N` section per page is in
  `../../text/references/<key>.md`.
- Search and export with the library tool, run from the repository root:
  `python3 ../../tools/refs.py list --method markov --tp1 core`,
  `python3 ../../tools/refs.py search "<regex>" --fulltext`,
  `python3 ../../tools/refs.py show <key>`.
- The library is in Portuguese. Text written into this repository stays in English
  (constitution): translate and paraphrase, never paste Portuguese notes.
- In committed files (specs, plans, `docs/`, README, notebooks, the abstract), refer to papers
  by their BibTeX key, never by a `literature/` path, because the link breaks in the public
  repository. The abstract's bibliography is `paper/references.bib`, exported from the library
  (do not retype entries):
  `python3 ../../tools/refs.py bib <key> <key> ... -o paper/references.bib`.
- In `/speckit-plan` Phase 0, base `research.md` on the library before searching the web, and
  cite entries by key with the PDF page, for example `pachet2011markov p. 4`. Check claims
  against the full text, not only the entry summary.
- Never copy PDFs, entry files or the research reports into this repository: they contain
  third-party material and the repository becomes public. The entry fields `status` and
  `interest` and the "Notas do aluno" section belong to the student; change them only on request
  (`refs.py mark`).
