# @4xian/jword-native

JWord 原生 `.jword` 保存、打开和校验包。

公开 API 仅通过 `dist` 导出。

## Worker 能力检测

调用 `detectJWordNativeWorkerCapability()` 检测宿主是否具备 `Worker`、`Blob`、Blob URL 与 `ArrayBuffer` 基础能力。不可用时返回 `JWORD_NATIVE_WORKER_UNAVAILABLE` 诊断，`fallback` 固定为 `none`，不提供同线程 fallback。

CSP 至少需要允许 `worker-src 'self' blob:`；如果构建工具用 Blob URL 包装 module worker，还需要 `script-src 'self' blob:`。
