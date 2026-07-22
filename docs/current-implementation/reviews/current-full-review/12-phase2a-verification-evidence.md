# Phase 2A native 不可信输入预算执行证据

本文记录 Phase 2A 已实际执行的证据。B1-B5 及后续复核修复均已完成，Standards/Spec 双轴复审无剩余 finding；`SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10` 与 Phase 2A 已重新 `Closed`，本轮不进入 Phase 2B。

## 2A-B1：ZIP preflight 与预算 seam

### `@zip.js/zip.js@2.8.31` 静态兼容审计

- 精确版本：`2.8.31`。
- 许可证：`BSD-3-Clause`。
- 生产依赖闭包：包自身没有 `dependencies`；`pnpm --filter @4xian/jword-native list @zip.js/zip.js --depth 3` 只解析到该精确版本。
- Vite ES2022 实际闭包：fresh vanilla build 的 Worker evidence 记录 `@zip.js/zip.js` 33 个模块、`jszip` 1 个模块；两者都只命中 `assets/native-worker-*.js`，免费 `index.html` 首屏命中为 0。
- Native 读取配置固定为 `strictness: 'strict'`、`useWebWorkers: false`、`useCompressionStream: false`；不允许公开 options、环境变量或 Worker message 放宽。

| 能力 | 精确包/实际 bundle 用途 | 最低目标静态结论 | Native 处理 |
| --- | --- | --- | --- |
| `ReadableStream` / `WritableStream` / `TransformStream` | zip.js reader、codec stream 和 JWord 有界 writer | Chrome 100、Edge 100、Firefox 128、Safari 16.4 均具备 | 必需；有界 writer 在缓存 chunk 前检查实际输出 |
| `AbortSignal` / `AbortController` | `getData()` signal 与 Worker 内取消 | 四个最低目标均具备 | signal 直接传入 zip.js；JWord 闭包保留首次 terminal reason |
| `CompressionStream` / `DecompressionStream` | zip.js 可选原生压缩分支 | 不作为兼容前提 | 固定 `useCompressionStream: false`，避免 `deflate-raw` 子格式差异 |
| Web Worker | zip.js 可选嵌套解压 Worker | 不作为依赖内部前提 | 固定 `useWebWorkers: false`；Native 外层 Dedicated Worker 边界保持不变 |
| `BigInt`、typed array、`DataView` | ZIP64/整数与二进制记录解析 | 四个最低目标均具备 | format v1 原始 preflight 仍 fail closed 拒绝 ZIP64 |
| `TextEncoder` / `TextDecoder` | entry 名称和 JSON UTF-8 | 四个最低目标均具备 | JSON 使用 fatal UTF-8 decode；entry 名按 UTF-8 bytes 计量 |
| WebAssembly | zip.js deflate fallback | 四个最低目标均具备 | 原生 CompressionStream 关闭后使用已打入 Worker lazy chunk 的 WASM fallback |

静态审计结论：未发现要求提高 Chrome 100、Edge 100、Firefox 128 或 Safari 16.4 最低版本的语法/API，也未命中 Phase 2A 第 12 节兼容停止条件。Vite `target: es2022` 只作为语法构建配置，不被当作运行时 API polyfill 或最低版本实测证据。

### focused 红绿与预算停止证据

