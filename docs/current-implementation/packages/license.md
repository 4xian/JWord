# @4xian/jword-license 当前实现摘要

## 包职责

`@4xian/jword-license` 当前同时提供旧 entitlement 编译兼容契约，以及公开 JWL2 激活、模块级 feature 判断、WeakMap-branded opaque handle 和 identity-checked worker transfer。严格 parser、固定生产 trust lookup、Ed25519 验签和时间校验均位于 License 内部；JWL1 Ed25519 token 继续统一 fail closed。

## 入口与导出

- 包名：`@4xian/jword-license`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：精确 `@noble/curves@2.2.0`，并由其解析精确 `@noble/hashes@2.2.0`。

## 公开 API 摘要

根入口主要导出：

- `GATE5_FORMAT_FEATURES`
- `GATE6_COLLAB_FEATURES`
- `JWORD_FEATURES`
- `activateJWordLicense()`
- `createJWordLicenseTransfer()`
- `assertJWordFeatureLicensed()`
- `isJWordFeatureLicensed()`
- `assertJWordFeatureEntitled()`
- `createJWordLicenseError()`
- `isJWordLicenseDiagnosticCode()`
- `JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA`
- `JWordLicenseToken`、`JWordLicense`、`JWordLicenseTransfer`、module/legacy feature、diagnostic、validation 类型
- `JWordLicenseError`

## 主要模块

- `index.ts`：转导出 JWL2 激活/handle/transfer 以及旧 entitlement 编译兼容契约。
- `features.ts`、`errors.ts`：feature matrix 与稳定诊断。
- `legacy-jwl1.ts`：旧 entitlement、显式 insecure fixture 和 fail-closed JWL1 路径。
- `license.ts`：公开 JWL2 激活、时间关系、模块私有 WeakMap handle、集中 feature 检查和 identity-checked transfer。
- `jwl2.ts`：严格 JWL2 envelope/claims parser 与 canonical 签名输入。
- `trust-store.ts`、`verify-jwl2.ts`：固定生产公钥查找和验签后 claims 解析。
- `crypto.ts`：保留 base64url 与 UTF-8 helper；Ed25519 通过 `@noble/curves/ed25519.js` 同步严格验签，仅供 License 内部使用。
- `test/jwl2.test.ts`、`test/entitlement.test.ts`：JWL2 trust/验签/激活/handle/transfer 和旧入口 fail-closed 测试。

## 已实现能力

- 商业格式 feature keys：`docx.import`、`docx.export`、`pdf.export`。
- 协作 feature keys：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
- 固定 `issuer=jword`、`keyId=jword-prod-2026-k1` 和批准生产公钥的 trust lookup。
- JWL2 envelope 先查固定 trust root 并完成 Ed25519 验签，成功后才解析完整 canonical claims。
- `activateJWordLicense()` 使用系统 wall clock 校验未来偏差、时间先后、30 天 Evaluation、签名内 15 天订阅宽限和当前到期状态。
- 公开冻结 handle 只包含 `licenseId` 与 `expiresAt`；已验签 class、module features 和期限只存在于模块私有 WeakMap。
- `isJWordFeatureLicensed()` 与 `assertJWordFeatureLicensed()` 先验证 WeakMap identity，并在每次调用时重新判断到期；伪造、复制和 structured clone 均不能获得可信身份。
- `createJWordLicenseTransfer()` 先验证 WeakMap identity，再从私有状态创建只含原始 token 的 DTO；clone 后通过既有 `activateJWordLicense()` 重新验签、校验时间并生成不同对象的新 handle。
- opaque handle 的 JSON、复制和 structured clone 不含 token；`JWordLicenseTransfer` 的 structured clone 明确携带 token，是唯一例外，不附带 claims、features 或 licenseClass。
- 未知 issuer/keyId、篡改 payload/signature、仓库测试 key 和调用方公钥注入均 fail closed。
- 旧 entitlement 继续提供缺失和签名无效 diagnostic；JWL1 Ed25519 token 不再进入 feature、期限或 offline grace 判断，旧 `server-unavailable` 输入也统一 fail closed 为签名无效。
- 正式入口不提供签发能力；仓库测试从 `fixtures/license/` 使用不会进入 package 的 test-only support。
- Legacy insecure fixture 仅在 `allowInsecureFixtureLicense` 下接受，warning 只携带语言无关 code。

## 内部实现方案

- `verifyJWordLicenseToken()` 的内部顺序固定为 envelope → trust lookup → Ed25519 →完整 claims。
- `activateJWordLicense()` 只在 verifier 成功和时间关系有效后创建并登记 handle，不接受调用方 `now`、环境、class、feature 或宽限参数。
- `assertJWordFeatureEntitled()` 仍是各商业包调用的旧执行层入口，但当前 JWL1 Ed25519 token 统一返回签名无效；它尚未接入 JWL2 verifier。
- 旧 feature 和期限判断只在通过遗留 fixture 校验后执行；offline grace 已停止授权作用，兼容结果中的 `offlineGrace` 固定为 `false`。旧 server 状态保留为类型兼容输入，但始终 fail closed。
- 生产 `verifyEd25519(message, signature, publicKey): boolean` 保持同步纯函数 interface，预检 64-byte signature 与 32-byte public key，并调用 `ed25519.verify(..., { zip215: false })`；非法长度、非法编码和依赖异常统一 fail closed。Node test-only signer 只存在于仓库 fixtures。

