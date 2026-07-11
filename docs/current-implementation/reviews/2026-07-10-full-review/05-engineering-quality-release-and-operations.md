# 工程质量、发布与运维审查

## 当前快照

- 分支：`feature/review_questions`。
- HEAD：`fb4d8a830d04d4935dc2f076fcc05b9a4b636893`。
- 审查开始时工作树：755 个变更路径，其中 588 `M`、119 `A`、39 `D`、7 `MM`、1 `AM`、1 `R`。
- `docs/current-implementation/verification-2026-07-07.md` 的历史全绿结果不能认证本次工作树。

## 当前基础门禁

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `pnpm lint` | 失败，exit 1 | `examples/vanilla/src/main.ts:26,29,31,34` 的注释违反当前 comment lint。 |
| `pnpm typecheck` | 失败，exit 2 | `examples/vanilla/src/main.ts:133` 赋给 `window.__jwordDemo` 的对象缺 `selectTextRange`、`native`。类型契约见 `examples/vanilla/src/vite-env.d.ts:52-111`。 |
| `pnpm test:types` | 通过，exit 0 | 只能证明类型 fixture 可编译，不证明 Quickstart/runtime/tarball 可用。 |
| focused file-budget Vitest | 失败 | 18 tests 中 16 通过、2 失败；core 和 toolbar 文件预算均有超限。 |

文件预算失败项：

- `packages/core/src/layout/query.ts`：门禁计数 1039，预算 1000。
- `packages/core/test/editor/runtime.test.ts`：门禁计数 1060，预算 1000。
- `packages/ui/src/toolbar/controller.ts`：门禁计数 1003，Phase 5 预算 400。

这不是“代码风格不够漂亮”而已：当前仓库自己定义的必过门禁已经失败，所以当前 checkout 不能被标记为 release candidate。

### 2026-07-10 最新 typecheck 复验

再次执行根 `pnpm typecheck` 仍失败，exit 2，共 32 个错误。最新错误不再是 `main.ts` 对象缺字段，而是 `examples/vanilla/tests` 中的测试与辅助代码把 `window.__jwordDemo` 的可选成员当作必选调用：

- 18 处 `TS2722`，主要调用可选的 `selectTextRange`。
- 14 处 `TS18048`，均为 `native` 可能为 `undefined`。
- 错误分布于 `gate3-input-helpers.ts`、`gate3-input-selection.e2e.ts`、`gate3-toolbar-helpers.ts`、多个 Gate 4 E2E/visual/perf 文件和 `gate4_5-native.e2e.ts`。

当前第一实施批次只修复这一契约并复跑根 `pnpm typecheck`；lint 和文件预算不与该小批次混改，保留到完整 RC 门禁。

## Release dry-run 假绿

证据等级：运行复现。

`node tools/release/gate7-release-dry-run.mjs` 返回 exit 0、`status: ok`、12 个包 `failures: []`。但脚本只检查 manifest、dist 文件存在和 `npm pack --dry-run` 文件列表：`tools/release/gate7-release-dry-run.mjs:70-146`，没有验证产物新鲜度、Node ESM 可导入性或源码/产物一致性。

同一工作树的真实结果是：

- `node tools/release/normalize-dist-relative-imports.mjs --check`：exit 1，大量 core dist import 仍缺 `.js` 或 `/index.js` 后缀。
- `node --input-type=module -e "import('./packages/core/dist/index.js')"`：exit 1，`ERR_MODULE_NOT_FOUND`，无法解析 `packages/core/dist/canvas/pool`。

因此 dry-run 的名字和成功状态容易被误读。它应至少增加：

1. 可选 `--build` 必须在干净 RC 上执行，并记录 artifact hash。
2. 对每个 Node 入口执行真实动态 import。
3. 对声明文件执行第三方 TypeScript consumer。
4. 校验 source mtime/hash 与 dist 对应，或只从同一 CI job 的 fresh build 消费。
5. 只有上述步骤成功才输出 release-ready；`npm pack --dry-run` 单独命名为 pack-contents check。

## 第三方 no-alias smoke 当前失败

证据等级：运行复现。

`node tools/release/check-gate7-third-party-smoke.mjs` exit 1，临时项目安装阶段出现 `ERR_PNPM_FETCH_404`，尝试从 registry 获取 `@4xian/jword-core`/`@4xian/jword-persistence` 等未发布包。

脚本把 overrides 写入 `pnpm-workspace.yaml`，注释说明为 pnpm v10+ 行为：`tools/release/check-gate7-third-party-smoke.mjs:142-192`；仓库和 CI 固定 pnpm 9.14.2：`package.json:6`、`.github/workflows/ci.yml:24-28`。结果是传递 workspace 依赖没有稳定指向本地 tarball。

安装失败发生在 typecheck、Vite build 和 Chromium smoke 之前，所以当前没有第三方消费证据。需要在仓库锁定的 pnpm 版本上，用受支持的 `pnpm.overrides`/workspace 配置或显式重写 tarball manifests 验证全部传递依赖。

## Quickstart 与测试盲点

Quickstart 的运行时问题没有被现有绿灯发现：

