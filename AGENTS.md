# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm workspace for JWord. Core editor logic lives in `packages/core/src`, and package-level tests live in `packages/core/test`. Repository architecture tests belong in `tests/architecture`. Demo code is in `examples/vanilla`, reusable sample inputs are in `fixtures/plain-text`, local automation scripts are in `tools`, benchmark entry points are in `benchmarks`, and design/spec notes are kept under `docs`.

## Build, Test, and Development Commands

Use Node `>=20.19.0` and pnpm `9.14.2`.

- `pnpm install --frozen-lockfile`: install exact locked dependencies.
- `pnpm lint`: run ESLint plus package-version, boundary, and comment checks.
- `pnpm typecheck`: run TypeScript checks without emitting files.
- `pnpm test`: run Vitest unit tests.
- `pnpm test:e2e`: run Playwright projects for Chromium, Firefox, and WebKit.
- `pnpm build`: build packages with Rollup.
- `pnpm dev`: start the local development helper.
- `pnpm bench`, `pnpm size`, `pnpm test:visual`: run benchmark, bundle-size, and visual dry-run checks.

For the vanilla demo, use `pnpm --filter @4xian/jword-example-vanilla dev`.

## Coding Style & Naming Conventions

The project uses TypeScript ESM. Follow the existing style: single quotes, no semicolons, no trailing commas, and no `any`. TypeScript files must start with a responsibility/boundary/collaborator/constraint/spec header comment. Code comments in `.ts`, `.tsx`, `.js`, and `.mjs` files should use Chinese prose. Keep `packages/core` framework-agnostic: no top-level DOM access and no imports from UI, docx, PDF, collaboration, demo, Vite, or Playwright packages.

## Testing Guidelines

Use Vitest for unit and architecture tests, and Playwright for e2e checks. Test files must not live under any `src` directory. Place package tests in that package's `test/` directory, and repository-level integration or boundary tests in `tests/`. Name tests with `.test.ts` or `.spec.ts`.

## Commit & Pull Request Guidelines

Commits use Conventional Commits, enforced by commitlint through Husky. Recent examples include `feat: establish gate 0 foundation` and `feat: 实现gate1任务`. Before opening a pull request, run the relevant CI-equivalent checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and any affected e2e, visual, benchmark, or size checks. PR descriptions should summarize intent, verification commands, and user-visible changes; include screenshots for UI/demo changes.

## Release Safety

Do not run `git commit`, `git tag`, `npm publish`, `pnpm publish`, or release automation without explicit human approval.