- 初始公开红灯：重复 `document.json` 输入使 `validateJWordPackage()` 返回 `valid: true`，断言 `expected true to be false`。
- 公开结构矩阵：重复/穿越/drive-qualified 绝对路径、加密、原始区间 overlap、目录带内容均由 validate/load 双 seam 返回同一稳定 code；ZIP64 另以 13 个独立 case 覆盖 archive EOCD/locator/count-size-offset sentinel，以及 central/local entry extra、size、offset、disk sentinel。
- 实际输出：动态 fixture 的 `document.json` 中央目录声明恰好 16 MiB，实际 deflate 输出为 16 MiB + 1 byte；公开 validate/load 均以 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` 拒绝。
- 停止观察：测试记录至少一个正数 progress；拒绝后继续观察 100 ms，accepted output/progress 均不再增长。测试总耗时 774 ms，未命中“拒绝后仍持续输出或超过拒绝时限”停止条件。
- 保存侧：1 MiB metadata exact 成功并可由公开 load 重开，`+1` byte 在保存阶段拒绝；资源 ID `.` / `..` 分别保存为 `resources/%2E` / `resources/%2E%2E` 并成功 roundtrip。

### B1 验证结果

- `pnpm --filter @4xian/jword-native test`：45/45 通过（首次 reviewer 修复前基线；修复后数字以后续批次收口命令为准）。
- `pnpm --filter @4xian/jword-native typecheck`：通过。
- `pnpm --filter @4xian/jword-native build`：通过。
- `pnpm exec vitest run tests/architecture/gate45-native-bundle.test.ts --reporter=verbose`：通过。
- `node tools/size/check-native-bundle.mjs`：fresh 清理、构建、module evidence 和首屏/lazy 扫描通过。
- focused ESLint：通过。

## 2A-B2：manifest/checksum 数字与结构

### focused 红绿与严格解析证据

- checksum 数字红灯：`byteLength: -1` 初始错误落到 `JWORD_NATIVE_HASH_MISMATCH`；green 后负数、小数和超过 `Number.MAX_SAFE_INTEGER` 均在公开 validate/load seam 返回 `JWORD_NATIVE_CHECKSUMS_INVALID`。
- manifest 版本红灯：`formatVersion: 1.5` 初始进入 `JWORD_NATIVE_FORMAT_UNSUPPORTED`；green 后 format/schema/minimum reader 三类版本字段均先执行非负 safe integer 校验，再执行 supported/future 判断。
- manifest 资源红灯：资源 `id` 类型错误初始被静默过滤并返回 `valid: true`；green 后任一资源项类型、MIME、packed/path 组合、path 形状或唯一性错误都会整体拒绝 manifest。
- checksum schema：SHA-256 固定为 64 位小写 hex，MIME 去除首尾空白后必须非空，key 只允许 `document.json`、`metadata.json` 和 manifest 中合法 packed resource path。
- 固定 item 预算：checksum、manifest resources 和 `packageEntries` 的 1,025 项动态输入均以 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` 拒绝；预算检查发生在逐项 entry 读取前。
- strict JSON：manifest 与 checksums 在 `JSON.parse()` 前通过递归下降扫描器检查每层 object；公开回归覆盖转义后同名的顶层 key、checksum entry 名、manifest resource 字段和 checksum entry 字段，均保持各自 INVALID code，未把重复 key 或原始 JSON 写入 diagnostic。
- checksum 长度前置：约 512 KiB 的预算内 `document.json` 使用错误声明长度时，红灯进度曾增长到 524,890 bytes；green 后只读取 manifest/checksums 即以 `JWORD_NATIVE_HASH_MISMATCH` 拒绝，validate/load 的最大公开 progress 均小于 64 KiB，未进入大 document 解压。
- 读取缓存与错误优先级：document、metadata 和 packed resource 的 checksum 复用 bounded reader 缓存；核心 JSON 解析失败后停止后续 entry/hash，validate 只保留首个结构 diagnostic，load 抛同一 code。
- 独立复审红灯：checksum 与 format 同时失败时，validate 初始返回 `JWORD_NATIVE_HASH_MISMATCH`、`JWORD_NATIVE_FORMAT_UNSUPPORTED` 两个 terminal diagnostics；修复后 checksum 阶段立即停止，integrity 阶段只接收首个 terminal diagnostic，validate/load 均只返回首个 `JWORD_NATIVE_HASH_MISMATCH`。

### B2 验证结果

- `pnpm exec vitest run packages/native/test/public-api-security.test.ts`：45/45 通过（B2 关单时历史快照；后续回归拆分后的当前结果见最终统一收口证据）。
- `pnpm --filter @4xian/jword-native test`：78/78 通过。
- `pnpm --filter @4xian/jword-native typecheck`：通过。
- `pnpm --filter @4xian/jword-native build`：通过。
- `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-release.test.ts --reporter=verbose`：7/7 通过。
- B2 相关文件 focused ESLint：通过。
- `git diff --check`：通过。
- 未命中 Phase 2A 第 12 节强停止条件；B2 独立只读复审在唯一 terminal code finding 闭环后确认 Standards 与 Spec 两轴无有效阻断 finding。

## 2A-B3：严格版本化 document parser

### focused 红绿与版本边界证据

