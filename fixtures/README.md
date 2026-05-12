# JWord Fixtures

Fixtures are small, reviewable inputs used by tests, examples, and benchmarks.

Current Gate 0 files:

- `plain-text/minimal.txt`: smallest plain text document with a title and one paragraph.
- `plain-text/long-placeholder.txt`: deterministic long-document placeholder for smoke benchmarks.
- `operation-fixtures/gate1-minimal-edit.json`: Gate 1.12 serialized operation replay fixture.

Rules:

- Keep fixture content deterministic and human-reviewable.
- Add new fixtures only when a gate has a test, visual baseline, or benchmark that consumes them.
- Do not store private documents or generated binary output here.
