# 当前验证计划

## 1. 当前基础门禁

已确认可用的基础反馈环：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `packages/core/dist/index.js` Node ESM import

这些结果只代表基础工程门禁，不代表 License、文件安全、格式、协作或发布问题已关闭。

## 2. 阶段证据要求

每阶段记录：

- 当前 commit SHA 和 dirty flag。
- Node、pnpm、OS 和 lockfile hash。
- 复现命令、修复后同一命令和扩大验证命令。
- 命令 exit code、测试数量和关键 artifact。
- 未执行项和剩余风险。
- 发布阶段的 tarball/artifact hash。

没有上述证据时，问题保持 `Open` 或 `In Progress`。

## 3. 阶段 1：License

```bash
pnpm --filter @4xian/jword-license typecheck
pnpm --filter @4xian/jword-license test
pnpm test:types
pnpm typecheck
pnpm build
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate6-commercial-pack.mjs
: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"
node tools/release/check-license-runtime-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
```

上述 Phase 3 License 命令仅校验显式 inventory/binding 并报告 `legacy-non-gating` 委托状态；它本身不执行 Node、浏览器或 Worker runtime 语义。当前 runtime 证据由 Phase 3 consumer matrix 在最终 run-a 上生成，历史 `LIC-107B2` 最低版本证据继续按本节对应记录解释，不得由该兼容入口替代。

必须额外证明：

- 公开测试私钥签发的 token 被生产入口拒绝。
- trust store 只包含批准的 `jword-prod-2026-k1` 生产公钥；缺少该输入时阶段不得关闭。
- 调用方无法注入公钥/verifier。
- tarball 不含私钥、测试 signer 或测试 trust store。
- 标准 Ed25519 向量通过。
- 当前浏览器自动化与最低版本证据分开记录；最新版 Playwright 结果不得关闭最低版本验证项。

### 3.1 LIC-103 当前证据（2026-07-15）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0`，`pnpm-lock.yaml` SHA-256 为 `c69af496bcae503186cf6acadc786af2ab92d6da32ee24ace3d5f652fe24be9a`。
- `pnpm exec vitest run packages/license/test/jwl2.test.ts`：14/14 通过。
- `pnpm exec vitest run packages/license/test/entitlement.test.ts`：8/8 通过。
- `pnpm --filter @4xian/jword-license typecheck`：通过。
- `pnpm --filter @4xian/jword-license test`：2 files、22/22 通过。
- `pnpm test:types`：通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：tracked diff 通过；对当前未跟踪新增文件逐一执行 `git diff --no-index --check /dev/null <file>`，空白格式检查通过。
- 扩大测试的预期失败：DOCX 为 21 passed / 52 failed，首个代表性错误是 `JWORD_LICENSE_SIGNATURE_INVALID: docx.export`；PDF 为 9 passed / 36 failed，首个代表性错误是 `JWORD_LICENSE_SIGNATURE_INVALID: pdf.export`；Collab 为 17 passed / 10 failed，首个代表性错误是原期望的旧 Collab 过期 alias、实际先得到 `JWORD_LICENSE_SIGNATURE_INVALID`。这些 fixture 依赖已删除的 JWL1 测试信任路径，归后续调用方迁移与 LIC-110 test-only trust replacement，不得通过恢复测试公钥修复。
- 边界：`LIC-103` 已完成固定 trust lookup、Ed25519 验签和调用方换根删除；尚未进入 `LIC-104`，未实现 WeakMap handle、时间关系、运行时 feature 检查或激活入口。本批次未执行 build、pack、tarball 或 publish 验证。

### 3.2 LIC-104 当前证据（2026-07-15）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0`，`pnpm-lock.yaml` SHA-256 为 `c69af496bcae503186cf6acadc786af2ab92d6da32ee24ace3d5f652fe24be9a`。
- 修改前基线：Gate 5 为 6/6、License 为 22/22，License typecheck 与 `pnpm test:types` 均通过。
- `pnpm exec vitest run packages/license/test/jwl2.test.ts`：19/19 通过，覆盖 production golden token 激活、冻结最小 handle、module feature、伪造/复制/structured clone/parser/claims 拒绝、未来签发时间、激活时到期、运行中到期和时间关系。
- `pnpm --filter @4xian/jword-license test`：2 files、27/27 通过。
- `pnpm --filter @4xian/jword-license typecheck`：通过。
- `pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts`：6/6 通过。
- `fixtures/collab/diagnostics-registry.json` 已登记 `JWORD_LICENSE_HANDLE_INVALID` 与 `JWORD_LICENSE_NOT_YET_VALID`；`node tools/diagnostics/generate-diagnostics-artifacts.mjs` 成功，生成的 SDK diagnostic 码表与 registry summary 已同步至 192 个 code。
- `pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts`：4/4 通过。
- `pnpm test:types`、`pnpm typecheck`、`pnpm lint`、`git diff --check`：全部通过。
- 边界：`LIC-104` 已完成公开激活、模块私有 WeakMap identity、时间关系、运行时 feature 检查和新增 diagnostic 统一登记；尚未进入 `LIC-105`，未实现 worker transfer。LIC-106 至 LIC-111、DOCX/PDF/Professional Editing/Collaboration 迁移和 JWL1 删除仍未实施；本批次按明确禁令未执行 build、pack、publish、commit 或 push，当前 `packages/license/dist` 未重新构建且不作为 LIC-104 完成证据。

### 3.3 LIC-105 当前证据（2026-07-15）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0`，`pnpm-lock.yaml` SHA-256 为 `c69af496bcae503186cf6acadc786af2ab92d6da32ee24ace3d5f652fe24be9a`。
- 修改前基线：`pnpm exec vitest run packages/license/test/jwl2.test.ts` 为 19/19，`pnpm --filter @4xian/jword-license test` 为 2 files、27/27，License typecheck 通过。
- TDD 红灯：首个 transfer 成功路径新增后为 19 passed / 1 failed，失败是 `createJWordLicenseTransfer is not a function`；公开 API catalog 门禁在文档登记前为 4 passed / 2 failed，缺少 `createJWordLicenseTransfer` 与 `JWordLicenseTransfer`。
- `pnpm exec vitest run packages/license/test/jwl2.test.ts`：22/22 通过，新增 3 个最小测试，覆盖可信 handle 创建单字段 cloneable transfer、worker 重新激活为不同对象的新 handle、伪造/复制/cloned handle 拒绝、handle/错误不泄漏 token，以及篡改/格式错误/过期 token 在重新激活时稳定失败。
- `pnpm --filter @4xian/jword-license test`：2 files、30/30 通过。
- `pnpm --filter @4xian/jword-license typecheck`：通过。
- `pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-api-export-audit.test.ts`：3 files、16/16 通过，其中 Gate 5 为 6/6、public API catalog 为 6/6、API export audit 为 4/4。
- 额外 `pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts`：3/3 通过，LIC-104/105 公开 License 类型均有 symbol-level 文档注释。
- `pnpm test:types`、`pnpm typecheck`、`pnpm lint`、`git diff --check`：全部通过。
- 边界：`LIC-105` 已完成 identity-checked worker transfer；opaque handle 的 JSON、复制和 structured clone 不含 token，`JWordLicenseTransfer` 是 structured clone 明确携带 token 的唯一例外，接收侧仍完整复用固定 trust lookup、Ed25519 验签、claims 和时间校验。DOCX/PDF/Collaboration worker 尚未迁移；LIC-106 至 LIC-111、JWL1 删除和商业调用方迁移仍未实施；未新增 diagnostic 或 i18n 文案。本批次未执行 build、pack、publish、commit 或 push，当前 `packages/license/dist` 未重新构建且不作为 LIC-105 完成证据。

