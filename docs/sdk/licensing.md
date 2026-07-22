# 授权接入与收费能力边界

## Edition matrix

| Edition | 包 | 能力 |
|---|---|---|
| free base | `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` | 基础编辑、UI、`.jword` 保存/打开、diagnostics export。 |
| paid format | `@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-license` | DOCX import/export、PDF export、worker progress/cancel、format warnings。 |
| paid collaboration | 客户浏览器 SDK：`@4xian/jword-collab` 及其浏览器侧依赖；服务端：JWord 版本化 Docker 镜像 | 多人协作、离线、历史、自动插入和 self-host HTTP/WSS；客户应用不直接安装 server npm package。 |
| integration | `@4xian/jword-react`、`@4xian/jword-vue`、`@4xian/jword-devtools` | framework wrapper 与 opt-in diagnostics/devtools。 |

## Feature keys

`GATE5_FORMAT_FEATURES`：`docx.import`、`docx.export`、`pdf.export`。

`GATE6_COLLAB_FEATURES`：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。

`JWORD_FEATURES`：`professional.editing`、`formats`、`collaboration`。

## License token

根入口已经公开 `activateJWordLicense()`、`JWordLicense`、`isJWordFeatureLicensed()`、`assertJWordFeatureLicensed()`、`createJWordLicenseTransfer()` 与 `JWordLicenseTransfer`。激活路径固定使用 `issuer=jword`、`keyId=jword-prod-2026-k1` 的 trust lookup 和 Ed25519 验签，随后校验时间关系并创建 WeakMap-branded handle；公开 handle 只包含 `licenseId` 与 `expiresAt`，复制、伪造或 structured clone 均不具有可信身份。

```ts
const license = activateJWordLicense(jwl2Token)

assertJWordFeatureLicensed(license, JWORD_FEATURES.formats)

const clonedTransfer = structuredClone(createJWordLicenseTransfer(license))
const workerLicense = activateJWordLicense(clonedTransfer.token)
```

opaque handle 的 JSON、复制和 structured clone 不含 token。`JWordLicenseTransfer` 是 structured clone 明确携带 bearer token 的唯一例外，只包含 `token`；worker 必须重新激活，不能把 transfer 外形当作可信授权。

DOCX、PDF 和 Collaboration 将 `@4xian/jword-license` 声明为必需 peer，仓库开发另用 `devDependencies: workspace:*`。客户浏览器应用必须直接安装与所用消费包 packed peer 匹配的精确 License 版本；正常 pnpm/npm 安装与 Vite bundle 只应解析一个 canonical runtime。Collab Server 同样声明必需 License peer，但该依赖由 JWord 在版本化 Docker 镜像内部装配并锁定，客户不直接安装服务端 npm 包。不同物理 runtime 不共享模块私有 WeakMap handle，跨 runtime 必须传递上述单字段 token DTO，再由接收 runtime 调用公开 `activateJWordLicense()` 重新激活。

当前 DOCX/PDF/Collaboration 仍接收旧 `JWordLicenseEntitlement`，其 JWL1 Ed25519 token 已统一 fail closed，且调用方不能通过公钥参数替换生产信任根。受控 JWL2-only signer 与离线验签/裁剪 CLI 已完成，但它们只位于仓库 `tools/license`，不属于客户 SDK；worker 调用方迁移尚未完成，因此不能把当前状态描述为完整商业交付链路。

正式根入口不再导出测试 signer 或 Ed25519 签名能力。仓库内部 JWL1 test-only support 只位于 `fixtures/license/`，不会进入 package export、dist 或 tarball；LIC-110B1/B2 已完成 JWL2 test-only trust/key 与 License 测试消费者隔离，显式 insecure fixture 兼容入口仍待后续 JWL1 删除批次处理，不得用于生产。