- schema 结构红灯：`section.blocks` 非数组、未知 block/inline kind、table cell 嵌套错误、非整数 section columns、重复 block/run/resource ID、悬空 comment/revision/run/resource 引用均通过公开 validate/load 双 seam 复现；green 后分别稳定返回 `JWORD_NATIVE_DOCUMENT_INVALID` 或 `JWORD_NATIVE_RESOURCE_REFERENCE_MISSING`。
- revision 红灯：不完整 revision metadata 初始被 validate 判为 `valid: true`；green 后完整校验 revision discriminant、必填字段、range snapshot、format snapshots，以及 run `revisionId` 与 snapshot `runId` 引用。
- 资源引用红灯：manifest 声明资源但 `document.resources` 缺失时初始被接受；green 后 `document.resourceIds` 与 image `resourceId` 必须指向 document 自身资源表，且错误消息和 entry 不复制攻击者 ID。
- migration 红灯：schema 0 的 load 会迁移，但 validate 初始没有执行 migration、warnings 为空；green 后 `readPackageParts()` 统一执行来源版本 parser、migration、当前版本复验和 integrity，validate/load 复用同一 canonical document，schema 0 validate/load 均带 `JWORD_NATIVE_OLD_SCHEMA_MIGRATED`。
- 保存红灯：通过类型断言伪造的嵌套 `blocks: {}` 初始仍能生成 ZIP；green 后保存先生成 JSON-safe snapshot，执行 document 字节、JSON depth/value 与 current schema 校验，再收集资源和创建 manifest。保存侧同步拒绝重复 block ID 与悬空 resource 引用。
- metadata 预算红灯：65 层小型 metadata 初始可被 validate 接受；green 后 metadata 读写两侧都复用 strict JSON depth/value 预算，保存器不会生成同版本 reader 无法重开的 metadata。
- strict JSON 与开放字段：`document.json` 解码后重复 key 在 `JSON.parse()` 前拒绝；空 ID 和超过 256 UTF-8 bytes 的 ID 拒绝。`ModelProperties` 与 resource metadata 的未知嵌套 JSON 字段仍能 save/load/save roundtrip 保留。
- 固定预算：`package-read-budget.test.ts` 对包括 `documentNodeCount`、`jsonDepth`、`jsonValueCount` 和 `identifierBytes` 在内的全部固定预算执行 exact/`+1` 算术，不分配生产上限等量内存。
- 独立复审 anchor 红灯：range anchor 的 document/section/block/run 不存在或实体存在但归属链不一致时，validate 初始返回 `valid: true`，load/save 也成功；green 后 parser 登记 section/block/run 归属并在完整遍历后核对四级链，三个公开 seam 均稳定返回或抛出 `JWORD_NATIVE_DOCUMENT_INVALID`。
- 独立复审 range ID 红灯：两个 comment 的 range snapshot 使用同一 ID 时初始被接受；green 后 comment range 与 revision range 分别在各自类型域内登记唯一 ID。现有 rich canonical 模型允许 comment 与 revision 共享同一个 range snapshot，因此不跨两个类型域错误收紧，save/load/save roundtrip 继续通过。
- 独立复审 MIME 红灯：仅含空白的 resource MIME 初始可保存，但生成物无法由同版本 reader 重开；green 后 current document parser 与 manifest parser 都按 trim 后非空拒绝，save 在资源收集和 ZIP 创建前以 `JWORD_NATIVE_DOCUMENT_INVALID` 失败，合法资源 roundtrip 保持通过。
- Standards 收口：保存侧 document schema 回归拆入 `document-schema-security.test.ts`；B3 关单时 `public-api-security.test.ts` 为 991 行，后续又拆出 ZIP preflight 回归并复用公开 seam helper，最终残留收口后为 908 行；`document-schema-security.test.ts` 当前为 323 行，均低于仓库约 1,000 行上限。

### B3 验证结果

