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
