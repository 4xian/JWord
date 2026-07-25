# JWord Benchmarks

Gate 0 provides a runnable smoke benchmark so the root `pnpm bench` script has a real target.

Command:

```sh
pnpm --filter @4xian/jword-benchmarks bench
```

Current benchmark:

- `gate45-native-benchmark.mjs` measures `.jword` save/load/validate over synthetic native fixtures.
- `phase4-input-hotpath-benchmark.mjs` measures the 10 万字 / 200 页 fixture across model load, layout, visible render, and input hotpath P50/P95.
- `smoke-benchmark.mjs` reads `fixtures/plain-text/long-placeholder.txt`.
- It reports fixture size and text metrics as JSON.
- It does not claim final P95 < 50ms达标；Phase 4 input hotpath threshold is locked only after the专项优化 reaches the documented target.

Future gates should add package-specific benchmarks next to the implementation they measure, then keep this smoke benchmark as the fast baseline.