LIC-111B1/B2 与整体 LIC-111 已完成：Node 20.19.0、pnpm/npm、Vite ES2022 与当前 Chromium/Firefox/WebKit 已证明正常消费只有一个 License runtime，重复 runtime 对跨副本或伪造 handle fail closed。当前浏览器结果只覆盖当前 Playwright 版本，不是 Chrome 100、Edge 100、Firefox 128 或 Safari 16.4 的最低版本实测证据；LIC-107B2 人工认证已条件性接受并延期为发布前门禁，整体 Phase 1 对内部实施视为完成。SEC-01 因 JWL1、`allowInsecureFixtureLicense` 和后续调用方迁移继续 Open，Phase 4、收费 PoC 与商业 GA 均未完成。

客户业务代码只集成浏览器 SDK。Collaboration 等正式服务端统一由 JWord 以版本化 Docker 镜像交付，Node 与服务端 npm package 只存在于镜像内；客户浏览器通过声明的 HTTPS/WSS endpoint 接入，不直接导入 `@4xian/jword-collab-server`。生产镜像仍等待 LIC-309 和生产数据面验收，当前仓库 Dockerfile 不得作为正式镜像发布。

## Enforcement

付费能力当前仍在 worker、server 或 package 执行层调用旧 `assertJWordFeatureEntitled()`，因此 JWL1 Ed25519 输入会在读取正文前 fail closed。后续需要迁移到统一 JWL2 handle/deployment context；浏览器按钮隐藏、文档提示或 wrapper props 始终不是授权边界。

```ts
assertJWordFeatureEntitled(legacyEntitlement, GATE5_FORMAT_FEATURES.pdfExport)
```

以上仅表示当前旧入口的 enforcement 位置，不是 JWL2 生产接入示例。

## 未授权故障排查

| Code | 说明 |
|---|---|
| `JWORD_LICENSE_MISSING` | 未传 entitlement。 |
| `JWORD_LICENSE_HANDLE_INVALID` | 对象不是当前 License runtime 登记的可信 handle。 |
| `JWORD_LICENSE_TOKEN_INVALID` | JWL2 token 结构、编码、canonical claims 或期限关系无效。 |
| `JWORD_LICENSE_ISSUER_INVALID` | JWL2 token issuer 不受当前 License runtime 信任。 |
| `JWORD_LICENSE_KEY_UNKNOWN` | JWL2 token keyId 未在当前生产 trust set 登记。 |
| `JWORD_LICENSE_NOT_YET_VALID` | 签发时间晚于允许的系统时钟偏差。 |
| `JWORD_LICENSE_EXPIRED` | 当前时间已到或超过签名 claims 中的 `expiresAt`。 |
| `JWORD_FEATURE_NOT_ENTITLED` | feature key 不在授权中。 |
| `JWORD_LICENSE_SIGNATURE_INVALID` | JWL2 已找到受信 key 但 Ed25519 验签失败；旧 JWL1 兼容入口也以此 code fail closed。 |

完整 metadata 见 [`diagnostic-codes.md`](./diagnostic-codes.md)。

JWL2 V1 不访问在线授权服务，因此没有 server-unavailable License diagnostic。旧 entitlement 中的 `status`、`offlineGraceUntil` 和 `offlineGraceDays` 仅为待 Phase 4 删除的类型兼容字段，不能改变授权结论；旧 `server-unavailable` 输入返回 `JWORD_LICENSE_SIGNATURE_INVALID`，兼容结果中的 `offlineGrace` 始终为 `false`。

License runtime、Collaboration diagnostic 以及 DOCX/PDF worker 错误只传递语言无关 code 与必要的 `feature`、`requestId` 等结构化字段，不传递 `customerId`。Collaboration 原样传播 `JWORD_*` License code，不提供 `COLLAB_*` License alias。用户可见文案由 UI、wrapper 或宿主按 locale 生成。

## 私有 registry

1. 先运行 `pnpm build`、`node tools/release/gate7-release-dry-run.mjs` 和 `node tools/release/check-gate7-third-party-smoke.mjs`。
2. 人工确认版本号、changeset、README/LICENSE、registry URL 和 access。
3. 只允许人工执行 publish；脚本不会自动 publish、tag 或 push。
