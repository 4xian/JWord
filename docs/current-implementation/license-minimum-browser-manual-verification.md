# LIC-107B2 最低浏览器人工验证手册

> 状态日期：2026-07-17。Node 20.19.0 最低版本验证已自动通过；Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 仍等待 BrowserStack、Sauce Labs 或对应真实机器/虚拟机人工验证。经明确风险接受，LIC-107B2 对内部阶段为 `Conditionally Accepted`，人工最低浏览器认证延期为对应对外兼容声明和商业 GA 前门禁。

## 验证边界

本手册只验证 `@4xian/jword-license` tarball 在公开最低浏览器中的 License runtime、浏览器主线程和真实 module Dedicated Worker。它不验证整个编辑器、DOCX/PDF 产品 Worker、Collaboration 产品 Worker，也不进入 LIC-108 或后续任务。

最新版 Playwright Chromium/Firefox/WebKit、静态兼容扫描和 Vite 构建成功都不能替代这里的真实产品版本证据。Chromium 不能代替 Edge 100，Playwright WebKit 不能代替 Safari 16.4。

## 最低环境矩阵

| 环境 | 最低版本 | 当前状态 |
| --- | --- | --- |
| Node | 20.19.0 | Passed；自动 Docker 验证 |
| Chrome | 100 | Deferred；尚未人工实测 |
| Edge | 100 | Deferred；尚未人工实测 |
| Firefox | 128 | Deferred；尚未人工实测 |
| Safari | 16.4 | Deferred；尚未在对应 macOS/Safari 实测 |

## 当前风险接受

- 当前 Node 20.19.0、最新版 Chromium/Firefox/WebKit、真实 module Dedicated Worker、tarball/no-alias 和篡改拒绝证据被接受为内部后续阶段的临时兼容基线。
- 该决定不等于 Chrome 100、Edge 100、Firefox 128 或 Safari 16.4 已通过，也不能用于对外宣称最低版本认证完成。
- 人工矩阵不再阻断阶段 2 及后续内部实现，但在对应最低版本支持声明或商业 GA 前仍必须完成；若实测失败，应修复兼容问题或调整真实支持范围，不能把未执行状态改写为通过。

## 1. 冻结候选 tarball

从待验证源码构建一次 License package，并把 tarball 保存在不会被临时目录自动删除的位置：

```bash
pnpm --filter @4xian/jword-license build
mkdir -p /tmp/jword-license-107b2-candidate
pnpm --dir packages/license pack --pack-destination /tmp/jword-license-107b2-candidate
shasum -a 256 /tmp/jword-license-107b2-candidate/*.tgz
git rev-parse HEAD
git status --short
```

记录 tarball 绝对路径和 SHA-256。后续 Node 与四个浏览器必须使用这一份 tarball；不得分别重新打包后把不同 SHA 的结果拼成同一轮认证。

## 2. 用同一 tarball 复跑 Node 20.19.0

```bash
node tools/release/check-license-minimum-node.mjs \
  --pack-path /tmp/jword-license-107b2-candidate/4xian-jword-license-0.0.0.tgz
```

必须看到：

- `nodeVersion` 精确为 `v20.19.0`；
- `install.packSha256` 与候选 tarball 一致；
- `workspaceAlias` 为 `false`，解析路径位于临时空项目；
- activation、`formats`、transfer 和 `tamperedRejected` 均为 `true`；
- `@noble/curves@2.2.0` 与 `@noble/hashes@2.2.0` 各只有一个物理副本；
- `minimumVersionsVerified.node` 为 `true`，`minimumVersionsVerified.browsers` 仍为 `false`。

## 3. 从同一 tarball 生成浏览器候选 bundle

```bash
node tools/release/check-license-runtime-smoke.mjs \
  --prepare-browser \
  --pack-path /tmp/jword-license-107b2-candidate/4xian-jword-license-0.0.0.tgz
```

该命令会在临时空项目中安装 tarball，使用 Vite ES2022 构建真实 main/worker bundle，并输出：

- `install.packSha256`；
- `browserPreparation.distDir`；
- `browserPreparation.previewCommand`；
- main 与 worker chunk 的文件名、原始大小、gzip 大小和 SHA-256；
- `minimumVersionsVerified.browsers: false`。

保存完整命令输出。该步骤只准备 bundle，不代表任何最低浏览器已经通过。

## 4. 暴露受控测试地址

在 bundle 临时项目仍存在时运行输出中的 `previewCommand`。远程浏览器平台通过 BrowserStack Local、Sauce Connect 或等价受控 tunnel 访问该地址；若使用临时 HTTPS 静态站点，必须原样部署同一个 `dist`，并记录部署产物的 main/worker SHA-256。

测试页面只使用仓库现有 production golden token，并把 `Date.now()` 固定在 token 有效期内。不得签发新 token、增加 signer、私钥、测试 seed、testing export 或 trust replacement。

## 5. 逐浏览器执行

对 Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 分别执行：

1. 在平台能力页或浏览器版本页确认完整产品版本和操作系统版本。
2. 打开受控测试地址，等待页面根元素 `data-status` 变为 `ok`。
3. 读取根元素 `data-result`，确认以下字段全部为 `true`：
   - `mainActivation`；
   - `mainFormats`；
   - `mainTamperedRejected`；
   - `dedicatedWorker`；
   - `workerFormats`；
   - `workerTamperedRejected`。
4. 确认 Worker 是 `type=module` 的真实 Dedicated Worker，transfer 由主线程通过 `postMessage()` 发送，Worker 通过公开 `activateJWordLicense()` 重新激活。
5. 保存 console；任何未处理异常、模块加载失败、Worker 启动失败或验签异常都记为失败，不得仅凭页面可打开判定通过。
6. 保存平台 session/job ID、截图或视频以及执行日志。

## 6. 单环境记录模板

```md
- 执行日期：YYYY-MM-DD
- 执行人：
- 平台/真实机器：BrowserStack / Sauce Labs / physical / VM
- session/job ID 或证据路径：
- 操作系统完整版本：
- 浏览器产品与完整版本：
- Git commit：
- dirty workspace：yes / no
- License tarball 文件名：
- License tarball SHA-256：
- main chunk 文件名与 SHA-256：
- worker chunk 文件名与 SHA-256：
- 固定时间：2026-01-15T00:00:00.000Z
- main activation：pass / fail
- main formats：pass / fail
- main tampered token rejection：pass / fail
- module Dedicated Worker：pass / fail
- Worker formats：pass / fail
- Worker tampered token rejection：pass / fail
- console error：none / 详情
- 最终结果：pass / fail / not-run
- 备注或后续 issue：
```

## 7. 关闭条件

只有 Node 20.19.0、Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 五项都绑定同一候选 tarball SHA-256 并通过时，才能把 LIC-107B2 从 `Conditionally Accepted / manual certification deferred` 升级为 `Verified`，并对外宣称完成最低版本认证。随后仍需复核 LIC-107A/B1/B2 证据、focused License tests、typecheck 和 tarball 敏感内容扫描。

任一浏览器环境不可用时记录 `not-run`；任一环境失败时记录 `fail` 并保留证据。两种情况都不回滚已经批准的内部阶段推进，但继续阻断对应最低版本认证和商业 GA；不得把 `not-run` 写成 `pass`，也不得降低或修改公开支持矩阵绕过真实失败。