- `pnpm exec vitest run packages/native/test/public-api-security.test.ts packages/native/test/document-schema-security.test.ts --reporter=dot`：73/73 通过（B3 关单时历史快照；后续 B4/B5 回归数量见最终统一收口证据）。
- `pnpm --filter @4xian/jword-native test`：106/106 通过。
- `pnpm --filter @4xian/jword-native typecheck`：通过。
- `pnpm --filter @4xian/jword-native build`：通过。
- `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts --reporter=verbose`：11/11 通过。
- `node tools/size/check-native-bundle.mjs`：fresh vanilla build、`jszip`/`@zip.js/zip.js` 独立 module evidence、首屏零命中与 Native lazy chunk 命中均通过。
- `node tools/release/check-native-pack.mjs`：通过；tarball file list 不含 `src/`、`test/` 或安全测试 helper。
- B3 相关文件 focused ESLint：通过。
- `git diff --check`：通过。
- B3 实施未改变 `.jword` formatVersion/schemaVersion、core `Document` 公开类型或公开预算配置，未命中 Phase 2A 第 12 节强停止条件。
- B3 唯一独立 reviewer 复核原 4 项 finding 后确认全部闭环；独立最小验证 23/23 与 `git diff --check` 通过，Standards 与 Spec 两轴均无有效阻断 finding，B3 正式关闭。

## 2A-B4：AbortSignal 语义收口

### focused 红绿与停止证据

- 返回前红灯：load/validate 在共享 reader 的最后 progress 回调内收到 abort 后仍分别返回 document 和 `valid: true`；Worker 抑制了 postMessage success，但 dispatch 仍返回 `load-result`。green 后共享 reader 与公开入口均在最终 progress 后检查 signal，direct API 以 `JWORD_NATIVE_USER_CANCELLED` 拒绝，Worker 返回取消错误且不发送 stale `load-result` 或部分 document。
- 输入规范化：Blob `arrayBuffer()` 执行期间触发 abort 时，公开 load 在 materialize 后、raw preflight 前以 `JWORD_NATIVE_USER_CANCELLED` 拒绝；公开 progress 中没有任何正数输出。
- 分阶段 cooperative abort：输入规范化、raw preflight、`ZipReader.getEntries()`、overlap-only 检查、每个 entry、checksum entry 读取、SHA-256 前后、migration、current parser、integrity 和最终返回前均有 signal 检查。同步 preflight/JSON/schema/hash 只在步骤前后观察取消，不宣称指令级即时中断。
- 0-write 依赖拒绝：独立 load/validate fixture 在 bounded reader 注册首次 abort listener 时同步取消，触达真实 zip.js entry 读取但在 writer 首次调用前拒绝；真实 `WritableStream` sink invocationCount、accepted chunk count 与累计 output bytes 均为 0，取消保持为 `JWORD_NATIVE_USER_CANCELLED`，不会被依赖异常收口为 package invalid。
- 确定性 mid-stream：公开 load/validate 使用含约 2 MiB 高熵开放属性的预算内有效 document；bounded writer 接受累计超过 512 KiB 的正数 chunk 后，测试在该次 `onProgress` 内同步 abort。abort 快照的真实 sink invocationCount、accepted chunk count 与 output bytes 均已记录且为正，两条 direct seam 均在 5 秒上限内拒绝。
- 停止观察：Promise 拒绝后继续观察 100 ms，真实 sink invocationCount、accepted chunk count 与累计 output bytes 均不再增长；未命中“abort 后 writer 继续调用、输出继续增长、持续接受正数 chunk 或超过 5 秒才拒绝”的强停止条件。

### B4 验证结果

- `pnpm exec vitest run packages/native/test/abort-signal-security.test.ts --reporter=verbose`：8/8 通过（B4 关单时历史快照；后续增加保存最终 progress 取消回归后为 9/9）。
- `pnpm --filter @4xian/jword-native test`：112/112 通过。
- `pnpm --filter @4xian/jword-native typecheck`：通过。
- `pnpm --filter @4xian/jword-native build`：通过。
- `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts --reporter=verbose`：11/11 通过。
- `node tools/size/check-native-bundle.mjs`：fresh vanilla build、ZIP 依赖 lazy-only 与首屏零命中通过。
- `node tools/release/check-native-pack.mjs`：通过；tarball 不包含新增测试文件或安全 fixture helper。
- B4 相关文件 focused ESLint：通过。
- `git diff --check`：通过。

## 2A-B5：diagnostic 与跨层契约同步

### focused 红绿与契约证据

