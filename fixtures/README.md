# JWord Fixtures

Fixtures are small, reviewable inputs used by tests, examples, and benchmarks.

Current fixture files:

- `plain-text/minimal.txt`: smallest plain text document with a title and one paragraph.
- `plain-text/long-placeholder.txt`: deterministic long-document placeholder for smoke benchmarks.
- `plain-text/gate2-50-pages.txt`: deterministic Gate 2 plain-text seed expanded by visual, benchmark, and vanilla demo checks to at least 50 A4 pages.
- `plain-text/gate2-mixed-zh-en.txt`: Gate 2 mixed Chinese and English visual fixture.
- `plain-text/gate2-emoji.txt`: Gate 2 emoji and grapheme visual fixture.
- `plain-text/gate2-long-paragraph.txt`: Gate 2 long paragraph visual fixture.
- `operation-fixtures/gate1-minimal-edit.json`: Gate 1.12 serialized operation replay fixture.

Rules:

- Keep fixture content deterministic and human-reviewable.
- Add new fixtures only when a gate has a test, visual baseline, or benchmark that consumes them.
- Do not store private documents or generated binary output here.
