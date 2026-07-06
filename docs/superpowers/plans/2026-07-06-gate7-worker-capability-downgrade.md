# Gate 7 Worker 能力检测与降级口径

日期：2026-07-06  
关联项：remediation plan `[计划审查 3.12]`、补充文档 D5

## 目标

为 `@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-native` 提供公开的 Worker 能力检测入口，让宿主在创建真实 Web Worker 前得到同步、可测试、可观测的结论。

## 决策

1. 不做同线程 fallback。
   - `fallback` 固定为 `none`。
   - Worker 不可用时只返回稳定诊断，调用方应停止对应导入、导出或 native package 任务。
2. 能力检测只做同步 feature detection。
   - 不创建真实 Worker。
   - 不读取文档内容。
   - 不触发 DOCX/PDF/native package 读写逻辑。
3. CSP 由宿主显式配置。
   - baseline：`worker-src 'self' blob:`。
   - 如果 bundler 用 Blob URL 包装 module worker，还需要 `script-src 'self' blob:`。

## 公开 API

| Package | API | CSP 常量 | 不可用诊断 |
|---|---|---|---|
| `@4xian/jword-docx` | `detectDocxWorkerCapability()` | `DOCX_WORKER_CSP_DIRECTIVES` | `DOCX_WORKER_UNAVAILABLE` |
| `@4xian/jword-pdf` | `detectPdfWorkerCapability()` | `PDF_WORKER_CSP_DIRECTIVES` | `PDF_WORKER_UNAVAILABLE` |
| `@4xian/jword-native` | `detectJWordNativeWorkerCapability()` | `JWORD_NATIVE_WORKER_CSP_DIRECTIVES` | `JWORD_NATIVE_WORKER_UNAVAILABLE` |

三个检测结果均包含：

- `status`: `available` / `unavailable`
- `missingRequirements`: 缺失的 `worker-constructor`、`blob-constructor`、`blob-url`、`array-buffer`
- `cspDirectives`: 对应 package 的 CSP 指令清单
- `fallback`: 固定 `none`
- `diagnostic`: 仅在 `unavailable` 时返回稳定诊断

## 验收证据

- 红灯先行：`pnpm exec vitest run tests/architecture/gate7-worker-capability.test.ts --reporter=verbose`，初始失败为 `detectDocxWorkerCapability is not a function`。
- 通过后：`pnpm exec vitest run tests/architecture/gate7-worker-capability.test.ts --reporter=verbose`。
- public API 与 diagnostics 联动：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-diagnostics-registry.test.ts tests/architecture/gate7-worker-capability.test.ts --reporter=verbose`。
- 生成产物一致性：`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check`。

## 非目标

- 不实现真实 worker host。
- 不启动浏览器页面验证 CSP。
- 不为 DOCX/PDF/native 提供同线程 fallback。