### 3.4 LIC-106 当前证据（2026-07-15）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、macOS `26.5.1`，`pnpm-lock.yaml` SHA-256 为 `c69af496bcae503186cf6acadc786af2ab92d6da32ee24ace3d5f652fe24be9a`。
- TDD 红灯 1：先反转 Gate 5 正式 signer 断言，`pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts` 为 5 passed / 1 failed，失败命中 production src 中的 `createInsecureTestOnlyJWordLicenseSignature`。
- TDD 红灯 2：把 License 测试先指向尚不存在的内部 fixture support，`pnpm --filter @4xian/jword-license test` 为一个 suite 加载失败，另一文件 22/22 通过；失败是找不到 `fixtures/license/create-insecure-test-only-jwl1-token`。
- TDD 绿灯：新增唯一 Node test-only signer 后，迁移前固定输入与固定 JWL1 token 字节完全一致；最终 `pnpm --filter @4xian/jword-license test` 为 2 files、31/31 通过，LIC-100 至 LIC-105 的 production golden token、固定 trust lookup、激活、WeakMap handle 和 transfer 行为继续通过。
- Tarball 门禁红灯：新增实际 pack 文本扫描后，旧 dist 命中 `dist/crypto.d.ts` 的 production Ed25519 signer、`dist/index.d.ts` / `dist/index.js` / `dist/legacy-jwl1.d.ts` 的 test signer；重建 License dist 后同一 Gate 5 为 1 file、6/6 通过。
- 按指定顺序完成最终验证：`pnpm --filter @4xian/jword-license test` 为 2 files、31/31；License typecheck 通过；Gate 5 为 1 file、6/6；`pnpm test:types`、`pnpm typecheck`、`pnpm lint`、License build、`git diff --check` 均通过。
- `npm pack --dry-run --json --ignore-scripts ./packages/license`：20 entries，文件只包含 `README.md`、`package.json` 和 `dist/*`；export map 继续只有 `.`，未增加 testing 子路径。
- `node tools/release/check-gate5-commercial-pack.mjs`：`status=ok`；DOCX、License、PDF 三个 pack 报告的 `requiredFilesMissing`、`forbiddenFiles`、`sourceMapLeaks` 和 `forbiddenTextLeaks` 均为空。License 报告为 20 entries。
- 实际 tarball 额外扫描：在临时目录执行真实 `npm pack` 并解包，SHA-256 为 `e8823c99d3adeb8e32ea6742256d9c4830dc49eafaf8482da6b672a2a70ad247`；`packages/license/src`、`packages/license/dist` 和解包 tarball 对测试 signer 名、测试 seed 标识、仓库测试 seed 实值与 `signEd25519` 的命中均为 0，tarball fixture 文件数为 0。
- 消费者扫描：TypeScript AST 确认测试和示例从 `@4xian/jword-license` 导入测试 signer 的数量为 0；根 runtime signer export 为 `false`。TypeScript 测试统一从仓库 fixture support 签发；browser examples、benchmark、compat 与 release smoke 只使用固定 `INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN`，浏览器路径不引入 `node:crypto`。
- 仍存在的预期失败：Gate 5 third-party smoke 以 `JWORD_LICENSE_SIGNATURE_INVALID: docx.export` 退出 1；Gate 6 third-party smoke 因 connection 未达到 `synced` 退出 1；Gate 7 tarball 项目的 typecheck 与 Vite build 通过，但 Chromium 1/1 因 `JWORD_LICENSE_SIGNATURE_INVALID: pdf.export` 后页面停在 `booting` 而失败。这些失败受后续 DOCX/PDF/Collaboration JWL2 商业调用方迁移阻断，不得通过恢复测试 trust root、正式 signer 或 `allowInsecureFixtureLicense` 绕过。
- 边界：`LIC-106` 已完成，但 `SEC-01` 和 Phase 1 继续保持 Open；下一项是 `LIC-107`。本批次未改变 `verifyEd25519()`、固定生产 trust store、JWL2 激活、LIC-105 transfer 或 `allowInsecureFixtureLicense` 行为，未实施 LIC-107/108/110，也未提交、push、publish。

### 3.5 LIC-107A 当前证据（2026-07-16）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`，更新依赖后的 `pnpm-lock.yaml` SHA-256 为 `ee673240bd5ab7ecf55b761b7d3c4f5cb3e2cd728990bb02427189c9333cd441`。
- `packages/license/package.json` 使用精确 runtime dependency `@noble/curves: "2.2.0"`；实现固定从 `@noble/curves/ed25519.js` 导入，显式使用 `{ zip215: false }`，没有保留自研 SHA-512/Edwards fallback。
- `pnpm --filter @4xian/jword-license test`：2 files、32/32 通过；表驱动向量覆盖 RFC 8032 官方有效向量、message/signature/public key 篡改、错误长度，以及 strict 模式对 small-order/non-canonical 输入的拒绝。
- `verifyEd25519(message, signature, publicKey): boolean` 继续同步调用，64-byte signature 与 32-byte public key 预检和 catch/fail-closed 语义保持不变；公开 API、JWL2、trust store、diagnostic、handle 和 transfer 未改变。
- 正式源码、exports 和 License tarball 没有新增 JWord signer、私钥、测试 seed、testing export 或测试 trust root；`@noble/curves` 自身的通用签名能力未被 JWord 转导出或包装。
- 边界：`LIC-107A` 已完成，但本项目不宣称 `@noble/curves@2.2.0` 已经独立密码学审计；最低运行时兼容证据不由本子批次关闭。

### 3.6 LIC-107B1 当前证据（2026-07-16）

- `node tools/release/check-license-runtime-smoke.mjs`：exit 0；使用 Node `v24.14.0`、Playwright `1.59.1`、Chromium `147.0.7727.15`、Firefox `148.0.2` 和 WebKit `26.4`。
- smoke 打包 `@4xian/jword-license`，在临时空项目从本地 tarball 安装并仅通过包级公开入口消费；解析路径不指向 monorepo 或 workspace alias。
- 固定 `Date.now()` 为 `2026-01-15T00:00:00.000Z`，使用现有 production golden token；Node 中完成激活、`formats` 检查、transfer 创建和篡改 token 拒绝，不签发新 token。
- Vite target 为 ES2022；Chromium、Firefox、WebKit 3/3 通过。主线程激活后用 `postMessage()` 把 transfer 发送给真实 `type=module` Dedicated Worker，Worker 通过公开 `activateJWordLicense()` 重新激活并检查 `formats`；篡改 token 在主线程和 Worker 均被拒绝。
- 临时项目依赖树和 physical copy 扫描均只有一套 `@noble/curves@2.2.0` 与 `@noble/hashes@2.2.0`。main chunk 为 66,909 bytes、gzip 24,977 bytes；worker chunk 为 64,559 bytes、gzip 23,779 bytes，本阶段不建立未经批准的体积阈值。
- 输出明确记录 `currentVersionsOnly: true` 与 `minimumVersionsVerified: false`。因此 `LIC-107B1` 已完成，但不构成 Node 20.19.0 或最低浏览器版本证据。

### 3.7 LIC-107B2 最低版本证据与剩余计划（Conditionally Accepted；manual certification deferred）

必须在 BrowserStack、Sauce Labs 或对应真实机器/虚拟机中复用同一 License runtime smoke 语义，并逐项保存可复核证据：

| 运行时 | 最低版本 | 状态 | 必须证明 |
| --- | --- | --- | --- |
| Node | 20.19.0 | Passed | 从本地 tarball 安装、公开入口激活、`formats`、transfer 与篡改拒绝；解析路径无 workspace alias，noble 依赖版本唯一。 |
| Chrome | 100 | Deferred / not-run | Vite ES2022 真实 bundle 在主线程与 module Dedicated Worker 完成激活/transfer/篡改拒绝。 |
| Edge | 100 | Deferred / not-run | 与 Chrome 独立执行同一矩阵，不能用 Chromium 结果替代 Edge 产品版本。 |
| Firefox | 128 | Deferred / not-run | 执行同一矩阵；同时记录该版本已经 EOL，生产客户应使用 Mozilla 当前仍支持的 ESR。 |
| Safari | 16.4 | Deferred / not-run | 在对应 macOS/Safari 真实环境执行同一矩阵；不能用最新版 Playwright WebKit 代替版本证据。 |

Node 20.19.0 当前证据（2026-07-16）：

