# License 密钥与签发工具

## 生成首个生产密钥对

在仓库根目录执行：

```bash
node tools/license/generate-license-keypair.mjs
```

工具固定生成 Ed25519 密钥对：

- `issuer`：`jword`
- `keyId`：`jword-prod-2026-k1`
- 私钥：`~/.config/jword/keys/jword-prod-2026-k1-private.pem`
- 公钥：终端输出中的 `publicKeyBase64Url`

私钥目录权限为 `0700`，私钥文件权限为 `0600`。工具不会输出私钥正文，也不会覆盖已有私钥；私钥路径解析到仓库内时会拒绝执行。

## 使用边界

- 只把 `publicKeyBase64Url` 和对应审批记录写入 `LIC-103` 的生产 trust store。
- 私钥只能保存在受控本机和加密备份中，不得提交到仓库、发送到聊天或写入生产包。
- 私钥丢失后不能继续以同一 `keyId` 签发新 License；不要通过删除原文件重新生成同名密钥，应执行正式密钥轮换。

## 签发 JWL2

先准备只包含签发输入的 JSON，例如：

```json
{
  "licenseId": "lic-oem-2026-001",
  "licenseClass": "production",
  "features": ["formats", "professional.editing"],
  "issuedAt": "2026-07-16T00:00:00.000Z",
  "subscriptionEndsAt": "2027-07-16T00:00:00.000Z"
}
```

推荐从仓库外的受控私钥文件签发：

```bash
JWORD_LICENSE_PRIVATE_KEY_PATH="$HOME/.config/jword/keys/jword-prod-2026-k1-private.pem" \
node tools/license/issue-license.mjs --payload /tmp/jword-license-input.json
```

也可以通过标准输入提供 JSON，或只设置 `JWORD_LICENSE_PRIVATE_KEY_PEM`。两个私钥环境变量不能同时设置；路径来源经 realpath 解析后必须位于仓库外。成功时 stdout 只输出单个 `JWL2.<payload>.<signature>` token；失败时退出码为 1，stdout 不输出半成品 token。

签发输入只接受：

- `licenseId`：1 至 128 个 `[A-Za-z0-9._:-]` 字符。
- `licenseClass`：`evaluation`、`nonProduction`、`production` 或 `disasterRecovery`。
- `features`：从 `collaboration`、`formats`、`professional.editing` 中选择 1 至 3 项；不得重复，必须按字典序排列。
- `issuedAt`、可选 `subscriptionEndsAt` 和可选一致性校验字段 `expiresAt`：必须是有效的 `YYYY-MM-DDTHH:mm:ss.sssZ` UTC 时间。
- 可选 `issuer`、`keyId`：如提供，只能分别为 `jword`、`jword-prod-2026-k1`；调用方不能选择其它信任根。

工具固定生成 `schemaVersion=2`、`issuer=jword`、`keyId=jword-prod-2026-k1`，使用 UTF-8 `JWL2.<payloadSegment>` 作为 Ed25519 签名输入，并按 runtime parser 的字段顺序输出 canonical JSON。未知字段、未知 class/feature、重复或乱序 feature、非法标识和时间都会被拒绝。

期限规则固定如下：

- `evaluation` 不接受 `subscriptionEndsAt`，`expiresAt` 固定为 `issuedAt + 30 天`，没有额外宽限期。
- `nonProduction`、`production`、`disasterRecovery` 必须提供晚于 `issuedAt` 的 `subscriptionEndsAt`，`expiresAt` 固定为 `subscriptionEndsAt + 15 天`。
- 调用方如提供 `expiresAt`，必须与工具计算结果完全一致；工具不会接受或签发自定义宽限期。

## 私钥与台账

- 私钥不得提交到仓库、发送给客户或其他人员、写入 README/测试源码、日志、dist、npm 包或客户交付物。token 应通过 secret manager 或加密渠道交付。
- 工具只签发 token，不实现客户台账。受控签发台账至少记录 `licenseId`、`licenseClass`、`features`、`issuedAt`、`subscriptionEndsAt`、`expiresAt`、`keyId`、完整 token 的 SHA-256，以及审批人、审批时间和审批编号。
- OEM、Named Product、tenant、终端用户和 usage 属于合同、审批或运营台账，不写入 JWL2 token。
- 签发器只存在于 `tools/license`，不得被 `@4xian/jword-license` runtime、公开 exports、浏览器 bundle 或 Worker 导入。一级 OEM 和最终客户只能获得签名 token，不能获得签发工具或私钥。

## 离线验签与裁剪检查

先构建 License package，再从 token 文件或标准输入二选一执行：

```bash
pnpm --filter @4xian/jword-license build
node tools/license/verify-license.mjs --token-file /secure/path/license.jwl2
printf '%s\n' "$JWORD_LICENSE_TOKEN" | node tools/license/verify-license.mjs
```

历史审计、测试或故障重放可以指定规范 UTC 时间：

```bash
node tools/license/verify-license.mjs \
  --token-file /secure/path/license.jwl2 \
  --at 2026-01-15T00:00:00.000Z
```

- CLI 固定使用构建后的 `@4xian/jword-license` 根入口和生产 trust store，不接受命令行内联 token、public key、issuer、keyId、私钥、trust store 或测试信任根覆盖。
- 成功时退出码为 0，stdout 只输出 `status`、`checkedAt` 和已登记的裁剪 claims；不输出 token、payload、signature 或 key，也不创建供业务 runtime 使用的授权 handle。
- token 无效、未生效或过期时退出码为 1，stderr 只输出稳定 code；为保持已冻结 CLI 契约，runtime 的 token/issuer/key 分类在这里统一输出 `JWORD_LICENSE_SIGNATURE_INVALID`，未来生效和过期分别输出 `JWORD_LICENSE_NOT_YET_VALID`、`JWORD_LICENSE_EXPIRED`。参数或输入错误时退出码为 2，stderr 只输出工具内部 CLI code。
- `--at` 只改变本次离线检查时钟，不能绕过签名、class、feature 或期限规则。默认系统 wall clock 和显式 `--at` 都不能抵抗拥有宿主控制权的调用方回拨时间；该工具不是 DRM 或可信时间证明。
- 工具不访问网络，不读取私钥环境变量，不属于 package export、dist、tarball 或客户 SDK。
