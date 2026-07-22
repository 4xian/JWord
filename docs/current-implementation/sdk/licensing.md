# 授权与收费能力当前实现摘要

## 对应文档

- `docs/sdk/licensing.md`
- `docs/current-implementation/packages/license.md`
- `packages/license/src/index.ts`
- `tools/license/issue-license.mjs`

## 当前能力

`@4xian/jword-license` 提供：

- `GATE5_FORMAT_FEATURES`：`docx.import`、`docx.export`、`pdf.export`。
- `GATE6_COLLAB_FEATURES`：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
- `JWORD_FEATURES`：`professional.editing`、`formats`、`collaboration`。
- `activateJWordLicense()`：固定验签并校验时间后创建 WeakMap-branded opaque handle。
- `createJWordLicenseTransfer()` / `JWordLicenseTransfer`：可信 handle 创建只含 token 的 structured-clone DTO，接收侧重新激活。
- `isJWordFeatureLicensed()` / `assertJWordFeatureLicensed()`：验证 handle identity、module feature 和每次访问时的到期状态。
- `assertJWordFeatureEntitled()`：当前旧 entitlement 执行入口；JWL1 Ed25519 token 已统一 fail closed。
- `createJWordLicenseError()` 与 metadata：稳定 license diagnostic。
- 内部 JWL2 parser、固定 `issuer + keyId` trust lookup、Ed25519 验签和时间关系校验。

## enforcement 位置

- DOCX/PDF worker/package 当前仍调用旧 entitlement 入口，JWL1 Ed25519 fixture 会 fail closed；JWL2 handle 迁移尚未实施。
- collab client/server 当前仍使用旧 entitlement 和 feature matrix，尚未迁移 JWL2 deployment context。
- 浏览器按钮隐藏、示例状态提示、wrapper props 都不是授权边界。

## runtime identity 与宿主依赖

- DOCX、PDF 和 Collaboration 将 `@4xian/jword-license` 声明为必需 peer，仓库开发另用 `devDependencies: workspace:*`；客户浏览器应用必须直接安装与所用消费包 packed peer 匹配的精确 License 版本。
- Collab Server 同样声明必需 License peer，但由 JWord 在版本化 Docker 镜像内部装配并锁定；客户不直接安装服务端 npm 包。正常 pnpm/npm 安装与 Vite bundle 只应解析一个 canonical License runtime。
- 重复物理 runtime 不共享模块私有 WeakMap handle。跨 runtime 或 Worker 边界必须传递只含 token 的 `JWordLicenseTransfer`，再由接收 runtime 通过公开 `activateJWordLicense()` 重新激活；不能传递或复制 handle 外形获得授权。
- LIC-111B1/B2 已验证 Node 20.19.0、pnpm/npm、Vite ES2022 和当前 Chromium/Firefox/WebKit；当前浏览器结果不是 LIC-107B2 的最低版本证据。

## 当前限制

- 不包含客户门户、在线续费、usage metering、组织管理或远程 license server SDK。
- 调用方不能传入公钥或 verifier 替换生产 JWL2 trust root。
- `tools/license/issue-license.mjs` 已是受控、严格 JWL2-only signer，只能在仓库工具环境使用外部生产私钥；它不属于 SDK、package runtime 或公开 export。
- 测试 signer 仅位于 `fixtures/license/`，不属于 package 能力，也不进入正式 exports、dist 或 tarball；LIC-110B1/B2 已完成 test-only trust/key 隔离，`allowInsecureFixtureLicense` 仍保留到后续 JWL1 删除批次。
- 仓库内 LIC-108B 离线验签/裁剪 CLI 已完成，但不属于客户 SDK；DOCX/PDF/Collaboration worker 接入和 JWL1 调用方迁移留待 Phase 2/4。
- opaque handle 的 JSON、复制和 structured clone 不含 token；`JWordLicenseTransfer` 是 structured clone 明确携带 bearer token 的唯一例外，不得写入日志、diagnostic 或 support bundle。
- 所有付费包 manifest 仍为 `private: true`，真实发布需要人工审批。
- `LIC-111` 已完成；`LIC-107B2` 最低浏览器人工认证已条件性接受并延期为发布前门禁，整体 Phase 1 对内部实施视为完成，可以进入统一路线阶段 2。SEC-01 因 JWL1、`allowInsecureFixtureLicense` 和后续调用方迁移继续 Open，Phase 4、收费 PoC 与商业 GA 均未完成。

## 验证入口

- `packages/license/test/entitlement.test.ts`
- `packages/license/test/jwl2.test.ts`
- `tests/architecture/gate5-commercial-readiness.test.ts`
- `tests/architecture/gate6-commercial-readiness.test.ts`
- `tools/release/check-gate5-commercial-pack.mjs`
- `tools/release/check-gate6-commercial-pack.mjs`