- `tests/architecture/gate7-free-quickstart.test.ts:47-88` 主要检查文档字符串和 compile-only fixture。
- `tests/types/gate7-free-quickstart.ts` 同样遗漏 `editor.mount()`。
- 第三方 browser smoke 实际运行 layout + PDF：`tools/release/check-gate7-third-party-smoke.mjs:282-352`；React/Vue 主要出现在类型导入中，没有真实 mount 和编辑：`tools/release/check-gate7-third-party-smoke.mjs:430-482`。
- React/Vue SSR 测试只调用 renderToString：`packages/react/test/react-ssr.test.ts:16-24`、`packages/vue/test/vue-ssr.test.ts:16-24`，没有 hydration 测试。服务端属性是 `ssr`，客户端首渲染是 `client`，应标为风险/缺测试，不能直接断言已发生 mismatch。

一个有效的客户接入 smoke 应从本地 tarball 安装开始，实际执行：

`createJWord({ host }) -> 输入 -> selection/format -> save .jword -> load -> 资源重开 -> destroy`

默认消费者 smoke 不手动创建 toolbar/status/a11y Host；这些由 EditorShell 内部装配。测试分别覆盖 vanilla、React、Vue、Node ESM、CSS export、worker/CSP 和一个窄屏 viewport，高级 slots 单独作为 advanced interface 验证。

## CI 评价

`.github/workflows/ci.yml:12-57` 已包含 lint、typecheck、unit、build、三浏览器 E2E、视觉、benchmark 和 size，覆盖面值得保留。但当前有两类问题。

### 缺失的发布门禁

CI 没有明确运行：

- `pnpm test:types`
- `pnpm audit --prod`
- release dry-run
- 第三方 no-alias tarball smoke
- fresh build 后的 Node ESM import smoke
- 兼容/benchmark/视觉证据 artifact 上传与 SHA 绑定

### 成本与反馈速度

- `pnpm test` 通过 `pretest` 先 build，CI 随后又单独 `pnpm build`，`pnpm size` 还会再次 build。
- 全浏览器 E2E、视觉、benchmark 和 size 都在单一 PR job 串行执行。
- 没有显式 dependency cache、并发取消或按变更范围分层。

建议拆成 fast required gates、package/runtime matrix、release consumer、nightly long matrix；共享一次 fresh build artifact，长矩阵绑定同一 SHA。优化 CI 不能以删除关键浏览器和性能证据为代价。

## 发布元数据尚未完成

`docs/current-implementation/release-metadata-audit.md:10-16,76-84` 已明确记录：

- 12 个包均为 `private: true`。
- 根和包版本均为 `0.0.0`。
- package manifest 未统一声明 license metadata。
- registry、token、2FA、provenance、dist-tag、rollback 和 changeset 仍需确认。

这份文档本身的结论是谨慎的，但 `status: ok` dry-run 不能覆盖这些人工阻断。真实发布前还需要 SBOM、第三方 license 清单、签名/provenance、弃用和安全响应策略。

## 运维就绪度

当前 collab server 更接近 SDK 样板：

- HTTP 与 WebSocket 是两个独立 server/入口。
- Docker 默认只启动 HTTP 和 volatile history。
- Hocuspocus 没有文档 load/store adapter。
- rate limit、锁和默认 history 都是单进程内存实现。
- logger 只是可选 hook，没有规定 metrics、trace、audit schema 和告警。
- 没有数据库 migration、备份恢复、HA、容量、配额、优雅停机、灾难恢复演练或 runbook 证据。

所以“有 Dockerfile”和“有 health endpoint”不能等同于生产可运维。生产交付物应包括镜像、配置 schema、secret 管理、迁移、readiness/liveness、metrics、backup/restore 演练和版本兼容矩阵。

## 代码可维护性

正向方面：目录职责较明确，核心写路径和架构测试较多，小文件拆分已有持续动作。

主要风险：

- UI 组合文件仍在 846-1548 行区间，部分门禁已经失败。
- `packages/docx/src/export.ts` 975 行、`packages/persistence/src/index.ts` 987 行，也接近项目约束上限。
- 多个“架构测试”检查文本、文件存在或行数，适合作为护栏，但不能替代行为/消费测试。
- 公共 API 仍暴露内部 Gate 过程名，如 `GATE5_FORMAT_FEATURES`、`GATE6_COLLAB_FEATURES`、`gate6-collab-v1`：`packages/license/src/index.ts:18-37`、`packages/collab-server/src/index.ts:77-81`。
- `snapshotStorage?: unknown` 只存在于公开 options 声明：`packages/collab-server/src/index.ts:99-112`，是没有实现的扩展点。
- React/Vue peerDependencies 锁定精确 patch：`packages/react/package.json:31-34`、`packages/vue/package.json:31-33`，对企业宿主兼容范围过窄。

建议在 1.0 前清理内部 Gate 命名、未实现 option 和过宽 DOM API；不要在 1.0 后背负这些兼容债务。

## 本轮未执行的命令

未运行完整 `pnpm build`、`pnpm test`、全量 E2E、visual、bench 和 size。原因是当前 typecheck 已失败，且 `pnpm test` 会先 build 并改写现有 `dist`；在包含大量用户改动的工作树中，本轮保持只读审查。

这些未执行项必须标记为未知，不能沿用 2026-07-07 结果写成当前通过。