- schema path 红灯：结构错误原先只能返回稳定 code，无法向宿主定位已知结构位置；green 后 `validateJWordPackage()` diagnostic、`loadJWordDocument()` error 和 Worker error shape 均保留同一个 parser 生成的安全 JSON Pointer，例如 `/sections/0/blocks`。未知 key、输入值、资源 ID 和依赖异常不进入 path。
- Worker message 红灯：序列化 error 原先会携带本地化文本；green 后已知错误的 `message` 固定为稳定 `code`，unknown error 固定为 `JWORD_NATIVE_WORKER_ERROR`，取消错误固定为 `JWORD_NATIVE_WORKER_CANCELLED`，path 继续透传。
- runtime DTO 红灯：缺失 manifest、旧 schema warning、unsupported manifest 和 AbortSignal error 原先仍可携带本地化文本；green 后 `createDiagnostic()`、`createWarning()`、`createPackageError()` 以及 `validation.ts` 的公开旁路统一固定 `message === code`，public validate/load 和 Worker `validate-result` 均只透传稳定 code。
- 资源预算诊断：`JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` 已登记到统一 registry，并由生成器同步 SDK 码表与 core summary；当前 registry/generated artifacts 为 191 个 code。
- i18n 边界：runtime、Worker、协议和日志只承载稳定 code 与必要结构化字段；用户可见的 `zh-CN` / `en-US` 文案由 UI、wrapper 或宿主展示层按 code 映射。

### B5 验证结果

- `pnpm exec vitest run packages/native/test/document-schema-security.test.ts packages/native/test/worker.test.ts --reporter=verbose`：2 files、19/19 通过。
- runtime message 稳定性红绿：`pnpm exec vitest run packages/native/test/public-api.test.ts packages/native/test/worker.test.ts --reporter=verbose` 初始以 3 个失败用例复现缺失 manifest、旧 schema warning 和 Worker `validate-result` 的中文 message；旁路扫描后，public API focused 再以 1 个失败用例复现 unsupported manifest 的动态 message。最小修复后 public API + Worker 为 2 files、18/18 通过。
- `pnpm --filter @4xian/jword-native test --reporter=verbose`：6 files、118/118 通过。
- `pnpm --filter @4xian/jword-native typecheck`、`pnpm --filter @4xian/jword-native build`：通过。
- `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts --reporter=verbose`：3 files、11/11 通过。
- `pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts --reporter=verbose`：1 file、4/4 通过；`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check`：通过。
- `node tools/size/check-native-bundle.mjs`：fresh build 通过；`jszip` 1 个 module、`@zip.js/zip.js` 33 个 module 均只进入 Native lazy Worker chunk，首屏无命中。
- `node tools/release/check-native-pack.mjs`：通过；正式 tarball 不含 `src/`、`test/` 或新增安全 fixture helper。
- `pnpm test:types`、`pnpm typecheck`、`pnpm build`、`pnpm lint`：通过。根 typecheck/lint 的收口修正仅为测试类型收窄和构建期注释语言修正，不改变生产运行时语义。

## Phase 2A 最终统一收口证据

### 基线、环境与工作区

