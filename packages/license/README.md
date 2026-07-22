# @4xian/jword-license

商业授权契约包的公开根入口提供 JWL2 token 激活、WeakMap-branded opaque handle、identity-checked worker transfer、模块级 feature 判断，以及旧 entitlement 编译兼容和本地授权诊断归一。包内固定 trust lookup、验签和时间校验不接受调用方替换；它不联网、不读取文档内容，也不绑定 DOCX/PDF/协作运行时。

## Feature Keys

- `docx.import`
- `docx.export`
- `pdf.export`
- `collaboration.multiplayer`
- `collaboration.offline`
- `collaboration.history`
- `collaboration.server`
- `automation.autoInsert`

JWL2 模块级 feature：

- `professional.editing`
- `formats`
- `collaboration`

## Diagnostics

- `JWORD_LICENSE_MISSING`
- `JWORD_LICENSE_HANDLE_INVALID`
- `JWORD_LICENSE_TOKEN_INVALID`
- `JWORD_LICENSE_ISSUER_INVALID`
- `JWORD_LICENSE_KEY_UNKNOWN`
- `JWORD_LICENSE_NOT_YET_VALID`
- `JWORD_LICENSE_EXPIRED`
- `JWORD_FEATURE_NOT_ENTITLED`
- `JWORD_LICENSE_SIGNATURE_INVALID`

未授权失败路径必须先返回稳定 diagnostic，再阻止高级功能读取或写入用户文档内容。

JWL2 V1 只执行离线验签和本地时间判断，不产生在线授权服务状态。旧 JWL1 `server-unavailable` 输入继续 fail closed 为 `JWORD_LICENSE_SIGNATURE_INVALID`；兼容返回值中的 `offlineGrace` 固定为 `false`。`JWordLicenseError`、warning 和 metadata 只携带语言无关 code 与必要结构化字段，不携带 `customerId` 或自然语言 description。

严格 JWL2 parser、固定 `issuer=jword` / `keyId=jword-prod-2026-k1` trust lookup 和 Ed25519 验签成功后，`activateJWordLicense()` 校验时间关系并返回只含 `licenseId` / `expiresAt` 的冻结 handle。`isJWordFeatureLicensed()` 和 `assertJWordFeatureLicensed()` 通过模块私有 WeakMap 验证 identity，并在每次访问时重新检查到期状态。

Ed25519 verifier 使用精确 `@noble/curves@2.2.0` 的 `@noble/curves/ed25519.js`，保持同步内部 interface，并显式使用 `{ zip215: false }`。非法长度、非法编码和依赖异常统一返回 `false`；JWord 不转导出或包装 noble 的签名能力，也不宣称该版本已经由本项目独立密码学审计。LIC-107A/B1 已完成，LIC-107B2 的 Node 20.19.0 已通过；最低浏览器人工认证已条件性接受并延期为发布前门禁，整体 LIC-107 对内部实施视为完成。

`createJWordLicenseTransfer()` 只接受当前 runtime 登记的 handle，并从私有状态返回仅含原始 token 的 `JWordLicenseTransfer`。handle 的 JSON、复制和 structured clone 不含 token；transfer 的 structured clone 明确携带 token，是唯一例外，接收侧必须再次调用 `activateJWordLicense()` 完整验签并创建新 handle。

DOCX、PDF 和 Collaboration 将本包作为必需 peer，仓库开发另用 `devDependencies: workspace:*`；客户浏览器应用必须直接安装与消费包 packed peer 匹配的精确 `@4xian/jword-license` 版本。Collab Server 同样声明必需 License peer，但由 JWord 在版本化 Docker 镜像内部装配并锁定，客户不直接安装服务端 npm 包。正常 pnpm/npm 安装和 Vite bundle 只应解析一个 runtime。两个物理副本不会共享模块私有 WeakMap handle，跨 runtime 必须传递单字段 token DTO 并在接收副本重新激活，不能复制 handle 获得授权。

根入口当前仍保留旧 JWL1 entitlement，但不再提供签发能力；JWL1 Ed25519 token 已统一 fail closed，调用方也不能注入公钥。Legacy FNV fixture 只有显式启用 `allowInsecureFixtureLicense` 时才可能通过，不得用于生产。受控 JWL2 signer 与 LIC-108B 离线验签/裁剪工具已在仓库 `tools/license` 完成，但不属于 package export；LIC-110B1/B2 已完成 test-only trust/key 与 License 测试消费者隔离，DOCX/PDF/Collaboration worker 接入和 JWL1 调用方迁移留待 Phase 2/4。

LIC-111B1/B2 与整体 LIC-111 已完成；Node 20.19.0、pnpm/npm、Vite ES2022 和当前 Chromium/Firefox/WebKit identity smoke 均通过。当前浏览器只证明当前 Playwright 版本，不是 LIC-107B2 最低版本实测证据；该人工认证已延期为发布前门禁，整体 Phase 1 对内部实施视为完成并允许进入统一路线阶段 2。SEC-01 因 JWL1、`allowInsecureFixtureLicense` 和后续调用方迁移继续 Open，Phase 4、收费 PoC 与商业 GA 均未完成。
