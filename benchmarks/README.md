# JWord Benchmarks

Gate 0 provides a runnable smoke benchmark so the root `pnpm bench` script has a real target.

Command:

```sh
pnpm --filter @4xian/jword-benchmarks bench
```

Current benchmark:

- `gate45-native-benchmark.mjs` measures `.jword` save/load/validate over synthetic native fixtures.
- `smoke-benchmark.mjs` reads `fixtures/plain-text/long-placeholder.txt`.
- It reports fixture size and text metrics as JSON.
- It does not claim layout, render, input, docx, PDF, or collab performance.

Future gates should add package-specific benchmarks next to the implementation they measure, then keep this smoke benchmark as the fast baseline.