- 证据日期：2026-07-18；commit：`a94c6761bfc1b0b57f33074954b7e845edc862e6`；分支：`feature/review_questions`，相对 `origin/feature/review_questions` ahead 4。
- 工作区：`dirty=true`；首次收口时 `git status --short` SHA-256 为 `63712ed94088d4a3a665346d792ea55f713cf690e31a55e4d7526dd5cfad4b4d`。工作区同时保留既有 staged、unstaged 和 untracked 改动；本轮没有执行 `git add`、commit、amend、push、PR、publish。
- 工具环境：Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`。
- `pnpm-lock.yaml` SHA-256：`983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`；Native importer 与本轮 unstaged lockfile 增量只增加精确 `@zip.js/zip.js@2.8.31` importer、package 和 snapshot。
- 此处记录的是 dirty workspace 上的内部 Phase 2A 候选证据，不是 clean-SHA、已提交、已发布或可追溯生产发布证明；正式发布仍需在不可变 clean SHA 上重新生成并绑定 artifact hash。

### 实际修改范围

- 生产 Native 读取链：增加 raw ZIP32 preflight、zip.js bounded reader、严格 JSON、固定读取预算、版本化 document parser 和安全 entry path；只改 Native package 内既有 public seam 及其内部 helper，保存侧继续使用 JSZip。
- 公开契约与跨层同步：只增加固定预算 diagnostic、安全可选 `path`、`message === code` 和 Worker 透传；同步 registry/generated SDK 文档、Native README 和 current-full-review 状态，不改变 `.jword` `formatVersion`、`schemaVersion` 或 core `Document` 公开类型，也不增加可放宽预算的公开配置。
- 最小回归与 gate：新增公开 validate/load/save/Worker seam 的安全测试、预算算术测试和测试 fixture helper，并更新 Native bundle evidence runner；未提交大型二进制 fixture，pack 检查确认测试与源码不进入 tarball。
- 仓库内同时存在 Phase 2A 以外的 License、Collab、DOCX/PDF、benchmark 和文档改动；它们保持原状态，不属于本证据的关闭范围，也未被本轮回退或重写。

### 最终命令矩阵

| 命令 | exit code | 结果 |
| --- | ---: | --- |
| `pnpm exec vitest run packages/native/test/public-api-security.test.ts` | 0 | 1 file、53/53 |
| `pnpm exec vitest run packages/native/test/zip-preflight-security.test.ts --reporter=verbose` | 0 | 1 file、19/19；其中 ZIP64 独立矩阵 13/13 |
| `pnpm exec vitest run packages/native/test/zip-preflight-security.test.ts packages/native/test/document-schema-security.test.ts packages/native/test/public-api.test.ts packages/native/test/abort-signal-security.test.ts packages/native/test/public-api-security.test.ts packages/native/test/package-read-budget.test.ts --reporter=verbose` | 0 | 6 files、127/127 |
| `pnpm --filter @4xian/jword-native test --reporter=verbose` | 0 | 7 files、133/133 |
| `pnpm --filter @4xian/jword-native typecheck` | 0 | 通过 |
| `pnpm --filter @4xian/jword-native build` | 0 | 通过 |
| `pnpm exec vitest run packages/native/test/document-schema-security.test.ts packages/native/test/worker.test.ts --reporter=verbose` | 0 | 2 files、20/20 |
| `pnpm exec vitest run packages/native/test/public-api.test.ts packages/native/test/worker.test.ts --reporter=verbose` | 0 | 2 files、20/20 |
| `pnpm exec vitest run packages/native/test/abort-signal-security.test.ts --reporter=verbose` | 0 | 1 file、9/9 |
| `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts --reporter=verbose` | 0 | 3 files、11/11 |
| `pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts --reporter=verbose` | 0 | 1 file、4/4；registry/generated artifacts 为 191 个 code |
| `pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-sdk-docs.test.ts --reporter=verbose` | 0 | 3 files、8/8 |
| `node tools/diagnostics/generate-diagnostics-artifacts.mjs` | 0 | 同步 191 个 code |
| `node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` | 0 | 生成物无漂移 |
| `node tools/size/check-native-bundle.mjs` | 0 | fresh build；`jszip` 1 个 module、`@zip.js/zip.js` 33 个 module 均只进入 Native lazy Worker chunk；首屏零命中 |
| `node tools/release/check-native-pack.mjs` | 0 | 25 files；无 `src/`、`test/`、`tests/` |
| `pnpm build` | 0 | 通过 |
| `pnpm test:types` | 0 | 通过 |
| `pnpm typecheck` | 0 | 通过 |
| `pnpm lint` | 0 | 通过 |
| `pnpm --filter @4xian/jword-persistence typecheck` | 0 | 通过 |
| `pnpm --filter @4xian/jword-persistence test` | 0 | 17/17 |
| `git diff --check` | 0 | tracked diff 无空白错误 |

### 产物与审查闭环

- fresh bundle evidence：`native-module-evidence.json` SHA-256 `c3492361e25b4783c0cf4b7d7f341c8d503164af9a082c6d27a59f6afca7b928`；`native-worker-module-evidence.json` SHA-256 `15b983aaaaf6ae61805ebf235b3faa1a6289b69b73caa337779bfa950dc3df37`；`assets/native-worker-ByoEHjR7.js` SHA-256 `e48a3fb572e287b0fdb5c885efb0b07d2dae82c10f5c04ef8c103c7ccc8b95a6`。
- 本地未发布候选 tarball：`/tmp/4xian-jword-native-0.0.0.tgz`，SHA-256 `84f70929bc37801c5913bcf13bd4144f80434f4d2120d9e6a4a737bc1aff441f`；只用于本轮内部验证，不是发布物。
- B1 独立 reviewer：原 findings 2-7 均修复并验证，最终无有效阻断 finding。
- B2 独立 reviewer：唯一的 terminal diagnostic 顺序 finding 已在公开 validate/load seam 闭环，最终 Standards/Spec 均无 finding。
- B3 独立 reviewer：anchor 归属链、range ID 与 MIME 等 4 项 finding 全部修复，最终无有效阻断 finding。
- B5 与 Phase 2A 端到端终审：Native runtime/Worker 的稳定 message、安全 path、191-code registry、focused/全量 gate 均复核通过，Standards/Spec 两轴无有效 finding。
- 后续复核重新打开 Phase 2A：严格 JSON 可通过 `1e999` 产生 `Infinity`、非法 data URL 泄漏平台异常、保存最终 progress 回调内取消仍返回成功；另有 ZIP64 回归矩阵、逐方法中文注释和 11/12 状态同步问题。以下旧终审结论保留为历史证据，不再作为当前 Closed 依据。

### 后续复核修复与重新关单

- 有限数字：`strict-json.ts` 在 number grammar 扫描后拒绝转换结果非有限的 token；保存侧 `stringifyJson()` 在 `JSON.stringify` 静默转 `null` 前拒绝非有限 number。公开 validate/load 拒绝 `1e999`，save 拒绝开放属性中的 `Infinity`，统一返回 `JWORD_NATIVE_DOCUMENT_INVALID` 且 `message === code`。
- data URL：percent decode 与 base64 decode 的平台异常统一映射为 `JWORD_NATIVE_DOCUMENT_INVALID`；公开 save 回归覆盖 malformed percent encoding 与 base64，稳定保留 requestId 和 `entry: document.json`。
- 保存取消：最终 save progress 回调之后、返回 bytes 之前再次检查 signal；最终回调内同步 abort 以 `JWORD_NATIVE_USER_CANCELLED` 拒绝，不再返回 package bytes。
- ZIP64：新建 `zip-preflight-security.test.ts`，通过 validate/load 双 seam 分别覆盖 ZIP64 EOCD、locator、3 个 archive sentinel、central entry 的 2 个 size/offset/disk/extra，以及 local entry 的 2 个 size/extra，共 13 个 ZIP64 case。
- Standards：生产与测试新增对象方法均有逐方法中文 JSDoc；ZIP preflight 用例从原 991 行测试拆出，简单 validate/load 断言统一复用共享 helper，最终残留收口后 `public-api-security.test.ts` 为 908 行。
- 双轴复审：Standards reviewer 的 Duplicated Code finding 与 Spec reviewer 的 `1e999` 基线表述 finding 均在原 reviewer 复核后确认闭环；两轴最终无剩余 finding，Phase 2A 重新 `Closed`。

### 非绿边界与剩余风险

- 草案 Playwright 命令 exit 1：6 tests 中 3 passed / 3 failed。Chromium、Firefox、WebKit 的 Native save/reopen 各通过；三个图片资源用例均在 `examples/vanilla/tests/gate4_5-native.e2e.ts:91` 等待既有 `[data-jword-media-trigger="true"]` 可见性时 30 秒超时，尚未进入 Native seam。该结果是独立 UI 回归风险，不被描述为 Playwright 全绿、Native B5 失败或最低版本证据。
- `pnpm --filter @4xian/jword-core test` exit 1：实际执行的 72 files、365 tests 全部通过，但 `test/editor/facade-runtime.test.ts`、`test/editor/input-runtime.test.ts`、`test/layout/runtime.test.ts` 三个历史 `export {}` 占位入口被 Vitest 以 `No test suite found` 判为 suite 失败。单文件最小复现稳定；排除三个占位文件后为 72 files、365/365、exit 0。Phase 2A 未修改这些文件，因此记录为既有 Core 测试装配债务，不越界修改。
- `currentVersionsOnly: true`；`minimumVersionsVerified: false`；Chrome 100、Edge 100、Firefox 128、Safari 16.4 保持 `Deferred/not-run`。静态兼容审计通过不等于最低版本真实运行通过。
- 当前未命中草案第 12 节强停止条件；本轮复核 finding 已在批准边界内修复并通过双轴复审，Phase 2A 重新 `Closed`，本轮明确不进入 Phase 2B。

## Phase 2A 复核关闭边界

- B1-B5、三个 P1 行为阻断项和 P2 证据/规范问题均已完成修复、focused/package/架构验证与双轴复审；Phase 2A 已重新 `Closed`。本轮在阶段边界停止，不进入 Phase 2B。
- 当前 Playwright 三浏览器回归实际为 6 tests、3 passed / 3 failed：Chromium、Firefox、WebKit 的基础 Native save/reopen 各通过 1/1；三个“上传文件图片资源”用例均在既有 `[data-jword-media-trigger="true"]` 不可见处 30 秒超时，未进入 B5 Native seam。该现有 UI 失败保持单独记录，不被描述为 Native B5 通过或最低版本证据。
- `currentVersionsOnly: true`；`minimumVersionsVerified: false`；Chrome 100、Edge 100、Firefox 128、Safari 16.4 仍为 `Deferred/not-run`。当前 Playwright 版本既不能替代最低版本实测，也不能覆盖上述 UI 失败。

## Phase 2A 最终残留收口（2026-07-18）

### 新增红绿与取消证据

- 攻击者 `resourceId`：使用 `../../attacker/entry` 的同一动态 package，通过 `validateJWordPackage()` 与 `loadJWordDocument()` 两条公开 seam 分别建立红灯。修复前 targeted run 为 2 failed，两个失败均显示 `entry` 泄漏该攻击者文本；`message` 仍固定为 `JWORD_NATIVE_RESOURCE_REFERENCE_MISSING`。`validation.ts` 最小修复只把该 diagnostic 的 `entry` 固定为 `document.json`，未修改公开类型或 diagnostic code；同一 targeted run 修复后为 2/2 通过。
- entry 间取消：load/validate 成对使用公开 API，在首个 `manifest.json` entry 的字节全部输出后同步 abort；两条 seam 均以 `JWORD_NATIVE_USER_CANCELLED` 拒绝，writer invocation 固定为 1，继续观察 100 ms 后无后续 entry 输出。
- Worker 中途取消：通过公开 Worker request/cancel contract 在约 2 MiB document entry 已读取超过 512 KiB、尚未读完时派发 cancel；当前读取拒绝，事件流不含任意 `result` 字段、stale `load-result` 或部分 document，拒绝后继续观察 100 ms 无新增事件或 writer 调用。
- Standards：`abort-signal-security.test.ts` 的 `onProgress` 箭头函数、接口函数属性、snapshot/计数函数、`addEventListener` 包装、Promise/定时器和测试回调均有逐方法中文注释；未重构测试结构，三个复审文件分别为 229、908、490 行。

### 最终指定命令证据

| 命令 | exit code | 结果 |
| --- | ---: | --- |
| `pnpm exec vitest run packages/native/test/public-api-security.test.ts packages/native/test/abort-signal-security.test.ts` | 0 | 2 files、66/66 |
| `pnpm --filter @4xian/jword-native test` | 0 | 7 files、137/137 |
| `pnpm --filter @4xian/jword-native typecheck` | 0 | 通过 |
| `pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate45-native-bundle.test.ts` | 0 | 3 files、11/11 |
| `pnpm test:types` | 0 | 通过 |
| `pnpm typecheck` | 0 | 通过 |
| `pnpm lint` | 0 | ESLint、package versions、boundary 与中文注释检查均通过 |
| `git diff --check` | 0 | tracked diff 无空白错误 |
| `git diff --cached --check` | 0 | staged diff 无空白错误 |

### 最终双轴复审与状态

- Standards：无 finding；中文注释、约 1,000 行文件预算、最小改动、公开测试边界和 Fowler smell baseline 均通过。
- Spec：无 finding；攻击者 `resourceId` 双 seam、load/validate entry 间取消和 Worker 中途取消均符合要求，未新增生产 test hook、公开类型或 diagnostic code。
- `SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10` 与 Phase 2A 保持 `Closed`；本轮不进入 Phase 2B，不删除 11 号实施基线。上述结果不构成最低浏览器版本验证，`minimumVersionsVerified` 继续为 `false`。

## 浏览器证据边界

- `currentVersionsOnly: true`
- `minimumVersionsVerified: false`
- Chrome 100、Edge 100、Firefox 128、Safari 16.4：`Deferred/not-run`

最新版 Playwright 三浏览器回归的当前结果见上方“Phase 2A 复核关闭边界”；即使基础用例通过，也只记录当前版本回归，不替代上述最低版本真实运行证据。
