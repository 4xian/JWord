# Repository Guidelines

## Project Structure & Module Organization

JWord is a pnpm workspace. Runtime packages live in `packages/*`, with source in each package's `src/` and colocated tests in `test/`. Core editor logic is under `packages/core/src`; keep it framework-agnostic and free of DOM work at module top level. Cross-package architecture, security, type, and E2E checks live in `tests/`. Examples are in `examples/*`, fixtures in `fixtures/`, benchmarks in `benchmarks/`, and maintenance scripts in `tools/`. SDK and implementation notes are under `docs/`.

## Build, Test, and Development Commands

- `pnpm install --frozen-lockfile`: install workspace dependencies.
- `pnpm dev`: run the local development helper.
- `pnpm build`: build all public outputs with Rollup and normalize dist imports.
- `pnpm lint`: run ESLint plus package-version, boundary, and comment checks.
- `pnpm typecheck`: run the repository TypeScript check.
- `pnpm test`: build first, then run Vitest unit/architecture tests.
- `pnpm test:e2e`: run Playwright projects across supported browsers.
- `pnpm test:visual`, `pnpm bench`, `pnpm size`: run visual, benchmark, and bundle-size gates.
- Focus a package with examples such as `pnpm --filter @4xian/jword-core test`.

## Coding Style & Naming Conventions

Use TypeScript ES modules. ESLint enforces single quotes, no semicolons, no trailing commas, and `@typescript-eslint/no-explicit-any`. TypeScript files must start with the repository header comment required by `tools/lint/check-comments.mjs` and `jword-boundaries/file-header`. Keep files small and responsibilities narrow; split files before they become difficult to review. Name tests `*.test.ts` and prefer feature-specific names such as `gate7-browser-support.test.ts`.

## Testing Guidelines

Use Vitest for unit, package, architecture, security, and type-oriented tests; use Playwright for browser flows. Add the smallest test that proves the changed behavior. For public API work, include `pnpm test:types`; for rendering, browser, or accessibility changes, include the relevant `pnpm test:e2e` or `pnpm test:visual` command. Always rerun the same focused command that failed before claiming a fix.

## Commit & Pull Request Guidelines

The repo uses Conventional Commits via commitlint, for example `fix: correct paste sanitizer` or `docs: add release notes`. Keep commits focused. Pull requests should describe the change, list verification commands, link the relevant issue or plan, and include screenshots or artifacts for UI, visual, or benchmark changes. Do not publish packages from PR scripts.

## Agent-Specific Instructions

Make surgical changes only. Do not introduce a separate mobile editor concept; use narrow viewport terminology for responsive behavior. For structural code questions, use CodeGraph before text search when the index is available.

Browser runtime changes must support Chrome/Edge 100, Firefox 128, and Safari 16.4. Prefer syntax and Web APIs already supported by Chrome 92 for JWord-owned browser source when that does not add complexity, but do not describe Chrome 92 as the full SDK support floor. Before introducing a browser API, verify both JWord source and direct runtime dependencies against the public matrix; if an API is unavailable, add feature detection plus an explicit fallback/polyfill or obtain approval to raise the minimum. ES2022/Vite build targets are not runtime API polyfills.

All production JWord server components are delivered only as versioned Docker images. Customer application code integrates browser SDK packages and connects to declared HTTP/WSS endpoints; Node and server npm packages remain inside the image. Repository Node entrypoints and local server examples are for development, testing, and image assembly, not customer production integration.
