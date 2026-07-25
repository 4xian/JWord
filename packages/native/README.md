# @4xian/jword-native

JWord 原生 `.jword` 保存、打开和校验包。

公开 API 仅通过 `dist` 导出。

## Worker 能力检测

调用 `detectJWordNativeWorkerCapability()` 检测宿主是否具备 `Worker`、`Blob`、Blob URL 与 `ArrayBuffer` 基础能力。不可用时返回 `JWORD_NATIVE_WORKER_UNAVAILABLE` 诊断，`fallback` 固定为 `none`，不提供同线程 fallback。

CSP 至少需要允许 `worker-src 'self' blob:`；如果构建工具用 Blob URL 包装 module worker，还需要 `script-src 'self' blob:`。

## 诊断契约

资源或解压预算超限返回 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`。schema 错误的可选 `path` 是安全 JSON Pointer，只由已知字段和数字索引组成；Worker error shape 的 `message` 固定为稳定 `code`。用户可见的 `zh-CN` / `en-US` 提示由 UI、wrapper 或宿主按 code 映射。