## 与其它包关系

- DOCX、PDF 和 Collaboration 将 `@4xian/jword-license` 作为必需 peer，仓库开发使用 `devDependencies: workspace:*`；客户浏览器应用必须直接安装与消费包 packed peer 匹配的精确 License 版本。Collab Server 同样使用必需 License peer，但由 JWord 在版本化 Docker 镜像内部装配并锁定，客户不直接安装服务端 npm 包。正常 pnpm/npm 安装与 Vite bundle 只解析一个 canonical License runtime。
- 不同物理 runtime 各自维护模块私有 WeakMap，不能共享 handle identity。跨 runtime 只能传递 `createJWordLicenseTransfer()` 产生的单字段 token DTO，由接收 runtime 再次调用公开 `activateJWordLicense()` 验签并创建新的本地 handle。
- DOCX/PDF 执行层仍调用旧 entitlement 入口；旧 JWL1 Ed25519 fixture 当前 fail closed，尚未迁移 JWL2 handle。其公开错误与 worker DTO 已删除 `customerId`，License 错误只保留语言无关 code、`feature` 和 `requestId` 等必要字段。
- Collab/collab-server 仍复用旧 feature matrix，尚未迁移 JWL2 deployment context；Collab 已删除 License alias，原样传播 `JWORD_*` code，真正的 provider 网络错误仍使用 `COLLAB_SERVER_UNAVAILABLE`。
- 包通过精确 noble runtime dependencies 在浏览器/Node 侧同步验签；没有引入 WebCrypto async API，也没有改变公开 License API。

## 主要测试/验收入口

- `packages/license/test/entitlement.test.ts`
- `packages/license/test/jwl2.test.ts`
- `tests/architecture/gate5-commercial-readiness.test.ts`
- `tests/architecture/gate6-commercial-readiness.test.ts`
- `tests/architecture/gate6-package-exports.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-license typecheck`：校验授权 feature、entitlement、诊断和 crypto helper 类型。
- `pnpm --filter @4xian/jword-license test`：运行 JWL2 parser/trust/验签和旧 entitlement fail-closed 测试。
- `pnpm --filter @4xian/jword-license build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归商业授权边界、包导出和公开 API catalog。

## 当前限制/注意点

- 不联网，不实现 customer portal 或 future network license validation。
- 不读取或携带用户文档正文。
- DOCX/PDF/Collaboration worker 尚未接入 `JWordLicenseTransfer`；opaque handle 仍不能直接跨 worker 获得可信身份。
- 严格 JWL2 signer 和离线验签/裁剪 CLI 已在 `tools/license` 完成，均不属于 package runtime 或公开 export；LIC-110B1/B2 已完成 test-only trust/key 隔离和 License 测试消费者迁移，LIC-111B1/B2 已完成 Node/Vite 单一 runtime 与重复 runtime fail-closed 验证，JWL1 调用方迁移留待 Phase 2/4。
- 正式根入口、dist 和 tarball 不含 signer、测试 seed 或 Ed25519 签名入口。
- Legacy FNV fixture 只有显式允许时才通过。
- `LIC-107A/B1` 已完成；本项目不宣称 `@noble/curves@2.2.0` 已经独立密码学审计。`LIC-107B2` 的 Node 20.19.0 已通过，Chrome 100、Edge 100、Firefox 128、Safari 16.4 的真实最低版本人工认证按明确风险接受延期；整体 `LIC-107` 和 Phase 1 对内部实施视为完成，但收费 GA 前仍需补齐对应认证。
- LIC-111 当前 Chromium/Firefox/WebKit 只证明当前 Playwright 版本；报告明确为 `currentVersionsOnly=true`、`minimumVersionsVerified=false`，不能替代或冒充 LIC-107B2 最低版本实测。SEC-01 仍因 JWL1、`allowInsecureFixtureLicense` 与后续调用方迁移保持 Open。
- 授权失败返回稳定 diagnostic code，不能仅靠 UI 按钮隐藏作为权限边界。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/license/package.json`
- `packages/license/src/index.ts`
- `packages/license/src/crypto.ts`
- `packages/license/src/jwl2.ts`
- `packages/license/src/trust-store.ts`
- `packages/license/src/verify-jwl2.ts`
- `packages/license/test/entitlement.test.ts`
- `packages/license/test/jwl2.test.ts`
- `tools/license/verify-license.mjs`
- `tools/license/verify-license.test.ts`
