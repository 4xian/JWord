# Gate 0 Development

This document is the developer quickstart for the Gate 0 engineering base.

## Local Install

Use pnpm from the repository root:

```sh
pnpm install --frozen-lockfile
```

Dependency rule:

- Use exact external dependency versions.
- Do not use `^` or `~`.
- Keep workspace dependencies on local workspace packages.

Registry versions checked for Worker 3 files on 2026-05-11:

- `vite`: `8.0.12`
- `typescript`: `6.0.3`

## Run Checks

Repository-level commands expected by Gate 0:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bench
```

Worker 3 package-level commands:

```sh
pnpm --filter @4xian/jword-example-vanilla typecheck
pnpm --filter @4xian/jword-example-vanilla build
pnpm --filter @4xian/jword-benchmarks bench
```

## Commit And Comment Rules

Commits must follow Conventional Commits. The repository uses Husky `commit-msg`
to run:

```sh
pnpm exec commitlint --edit "$1"
```

The `prepare` script installs Git hooks through Husky during `pnpm install`.

Code comments in `.ts`, `.tsx`, `.js`, and `.mjs` files must use Chinese prose.
`pnpm lint:comments` fails on obvious English long sentences in comments while
allowing URLs, package names, code identifiers, TSDoc tags, and eslint/TypeScript
directives. It skips generated or external folders such as `node_modules`,
`dist`, and `logs`.

Test files must not live next to source files. Put package tests in the package
`test/` directory, and repository-level architecture or integration tests in
the root `tests/` directory. `pnpm lint` fails if `*.test.*` or `*.spec.*`
appears under any `src/` directory.

## Start Vanilla Example

```sh
pnpm --filter @4xian/jword-example-vanilla dev
```

The demo imports `Editor` from `@4xian/jword-core`, mounts it into `#jword-editor`, and destroys it on page unload.

It must not:

- create a temporary `contenteditable` editor;
- bypass the future transaction pipeline;
- implement Gate 1 state, Gate 2 layout/render, or Gate 3 input behavior inside the demo.

## Fixtures

Current Gate 0 fixtures:

- `fixtures/plain-text/minimal.txt`
- `fixtures/plain-text/long-placeholder.txt`

Keep fixture content deterministic, reviewable, and free of private documents.

## Release Safety

Agents and scripts must not automatically run:

- `git commit`
- `git tag`
- `npm publish`
- `pnpm publish`
- release automation that publishes packages

Commit, tag, and publish require explicit human approval.