- `node tools/release/check-license-minimum-node.mjs`：exit 0；先 build License，再在只读挂载仓库的 `node:20.19.0-bookworm-slim` 容器中以 pnpm `9.14.2` 执行 `check-license-runtime-smoke.mjs --node-only`。
- 容器为 `linux/arm64`，镜像 digest 为 `node@sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac`；源码基线 `a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace。
- 自动生成 tarball 的运行结果为 `status=ok`、`nodeVersion=v20.19.0`、activation/formats/transfer/tampered rejection 全部通过，no-alias 解析位于容器临时空项目；`@noble/curves@2.2.0` 与 `@noble/hashes@2.2.0` 各一个物理副本。
- `--pack-path` 复用路径也已实测：候选 tarball SHA-256 `790632a19e607f67ea6531293038e0834419a53c2980ed2d4301bcb8bbed579f` 在 Node 20.19.0 通过；同一 tarball 的 `--prepare-browser` 已生成 Vite ES2022 main/worker bundle，但该准备结果不构成最低浏览器通过证据。
- 最终关单时必须对人工浏览器实际使用的候选 tarball 再运行 `check-license-minimum-node.mjs --pack-path ...`，确保 Node 与四个浏览器绑定同一 SHA-256。人工步骤见 [LIC-107B2 最低浏览器人工验证手册](../../license-minimum-browser-manual-verification.md)。

2026-07-17 经明确风险接受，当前 Node 20.19.0、最新版 Chromium/Firefox/WebKit、真实 module Dedicated Worker、tarball/no-alias 和篡改拒绝证据足以完成 License Phase 1 的内部实施退出。Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 的人工矩阵仍未执行，状态转为 `manual certification deferred`：不阻断后续内部阶段，但仍是对应最低版本对外兼容声明和商业 GA 前门禁，也不得描述为已经实测通过。

后续人工执行时，每个结果仍必须记录浏览器/Node 完整版本、操作系统/镜像、执行日期、License tarball SHA-256、测试入口版本和日志/artifact 位置。任一环境不可用时记录 `not-run`，失败时记录 `fail` 并修复或调整真实支持结论；不得用当前最新版浏览器结果替代最低产品版本证据。

### 3.8 LIC-108A signer 当前证据（2026-07-16）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`，`pnpm-lock.yaml` SHA-256 为 `ee673240bd5ab7ecf55b761b7d3c4f5cb3e2cd728990bb02427189c9333cd441`。未执行 `git add`、commit、push 或 publish，原有 staged/unstaged 内容保持原边界。
- 初始 TDD 红灯：修正测试文件自身语法后，`pnpm exec vitest run tools/license/issue-license.test.ts` 为 6 tests、4 failed / 2 passed；四种合法 class 均因旧 JWL1 signer 拒绝新的最小输入而失败。审查回归红灯为 9 tests、2 failed / 7 passed：重复顶层 JSON key 被 `JSON.parse()` 静默覆盖，仓库内路径没有在 PEM 解码前被拒绝。
- focused 绿灯：`pnpm exec vitest run tools/license packages/license/test/jwl2.test.ts` 为 3 files、34/34 通过，其中 signer CLI 为 9/9；除原有四种 class、期限、固定 issuer/keyId、严格输入和 fail-closed stdout 外，新增覆盖重复顶层 key、realpath 后仓库内私钥路径拒绝，以及固定 production payload JSON、payload segment、UTF-8 签名输入的 canonical golden vector；固定 production token 另由 runtime trust store 完成独立验签。固定向量不包含生产私钥或测试 seed。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`：全部 exit 0；build 完成全部 workspace Rollup 产物与相对 import 归一化。未跟踪的 `tools/license/issue-license.test.ts` 另以 `git diff --no-index --check` 检查，未发现空白错误。
- 生产 signer smoke：使用仓库外 `~/.config/jword/keys/jword-prod-2026-k1-private.pem` 签发未落盘的 production JWL2，构建后的 `packages/license/dist/index.js` 公开入口成功激活；`formats=true`，transfer 只有 `token` 字段，`subscriptionEndsAt=2027-07-16T00:00:00.000Z` 对应 `expiresAt=2027-07-31T00:00:00.000Z`。这证明外部私钥与当前固定 production trust store 匹配；命令和输出均未打印 token、PEM 或私钥内容。
- 首次尝试直接用 Node 导入 `packages/license/src/index.ts` 时因源码保留 `.js` ESM specifier 而得到 `ERR_MODULE_NOT_FOUND`；该路径不是发布消费入口。按正式流程先 build、再从 `dist` 公开入口复跑后通过，没有修改 parser、verifier 或 trust store。
- `npm pack --dry-run --json --ignore-scripts ./packages/license`：exit 0，12 entries，只包含 package README、package.json 和 `dist/*`；`node tools/release/check-gate5-commercial-pack.mjs` 为 `status=ok`，License export map 仍只有 `.`，`forbiddenFiles`、`sourceMapLeaks` 和 `forbiddenTextLeaks` 均为空。签发工具、私钥、测试 seed、fixture 和 signer 未进入 License tarball。
- `tools/license/README.md` 已记录严格 JWL2 输入、四种 class 期限、固定 issuer/keyId、realpath 后仓库外私钥文件边界、私钥禁入边界和最小外部签发台账字段；工具本身不建立客户台账，也不把 OEM、Named Product、tenant、用户或 usage 写入 token。
- 边界：本节只证明 `LIC-108A` signer；`LIC-108B` 证据见下一节。未修改 verifier、trust store、公开 License API、WeakMap handle、worker transfer、DOCX/PDF/Collaboration 或 JWL1 调用方。

### 3.9 LIC-108B 离线 verifier 当前证据（2026-07-16）

- 初始 TDD 红灯：`pnpm exec vitest run tools/license/verify-license.test.ts` 为 22/22 failed，原因是 CLI 尚不存在。初版实现后同一命令为 21/22 passed；唯一失败是超长 token 同时越过原始输入预算，测试错误地期待 runtime invalid，按已批准契约改为 CLI input invalid 后 22/22 通过。
- focused 绿灯：首次 `pnpm exec vitest run tools/license/verify-license.test.ts packages/license/test/jwl2.test.ts` 为 2 files、45/45 通过；复核后补齐超大 token 文件与缺省系统时间测试，CLI focused 为 24/24，最终联合回归为 2 files、47/47。覆盖 production golden token 的历史时间成功、缺省系统时间过期、未来/过期、payload/signature/issuer/keyId/duplicate key/base64url/UTF-8、stdin/file、两种输入预算、未知/禁止参数和无敏感输出。
- `pnpm --filter @4xian/jword-license build`、包级 typecheck、根 `pnpm typecheck`、`pnpm lint` 均 exit 0。CLI 从构建后的 `packages/license/dist/index.js` 根入口调用公开 `activateJWordLicense()` 与 `JWordLicenseError`；尝试使用裸包名时因根 workspace 没有 Node 解析链接而得到 `ERR_MODULE_NOT_FOUND`，未为此增加 root dependency 或 workspace alias。
- `node tools/release/check-gate5-commercial-pack.mjs` 为 `status=ok`；License export map 仍只有 `.`，20 个 tarball entry 的 forbidden files/text/source maps 均为空。独立 `npm pack --dry-run --json --ignore-scripts ./packages/license` exit 0，包体 15,607 bytes、unpacked 59,106 bytes，未包含 verifier CLI、signer、私钥、测试 seed、fixture 或 test trust replacement。
- CLI 不访问网络、不读取私钥环境变量；成功只输出固定裁剪 JSON，失败只输出稳定 code。`--at` 只用于测试、历史审计和故障重放，不能抵抗宿主时间回拨，也不产生业务 runtime handle。
- 复核收口：文件输入改为单次 `openSync()` 后在同一 descriptor 上执行 `fstatSync()` 与有界分块读取，并在 `finally` 中关闭；即使检查后文件增长，也只读取到预算加 1 byte 后拒绝，不再存在 `statSync()` 后无上限 `readFileSync()` 的 TOCTOU 预算缺口。正式 package README 已同步 LIC-108B 完成状态。
- 边界：本节记录 `LIC-108B` 完成时的状态；当时 `LIC-107B2`、整体 `LIC-107` 和 Phase 1 仍 Pending，收费 PoC 与商业 GA 均未完成，也尚未进入 LIC-109、LIC-110、LIC-111 或 Phase 2。

### 3.10 LIC-109A JWL2 核心稳定诊断当前证据（2026-07-16）

- 基线：`a94c6761bfc1b0b57f33074954b7e845edc862e6`，dirty workspace；Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`，`pnpm-lock.yaml` SHA-256 为 `ee673240bd5ab7ecf55b761b7d3c4f5cb3e2cd728990bb02427189c9333cd441`。未执行 `git add`、commit、push、publish，也未覆盖既有 staged、unstaged 或 untracked 内容。
- 公开 seam 红灯：先从 `activateJWordLicense()` 增加最少分类回归，`pnpm exec vitest run packages/license/test/jwl2.test.ts --reporter=verbose` 为 21 passed / 2 failed；失败准确暴露 malformed token 仍抛通用错误，以及非法期限关系仍映射 `JWORD_LICENSE_SIGNATURE_INVALID`。
- focused 绿灯：同一 JWL2 命令最终 23/23 通过；联合 `packages/license/test/jwl2.test.ts` 与 `packages/license/test/entitlement.test.ts` 为 32/32 通过。公开激活现稳定区分 `JWORD_LICENSE_TOKEN_INVALID`、`JWORD_LICENSE_ISSUER_INVALID`、`JWORD_LICENSE_KEY_UNKNOWN`、`JWORD_LICENSE_SIGNATURE_INVALID`、`JWORD_LICENSE_NOT_YET_VALID` 与 `JWORD_LICENSE_EXPIRED`，并覆盖 malformed token、未知 issuer/key、payload/signature 篡改、Evaluation/订阅期限关系和 worker transfer 重新激活。
- LIC-108B CLI 回归：`pnpm exec vitest run tools/license/verify-license.test.ts --reporter=verbose` 为 24/24 通过；新增 runtime token/issuer/key code 在 CLI 中继续统一输出冻结的 `JWORD_LICENSE_SIGNATURE_INVALID`，未来生效、过期和 CLI 使用错误契约未改变，也未泄漏 token、signature 或密钥材料。
- package 与架构门禁：`pnpm --filter @4xian/jword-license test` 为 2 files、32/32；License package typecheck、`pnpm test:types`、根 `pnpm typecheck` 和 `pnpm lint` 均 exit 0。`node tools/diagnostics/generate-diagnostics-artifacts.mjs` 成功，把 registry、SDK 码表和 core summary 从 192 同步到 195 codes；Gate 7 diagnostics registry 为 4/4 通过。
- 兼容边界：Collab contract focused 为 9 passed / 1 failed；唯一失败是已记录的旧 JWL1 fixture 在固定生产 trust store 下先返回旧路径的签名无效 code，而旧测试仍期待已删除的 Collab License alias。本批次没有恢复测试 trust root、signer、调用方公钥注入或 `allowInsecureFixtureLicense` 来绕过该预期失败。
- 范围：`LIC-109A` 已完成；整体 `LIC-109` 当时仍保持 Pending。本段记录 A 结束时边界；B1-B4 的证据见下一节。当时 `LIC-107B2` 与整体 `LIC-107` 仍 Pending，尚未进入 LIC-110、LIC-111 或调用方授权迁移。

### 3.11 LIC-109B1-B4 稳定诊断收尾证据（2026-07-16）

- B1 核心遗留诊断：`pnpm --filter @4xian/jword-license test` 为 2 files、35/35；旧 server 状态输入继续 fail closed，offline grace 不再授权且兼容结果固定为 `false`，warning 只保留 code，License error 删除 `customerId`。
- B2 worker DTO：DOCX/PDF worker 序列化 focused 为 2/2；DOCX/PDF/License/Collab/Collab Server 包级 typecheck、`pnpm test:types` 和根 `pnpm typecheck` 均 exit 0。根类型测试还覆盖了运行时带旧 `customerId` 字段的输入不会穿透 DTO。
- B3 Collaboration alias：Collab contract 与 Collab Server focused 为 2 files、30/30；公开 client 缺失授权用例为 1/1；Gate 6 bundle/商业检查为 2 files、8/8。生产实现删除动态 alias，registry 删除四个旧 alias，`COLLAB_SERVER_UNAVAILABLE` 保留为真正网络错误；新构建的 Collab dist 无旧 License alias。
- B4 生成物与文档：`node tools/diagnostics/generate-diagnostics-artifacts.mjs` 成功，registry、SDK 码表与 core summary 同步为 190 个 code；Gate 6 registry 5/5、Gate 7 registry 4/4、LIC-108B CLI 24/24，联合为 3 files、33/33。SDK、package、implementation plan、roadmap、issues register 和 verification plan 已同步当前状态。
- 正式产物：`pnpm build`、`node tools/release/check-gate5-commercial-pack.mjs` 和 `npm pack --dry-run --json --ignore-scripts ./packages/license` 均 exit 0；License tarball 为 12 entries、12,405 bytes（unpacked 46,463 bytes），无 signer、私钥、测试 seed、fixture、test trust replacement、source map 或 forbidden text。`packages/collab/dist` 无旧 License alias，`packages/docx/dist`/`packages/pdf/dist` 无 `customerId`。
- 全局质量门禁：`pnpm lint`、`git diff --check` 均通过。Gate 6 第三方空项目 smoke 和 Collab 全包测试仍分别在首次 JWL1 licensed happy-path 处失败、5 files 为 18 passed / 9 failed；失败发生在本批次 alias 断言前，属于旧调用方迁移的 Phase 2/Phase 4 阻塞，未通过恢复测试 trust root 或 insecure 选项绕过。
- P2 复核收口：旧 JWL1 `now === expiresAt` 现按 `JWORD_LICENSE_EXPIRED` fail closed；新增测试先以 12 passed / 1 failed 锁定边界，再转为 entitlement 13/13、License 联合与包级 36/36。registry 的过期描述已删除 offline grace 语义，生成器以 190 codes 重新同步 SDK/core 产物；公开 API 文档已改为只允许稳定 `code` 与必要结构化字段，不再允许 `customerId`。LIC-108B CLI 24/24、Gate 7 registry/SDK/public API 10/10、License/root typecheck、`pnpm test:types`、`pnpm lint` 和 `git diff --check` 均通过。
- 范围：本节记录 `LIC-109` 完成时的状态；当时 `LIC-107B2`、整体 `LIC-107` 和 Phase 1 仍 Pending，尚未进入 `LIC-110`、`LIC-111`、DOCX/PDF/Collaboration JWL2 handle 迁移或 Phase 2，收费 PoC 和商业 GA 也未完成。

### 3.12 LIC-110B1 JWL2 test-only trust replacement 证据（2026-07-17）

- 新增 `fixtures/license/test-only-jwl2-fixture.ts`，使用独立 `jword-test-lic110-k1` 测试 key、固定 canonical JWL2 token 和 Node-only signer；未复用现有 JWL1 seed，且 fixture 不从 License package export、production src、dist 或 tarball 引用。
- 新增 `packages/license/test/lic110-test-trust.test.ts`，仅在该 focused test 内 mock `../src/trust-store.js`：test key 命中后返回临时公钥，所有其它 issuer/keyId（包括未知 issuer）委托真实 production lookup。production golden token 在 mock 环境仍通过；未知 key/issuer、payload/signature 篡改返回稳定失败；transfer 仍只含 token，接收侧通过公开 `activateJWordLicense()` 重新激活；动态恢复默认 trust module 后 test token 返回 `JWORD_LICENSE_KEY_UNKNOWN`。
- `pnpm exec vitest run packages/license/test/lic110-test-trust.test.ts` 为 1 file、6/6；`pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts` 为 1 file、6/6；`pnpm --filter @4xian/jword-license test` 为 3 files、42/42。包级 typecheck、`pnpm test:types`、根 `pnpm typecheck`、`pnpm lint` 和 `git diff --check` 均 exit 0。
- 静态边界扫描：`packages/license/src` 与 `packages/license/dist` 未命中 `test-only-jwl2`、`jword-test-lic110` 或现有 JWL1 test seed；package exports 未改变，仍只有 `.`。`packages/license/src/index.ts` 的既有通用 signer 说明不代表测试 signer 引用。
- 范围：仅完成 `LIC-110B1`；未修改 `trust-store.ts`、`verify-jwl2.ts`、`license.ts`、`index.ts`，未使用 `allowInsecureFixtureLicense`，未迁移 DOCX/PDF/Collaboration，也未修改旧 JWL1 测试。`LIC-110B2`、整体 `LIC-110`、`LIC-111`、Phase 2 和 Phase 4 继续 Pending。

### 3.13 LIC-110B2 测试消费者与产物隔离收口证据（2026-07-17）

- `packages/license/test/jwl2.test.ts` 已移除对 `INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED`、JWL1 signer 和跨协议 `createTestKeySignedToken()` 的依赖，改用固定 `TEST_ONLY_JWL2_TOKEN`；默认 production trust lookup 对该 token 返回 `JWORD_LICENSE_KEY_UNKNOWN`。`packages/license/test/entitlement.test.ts` 的 JWL1 测试保持不变，用于锁定遗留 fail-closed 行为。
- Gate 5 与 commercial pack 检查已增加 test-only JWL2 seed、公钥、token、signer、keyId 及实际材料的安全标签扫描；`packages/license/src`、`dist`、package exports 和实际 npm pack 文件均不得包含这些标记，失败输出不回显实际密钥材料。
- `pnpm exec vitest run packages/license/test/jwl2.test.ts packages/license/test/lic110-test-trust.test.ts` 为 2 files、29/29；`pnpm --filter @4xian/jword-license test` 为 3 files、42/42；`pnpm --filter @4xian/jword-license typecheck`、License build、`pnpm test:types`、根 `pnpm typecheck`、`pnpm lint` 和 `git diff --check` 均 exit 0。Gate 5 为 1 file、6/6；commercial pack 为 `status=ok`，License tarball dry-run 为 20 entries、15,749 bytes（unpacked 60,476 bytes），forbidden files/text/source maps 均为空。
- 范围：本节记录 `LIC-110B2` 完成时的状态；当时未迁移 DOCX/PDF/Collaboration、benchmarks、examples 或 third-party smoke，也未修改生产 trust store、公开 License API 或 `allowInsecureFixtureLicense`。`LIC-107B2`、`LIC-111`、整体 Phase 1、Phase 2、Phase 4 和 SEC-01 当时仍为 Pending/Open。

### 3.14 LIC-111B1/B2 单一 runtime identity 证据（2026-07-17）

- B1 manifest 与安装边界：DOCX、PDF、Collaboration 和 Collab Server 已从普通 dependency 迁移为必需 `@4xian/jword-license` peer，并以 `devDependencies: workspace:*` 支持仓库开发；packed manifest 把 peer 固定为当前 License package 精确版本。客户浏览器应用必须直接安装与 DOCX/PDF/Collaboration 匹配的精确 License 版本；Collab Server 的 peer 由 JWord 在版本化 Docker 镜像内部装配并锁定，客户不直接安装服务端 npm 包。两条路径都不能依靠 workspace alias 或把 peer 声明为 optional。
- focused 红灯：实现 `--browser` 前，`node tools/release/check-license-runtime-identity-smoke.mjs --browser` 只返回既有 Node 报告，没有 Vite module graph 或浏览器证据；B2 在同一脚本增加显式模式，无参数路径继续保持 B1 Node-only 行为。
- B1 Node 证据：正常 pnpm `9.14.2` 与 npm `11.9.0` 空项目安装均只解析 1 个 License canonical realpath；两个独立 npm 安装解析 2 个物理 runtime。A/B 对跨 runtime、手工伪造、对象复制和 structured clone handle 全部 fail closed，transfer 只含 token，B 通过正式根入口重新激活后只接受新建的本地 handle。
- 最低 Node 回归：固定 `node:20.19.0-bookworm-slim` 镜像 digest `sha256:5cfa999422613d3b34f766cbb814d964cbfcb76aaf3607e805da21cccb352bac`（`linux/arm64`）中，Node `20.19.0`、npm `10.8.2`、pnpm `9.14.2` 的无参数 identity smoke exit 0；pnpm/npm realpath 均为 1，双 runtime 拒绝与重新激活继续通过。
- B2 Vite 证据：临时项目实际解析的 Vite `8.0.12` 以 `target=es2022` 构建本地 tarball 消费项目，最终 JSON 的 `bundler` 字段保留 package、实际版本和状态；`generateBundle()` / `chunk.modules` 收集 264 个 canonical module，DOCX/PDF/Collab consumer entry 为 3/3，License canonical module 为 1，Collab Server browser module 为 0，且 License 路径位于临时项目而非 monorepo。
- 当前浏览器证据：`@playwright/test@1.59.1` 下 Chromium `147.0.7727.15`、Firefox `148.0.2`、WebKit `26.4` 均成功加载三个浏览器消费包，通过正式 License 根入口激活 production golden token 并验证 `formats`；报告固定为 `currentVersionsOnly=true`、`minimumVersionsVerified=false`。现有 Dedicated Worker transfer/重新激活与篡改拒绝继续由 `check-license-runtime-smoke.mjs` 的 3/3 当前浏览器结果证明。
- 质量门禁：`pnpm build`、identity smoke Node/Browser、完整 runtime smoke、Gate 0/5/6（3 files、17/17）、四消费包 typecheck、`pnpm test:types`、根 `pnpm typecheck`、`pnpm lint` 和 `git diff --check` 均 exit 0。
- 状态边界：`LIC-111B1`、`LIC-111B2` 与整体 `LIC-111` 已完成。当前 Playwright 版本不证明 Chrome 100、Edge 100、Firefox 128 或 Safari 16.4 的最低版本；该人工认证已按明确风险接受延期为发布前门禁，`LIC-107` 与整体 Phase 1 对内部实施视为完成并允许进入统一路线阶段 2。JWL1、`allowInsecureFixtureLicense` 和后续调用方迁移尚未清理，因此 SEC-01 继续 Open；Phase 4、收费 PoC 和商业 GA 均未完成。

## 4. 阶段 2：native、恢复和 core

聚焦运行对应 package test，并增加最少恶意 fixture：ZIP bomb、重复 entry、大 JSON、错误嵌套 schema、恢复故障、图片重开、纯删除 update。

扩大验证至少包括：

```bash
pnpm --filter @4xian/jword-native typecheck
pnpm --filter @4xian/jword-native test
pnpm --filter @4xian/jword-persistence typecheck
pnpm --filter @4xian/jword-persistence test
pnpm --filter @4xian/jword-core test
pnpm typecheck
```

必须证明失败路径不修改目标文档、不遗留 history、不泄漏 object URL。

### 4.1 Phase 2A B5 当前验证要求

除本节原有 Native、persistence 和 core 命令外，B5 必须记录：

- `packages/native/test/document-schema-security.test.ts` 与 `packages/native/test/worker.test.ts` 的 focused 结果；结构 diagnostic 的安全 `path`、Worker 稳定 `message=code` 和 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` 均须穿过公开 seam。
- Native package typecheck/build、Gate 4.5 相关 boundary/bundle/release、Gate 7 diagnostics registry，以及 diagnostics generator `--check`。
- fresh bundle/tarball 扫描，确认新增类型、Worker helper 和安全测试 fixture 不进入正式产物。
- runtime、Worker、协议和日志只断言稳定 code 与必要结构化字段；用户可见提示由 UI、wrapper 或宿主分别提供 `zh-CN` / `en-US` 映射。
- 当前浏览器回归只能记录 current versions；`minimumVersionsVerified` 必须保持 `false`，Chrome 100、Edge 100、Firefox 128、Safari 16.4 继续为 `Deferred/not-run`。

### 4.2 Phase 2B 原 scoped B4 历史证据（已失效）

环境为 Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`；`pnpm-lock.yaml` SHA-256 为 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。B4 使用保留三个 Core 历史空入口的批准路径。

- focused：persistence 2 文件/21 测试、Native 2 文件/24 测试，均 exit 0。
- package：persistence 3 文件/25 测试、Native 7 文件/141 测试，均 exit 0；两个 package typecheck 均 exit 0。
- Core：删除三个纯历史空入口后完整命令为 72 文件/365 测试 exit 0，Core typecheck exit 0；Phase 5 split 架构断言同步验证旧入口不存在且拆分目标完整。
- fresh build：`pnpm build` exit 0；后续架构与类型检查使用新生成的 `dist`。
- architecture：Native boundary/release/bundle 3 文件/11 测试，history/import graph/file budget/package exports 4 文件/16 测试，均 exit 0。
- 全仓静态门禁：`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 均 exit 0；lint 包含依赖版本、Core boundary 和中文注释检查。
- 当时的根测试：`pnpm test` 的 pretest build exit 0，Vitest 为 234 文件通过、1 文件失败，1237 测试通过、1 测试失败，命令 exit 1。License 级联业务 fixture、Gate 7、Core 与 Phase 5 split 已通过；Gate 5 commercial readiness focused 6/6，根运行通过 `maxWorkers: 4` 测试隔离不再 timeout。Toolbar DOM 测试移除没有独立设计规范的精确像素间距断言并保留结构分组和非绝对定位契约后为 18/18；该历史结果已由 4.6 的最终全绿证据取代。
- 最终双轴复核：Standards 首轮发现的 8 个测试回调中文注释缺口与 1 个重复 fixture finding 均已修复；共用 fixture 集中在 test-only helper，生产源码、package exports 与公开 API 未改变。persistence focused 21/21、package 25/25、typecheck、scoped ESLint 和中文注释检查均复跑通过，最终 Standards/Spec 均为 `PASS`、0 finding。
- dirty/whitespace：该历史批次在文档回写前的 staged diff SHA-256 为 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8`；当时的 tracked/staged/untracked whitespace 结果与范围清单记录在 13 号文档，不能替代 TEST-BASELINE-01 的最新门禁。
- 浏览器：当前 Chromium/Firefox/WebKit focused smoke 首轮为普通 roundtrip 3/3 通过、图片 roundtrip 3/3 因测试未切换“插入”页签超时；补齐 test-only 用户步骤后联合回归 6/6、exit 0。Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证未执行，全部保持 `Deferred/not-run`；当前浏览器结果不替代最低产品版本证据。

当时据此判断 B1-B3 的 scoped implementation 已完成、Phase 2B 仅受范围外根测试阻断；后续 4.3 的 B2 finding 已推翻该结论。新的 B2 双轴复审与 B4 完成前不得写 `Closed`，也不得进入 Phase 2C。

### 4.3 Phase 2B B2 pending/finalize 修复验证（2026-07-19）

旧 4.2 记录的是原 scoped restore 方案的 B4 历史证据。后续 B2 复审通过两个公开 `restoreVersion()` seam 复现 target `beforeTransaction` observer 抛错后 history/storage 已提交 restore version，因此旧 B2/B4 结论不再可用于关单。用户已批准把 13 号第 7.6 节中仅针对 `restoreVersion()` 的 pending/finalize/recovery 前移。

- Memory 与 Storage 均须从公开 adapter seam 验证 `prepared -> target-applied -> finalized`；pending update/version 不得进入 `listVersions()`。
- target 应用前 observer 抛错必须取消 pending，并证明 target、普通 history/storage 均无已完成 restore。
- target 已应用但 phase/finalize 暂时失败必须返回 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`，不得返回普通 `PERSISTENCE_RESTORE_FAILED`；重建 adapter 与 target 后用相同 source version 重试可完成 finalize。
- observer 修改 target 后抛错时，同一 operation 重试必须从 pending update 修复；Memory/Storage finalize 已写入后确认抛错时，相同 source version 重试必须识别最近完成确认，普通历史只能有一个 restore。
- 最小故障矩阵覆盖 pending 创建、取消、finalize、CAS 抛错/冲突、提交后确认丢失、恢复重试、observer 前后抛错及 observer 修改 target 后抛错。
- 后续 Spec 复审先后以四类 P1 阻断：diverged target 永久停留 `prepared`；finalize 已写入后确认丢失会在重试追加第二个 restore；pending 期间 append 会复用版本 ID；跳号虽然唯一，但 finalize 尾插较早 pending 会把历史变成 `version-1, version-2, version-4, version-3` 并改变已提交 version-4 的重建内容。前三类历史修复不再作为当前 PASS 证据。
- 当前修复要求 Memory/Storage 在 restore 活动或 durable pending 存在时阻止同 document append，在 append 已在途时让 restore 在 target/pending 前 fail closed；`target-applied` pending 必须保存实际 target state update。两个公开 seam 验证 pending 期间无普通版本，收敛后顺序严格为 `version-1, version-2, version-3, version-4` 且 version-4 内容为 `v1-later`；Storage 另覆盖预加载旧 state 的 append/restore 竞争。历史顺序修复后的 B2 与 B4 最终 Standards/Spec 均为 `PASS`、0 finding。
- 范围排除保持不变：不前移通用 history append CAS、幂等 append、多实例竞争、外部 operation store 或完整 `PERS-02`。

### 4.4 上一次 Phase 2B B4 重跑（已由 sequence P1 推翻）

环境继续为 Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`；`pnpm-lock.yaml` SHA-256 仍为 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。

以下是第三个 sequence P1 出现前的历史证据，不代表当前 B4 状态；该历史段记录时 B4 尚未重跑。

- 当时 Persistence focused 为 3 文件/32 测试，package 为 4 文件/36 测试；Persistence typecheck exit 0。Native focused 为 2 文件/24 测试，package 为 7 文件/141 测试；Native typecheck exit 0。
- 完整 Core 命令有 72 文件/365 测试通过，但三个历史 `export {}` 空入口仍以 `No test suite found` 使 exit 1；按批准的排除路径重跑为 72 文件/365 测试、exit 0，Core typecheck exit 0。
- `pnpm build` exit 0；Native architecture 为 3 文件/11 测试，Gate 6 history/import graph/file budget/package exports 为 4 文件/16 测试，均 exit 0。
- `pnpm test:types`、全仓 `pnpm typecheck`、`pnpm lint`、scoped ESLint、tracked/staged/untracked whitespace 均通过。
- 根 `pnpm test` 的 pretest build exit 0，Vitest 为 210 个文件通过、28 个失败，1107 个测试通过、125 个失败，命令 exit 1。失败集合仍为预先存在的 License/DOCX/PDF/Collab 级联、hook/UI/Gate 7 断言、commercial readiness 并发 timeout 和三个 Core 空入口，不属于 Phase 2B；但它超出计划只接受三个 Core 空入口的基线，因此继续阻断 B4 关单。
- 当时 B2 Standards/Spec 复审均为 `PASS`、0 finding；当前 Chromium/Firefox/WebKit 的既有 focused smoke 保持 6/6，最低版本认证仍为 `Deferred/not-run`。
- 当时结论为批准范围内 B4 门禁通过，但该结论已被后续 sequence P1 推翻，不能用于当前关单。

### 4.5 上一次 B2 复审与 B4 重跑（已由历史顺序 P1 推翻）

- 当时 B2 Standards/Spec 均为 `PASS`、0 finding；Memory/Storage 对称回归仅证明 pending 取消并保留普通 `version-4` 后，新的 restore 分配唯一 `version-5`，没有验证历史顺序和 version-4 内容稳定，因此该结论已经失效。当时 Persistence focused 3 文件/36 测试、package 4 文件/40 测试、typecheck 均 exit 0。
- Native focused 2 文件/24 测试、package 7 文件/141 测试、typecheck exit 0；完整 Core 为 72 文件/365 测试通过，但三个历史空入口使 exit 1，批准的排除路径为 72 文件/365 测试、exit 0，Core typecheck exit 0。
- fresh `pnpm build` exit 0；Native architecture 3 文件/11 测试、Gate 6 history/import graph/file budget/package exports 4 文件/16 测试均 exit 0；`pnpm test:types`、全仓 typecheck、全仓 lint 均 exit 0。
- 根 `pnpm test` 的 pretest build exit 0；首轮为 210 个文件通过、28 个失败，1111 个测试通过、125 个失败，包含 commercial readiness 并发 timeout。紧接的纯 Vitest 汇总为 211 个文件通过、27 个失败，1112 个测试通过、124 个失败；其它失败集合仍为范围外 License/DOCX/PDF/Collab、hook/UI/Gate 7 与三个 Core 空入口。该集合超出只接受三个 Core 空入口的基线，继续阻断关单。
- `git diff --check`、`git diff --cached --check` 和全部 9 个 untracked 文件的逐文件 whitespace 汇总均 exit 0；153 个既有 staged 条目及 SHA-256 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8` 保持不变。
- 当前 Chromium/Firefox/WebKit focused smoke 仍为既有 6/6，本次 persistence-only B2 重跑未重新执行浏览器；Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证保持 `Deferred/not-run`。
- 当时结论为批准范围内 B4 门禁通过；该结论已被历史顺序 P1 推翻，不能用于当前关单。

### 4.6 当前历史顺序与 append 屏障修复 B2/B4 证据

- Memory/Storage 公开 seam 已由“pending 期间 append 成功”红灯转为稳定拒绝；pending 收敛后 append 生成连续 `version-4`，`listVersions()` 顺序为 1/2/3/4，`loadVersion(version-4)` 内容稳定为 `v1-later`。
- `target-applied` pending 以实际 target state update 刷新 update/version checksum 与 state vector，避免逻辑 hash 相同但 CRDT lineage 不同导致后续 append 重放出重复文本。
- 同 backing history/storage owner 的 restore 专用屏障阻止 append/restore 交错；Storage 预加载旧 state 的 append 在途时，restore 在创建 pending 或修改 target 前 fail closed。该屏障不提供通用 append CAS、幂等、多实例锁或外部 operation store。
- B2 公开 seam 为 2 文件/18 测试，Persistence package 为 4 文件/41 测试；B2 与 B4 最终 Standards/Spec 双轴复审均为 `PASS`、0 finding。
- B4 Persistence focused 为 2 文件/33 测试，Native focused 为 2 文件/24 测试；Persistence/Native package 分别为 4 文件/41 测试和 7 文件/141 测试，三个 package typecheck 均 exit 0。TEST-BASELINE-01 删除三个纯历史空入口后，完整 Core 为 72 文件/365 测试 exit 0，Phase 5 split 为 16/16。
- fresh `pnpm build`、Native architecture 3 文件/11 测试、Gate 6 architecture 4 文件/16 测试、`pnpm test:types`、全仓 typecheck 与 lint 均 exit 0。全仓 typecheck 首轮发现 Storage test fake 显式赋值 optional CAS 的 `exactOptionalPropertyTypes` 错误，修正为仅在方法存在时展开后复跑通过。
- 根 `pnpm test` 的 pretest build 通过；TEST-BASELINE-01 最终为 235 文件、1238 测试全部通过，命令 exit 0。License 级联业务 fixture、Gate 7、Core、Phase 5 split、Toolbar DOM 与 Gate 0 Husky 测试均通过，Gate 5 通过 `maxWorkers: 4` 不再 timeout。Gate 0 用例按当前 pre-commit 只执行 `pnpm lint` 的真实契约验证脚本头、lint 命令和可执行位；`TEST-BASELINE-01` 与 Phase 2B 均已 `Closed`。
- TEST-BASELINE-01 后续评审覆盖：真实 public root marker 拒绝与 Gate 7 fixture 扫描分别先红后绿；两个 focused 文件为 10/10，License package 为 3 文件/43 测试，均 exit 0。
- TEST-BASELINE-01 最终静态门禁：`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 均 exit 0。lint 首轮发现 Vitest test-only setup 未被 TypeScript project service 收录；只在根 `tsconfig.json` 显式纳入该测试文件后，typecheck 与完整 lint 复跑通过。
- TEST-BASELINE-01 最终 whitespace 门禁：`git diff --check`、`git diff --cached --check` 均 exit 0；对当前全部 17 个 untracked 文件逐一执行 `git diff --no-index --check /dev/null <file>`，仅有预期差异 exit 1 且无 whitespace diagnostic，汇总 exit 0。
- TEST-BASELINE-01 最新双轴复审：Standards 硬性规则 `PASS`、0 finding，并保留 test-only mock 装配重复这一不阻断 P3 判断项；Spec `PASS`、0 finding。用户指出的两个 P2 覆盖缺口均已关闭，原跨环境 assertion helper 去重建议仍 defer。

### 4.7 Phase 2C B1-B4 历史关闭证据（2026-07-20，后续已被推翻）

环境为 Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`；`pnpm-lock.yaml` SHA-256 为 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。

- B1 先在五个公开/focused 文件建立 T1-T10：24 个测试中 17 个通过、7 个失败，共 26 条失败断言，全部对应计划允许的 CORE-01/CORE-05 红灯；生产文件未在 B1 改动。
- B2 同一五文件命令为 21 个通过、3 个失败，仅剩 T2/T6、T8b、T10 的 8 条允许下游断言；detector/history 三文件为 18/18，Core typecheck 通过。B3 统一 state/layout/event 与 selection-only refresh 后，同一五文件为 24/24。
- B4 首次完整 Core 为 73 个文件中 72 个通过、371 个测试中 370 个通过；composition 回归确认是最后一笔 `afterTransaction` 被 UndoManager no-op 清理事务覆盖。改为从外层 `doc.transact()` callback 捕获实际输入事务后，Core 恢复为 73 文件/371 测试全绿。
- 最终 focused 为 5 文件/24 测试，Core 为 73 文件/371 测试，Core typecheck 通过；architecture 为 3 文件/19 测试。`pnpm build` fresh build、`pnpm test:types`、根 typecheck、根 lint 均 exit 0；根 `pnpm test` 的 pretest fresh build 通过，236 文件/1244 测试全部通过。
- 双轴复审首轮分别发现 canvas mock 中文方法注释缺口和 dirty false event projection identity 未规范化；修复后 Standards 为 `PASS`、0 finding。Spec 后续指出纯删除 opt-in update bytes 缺少锁定，补入既有 D1 deletion 用例后单文件 8/8、五文件 24/24，最终 Spec 为 `PASS`、0 finding。
- B1 基线为 193 个 porcelain 条目，状态 SHA-256 为 `a72159ce1faa15c8d3d1bc8abc0c7a60b7e59c606cf6dd4b1ce7953c0ec9bd26`。当前仅增加 10 个 Phase 2C 生产/测试状态项及批准的文档回写；排除全部 15 个批准文件后，范围外 unstaged、staged、status 指纹分别保持 `dea4bb57aebfe6c7af30765b9eca833492d9a99a9c07529b55ae5ed22f7a6ecb`、`ae2a01820a23556a49978a82e3f959853938586ddca22abc76a45cdf9e358b9a`、`a9a9868306f95bafc5e4cb456ed989d73b2cf6c7dc1fe9b771e247f35e154585`。13 号仍保持既有 `AM`，本批未修改。
- `git diff --check`、`git diff --cached --check` 和当前全部 20 个 untracked 文件逐文件 whitespace 检查均通过；无 `[DEBUG-*]` 遗留。B4 计划内命令没有未执行项，未执行浏览器最低版本认证也不属于本次 Core-only Phase 2C 门禁。

上述结论随后被多页布局反例推翻，不再构成当前 `CORE-01`、B3/B4 或 Phase 2C 的关单依据。

### 4.8 Phase 2C 多页布局重开证据（2026-07-20）

- 红灯：公开 shared-document/Editor 路径构造 4 页文档，先在后页执行 `dirty:false` no-op，再从首页应用纯删除 update；单文件 5 个测试中 4 个通过、1 个失败，projection 已删除首字符但 layout 仍保留旧前缀。
- 修复：dirty `applySyncUpdate()` 在布局调度前将 `dirtyPageIndex` 重置为 0、`dirtyPageEndIndex` 扩展到缓存末页并清除 `layoutDirtyRange`；共享 Editor 接收其他实例 dirty 事务时执行相同失效。本地 command 的既有增量范围保持不变。
- Spec 复审补充红绿：公开 `executeCommand()` 允许自定义 command name；仅按名称识别 raw update 会让名为 `applySyncUpdate` 的本地后页写入错误替换首页 page identity。新增同一用例内断言先稳定红灯，再将事件层判别收紧为 `commandName === 'applySyncUpdate' && operationKinds.length === 0` 后转绿。
- 绿灯：单文件 5/5；Phase 2C focused 5 文件/24 测试；Core 73 文件/371 测试及 Core typecheck；architecture 3 文件/19 测试，均 exit 0。
- 完整门禁：fresh `pnpm build`、`pnpm test:types`、根 `pnpm typecheck`、根 `pnpm lint` 均 exit 0；根测试的 pretest build 通过，Vitest 为 236 文件/1244 测试全部通过。
- workspace：重开前后均为 203 个 porcelain 项，NUL 分隔状态 SHA-256 保持 `386695e3a307b4a5e4fe226ce6398a406b4d0b622d3862e89a2689d55a4a1d6b`。排除原 15 个 Phase 2C 文件及本轮批准的 README 后，范围外 unstaged、staged、status 指纹分别保持 `633364584f4e2d1088d92b7767686e062f25b37af42b58b32085f817a332f8ed`、`b7f0aefa111626feea4f24c9162f7c402db17c4713342c22bf57d4c241698240`、`450b438466337397b5eff3255e81e8a35cf6a38d8801953a84d7635d9efc7b3d`；13 号保持既有 `AM`，未修改。
- whitespace：`git diff --check`、`git diff --cached --check` 及全部 20 个 untracked 文件逐一检查均通过。
- 最终复审：Standards 为 `PASS`、0 finding。Spec 首轮发现公开 command name 冲突和 CORE-05 文档语态/关单条件矛盾；补充同名本地 command red/green、收紧 raw 事件判别并修正文档后，最终 Spec 为 `PASS`、0 finding。
- 当前状态：`CORE-01`、Phase 2C B3/B4 与 Phase 2C 重新 `Closed`；Phase 2 整体完成，下一验证边界为 Phase 3。

## 5. 阶段 3：artifact 和消费

```bash
pnpm lint
pnpm typecheck
pnpm test:types
pnpm build
node tools/release/normalize-dist-relative-imports.mjs --check
node --input-type=module -e "await import('./packages/core/dist/index.js')"
node tools/release/gate7-release-dry-run.mjs
: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"
node tools/release/check-gate7-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
pnpm audit --prod
```

`PHASE3_RUN_A_ROOT` 必须来自 B4 canonical builder 下载的 run-a。Vanilla、React、Vue、CSS、worker 和 EditorShell 必须从同一批 tarball 安装，不允许 workspace alias；兼容入口不自行 build 或 pack。

## 6. 阶段 4：商业模块和 Formats

```bash
pnpm --filter @4xian/jword-docx typecheck
pnpm --filter @4xian/jword-docx test
pnpm --filter @4xian/jword-pdf typecheck
pnpm --filter @4xian/jword-pdf test
node tools/release/check-gate5-commercial-pack.mjs
: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"
node tools/release/check-gate5-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
pnpm test:types
```

至少覆盖授权成功、缺授权、篡改 transfer、未授权不 dispatch、DOCX 有损 diagnostic、图片 roundtrip 和 worker 路径。

用户可见的 Formats/License diagnostic 需分别验证 `zh-CN` / `en-US` 展示；package、worker 和 transfer payload 只断言语言无关 code 与结构化字段，不把本地化文案写入跨层契约。

## 7. 阶段 5：Core、UI 和 wrapper

```bash
pnpm --filter @4xian/jword-ui test
pnpm exec vitest run tests/architecture/gate7-theme-i18n.test.ts
pnpm exec vitest run tests/architecture/ui-i18n-user-text.test.ts
pnpm exec playwright test examples/vanilla/tests/gate7-theme-i18n.e2e.ts --project=chromium
pnpm test:types
```

同时运行受影响的 Vanilla/React/Vue runtime smoke 和 iframe/跨 realm E2E。生命周期问题必须通过构造失败和 destroy 故障注入验证无残留 DOM、listener、observer 或 timer。i18n 验收必须覆盖创建后动态 locale 切换、当前可见 panel、tooltip、aria-label 和 live region；中文用户界面不得泄漏字典 key，英文用户界面不得残留硬编码中文。

## 8. 阶段 6：Collaboration

```bash
pnpm --filter @4xian/jword-collab typecheck
pnpm --filter @4xian/jword-collab test
pnpm --filter @4xian/jword-collab-server typecheck
pnpm --filter @4xian/jword-collab-server test
```

另需真实集成验证：

- HTTP/WS admission 共用 credential 和 `actorId`。
- 未准入请求在 storage 前拒绝。
- 双实例并发不丢 update、不重复 version。
- 重启、断网重连、备份和恢复。
- Origin allowlist、可信代理、共享限流。
- 缺 license 或生产配置时不监听端口。

### 8.1 LIC-309 Docker 交付验证计划（Pending）

LIC-309 只在阶段 6 获得单独实施批准后执行。验证对象必须是从干净 checkout 构建出的同一个不可变 image digest；本地 Node 入口、package no-alias smoke 或现有开发 Dockerfile 能够启动，均不能代替生产镜像验收。

| 子批次 | 最少自动化证据 | 必须人工/环境证据 | 关闭条件 |
| --- | --- | --- | --- |
| LIC-309A | 多阶段构建成功；runtime 层只含生产依赖；以非 root 用户启动；扫描镜像文件清单 | 记录基础镜像、Node 完整版本、构建日期和 image digest | 镜像不含测试、fixture、source map、signer、私钥、测试 seed、测试 trust root 或包管理缓存；客户宿主无需安装 Node |
| LIC-309B | HTTP `/health`、`/version` 与真实 module WebSocket client smoke；单容器模式和按 role 拆分模式使用同一镜像 | 通过反向代理执行 HTTPS/WSS upgrade 与优雅终止 | HTTP/WS 使用同一协议、admission 和 License context；没有第二套镜像或实现分叉 |
| LIC-309C | 缺失、篡改、过期、错误 class/feature 的 JWL2 在监听前被拒绝；运行中过期后 `/ready` 503 且后续写入失败 | 用只读 Docker/Kubernetes secret/file 注入，检查日志不泄漏 token | 不存在 allow-all production preset、宿主 class 覆盖、signer、私钥或独立 License 网络服务 |
| LIC-309D | PostgreSQL/对象存储 adapter 集成；双实例并发、幂等、迁移、容器重启和断连重连测试 | 完成备份、恢复和数据一致性演练 | 无 volatile-only production 路径；数据库不与应用塞入同一生产容器 |
| LIC-309E | HTTP/WS admission、可信 `actorId`、Origin allowlist、可信代理、共享限流、liveness/readiness、日志与 metrics 回归 | 校验 ingress/TLS、滚动升级和故障时告警 | 未准入请求在 storage 前拒绝，多实例运行时安全与可观测状态一致 |
| LIC-309F | 在 Docker Compose 参考部署中使用打包后的浏览器 SDK 完成 HTTPS/WSS 协作、重启、License 失效和恢复路径 | 生成并复核 SBOM、生产依赖清单、漏洞扫描、备份恢复报告和 image digest；Kubernetes/Helm 若获批则单独验收 | 所有证据绑定同一源码 SHA 与 image digest，且不依赖 workspace alias 或客户直接导入 server package |

依赖和停止条件：

- LIC-309B/C 必须等待 `LIC-300/301/304/305` 对 deployment factory、共享 License context 和统一 admission 的实现边界稳定。
- LIC-309D/E 必须与阶段 6B 的事务/CAS、Origin、可信代理、共享限流、备份恢复问题一起关闭，不能用容器封装掩盖未完成的数据面。
- 每个子批次完成后记录命令、通过数量、环境版本、源码 SHA、image digest 和 artifact 路径，然后停止等待复核；不得直接把 LIC-309 或阶段 6 标记完成。
- 当前 `packages/collab-server/Dockerfile` 继续只是开发/架构证明；本计划不改变它的发布状态。

## 9. 阶段 7：发布候选

在同一干净 SHA 和 artifact 上执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:types
pnpm test
pnpm build
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate6-commercial-pack.mjs
: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"
node tools/release/check-gate5-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
node tools/release/check-gate6-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
node tools/release/check-gate7-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
pnpm audit --prod
pnpm test:e2e
pnpm test:visual
pnpm bench
pnpm size
```

随后完成人工 Word 桌面、屏幕阅读器、签发、续期、到期、key rotation 和 rollback 演练。真实 publish 还必须满足法律门禁。
