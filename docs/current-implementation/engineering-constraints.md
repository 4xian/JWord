# JWord 工程硬约束证据审计

> 快照日期：2026-07-07。
> 本文只基于当前源码、manifest、测试、工具脚本和 SDK 文档建立约束到证据的索引。它不是需求计划，也不引用历史实施资料。

## 结论

当前仓库已经具备一组可自动核对的工程约束：包导出边界、core 框架无关边界、依赖版本、注释语言、diagnostics registry、release dry-run 和 no-alias smoke 均有脚本或架构测试入口。

仍需人工或后续任务确认的点：真实 registry 发布审批、屏幕阅读器人工矩阵、Microsoft Word 桌面兼容矩阵（DOCX / DOC 边界）、完整长耗时浏览器/视觉/性能 fresh run。

## 包与示例清单

### 当前 packages

| 包 | Edition | 当前发布状态 | 主要约束证据 |
| --- | --- | --- | --- |
| `@4xian/jword-core` | free | `private: true` | `packages/core/package.json`、`tests/architecture/core-boundary.test.ts`、`tests/architecture/gate7-api-export-audit.test.ts` |
| `@4xian/jword-ui` | free | `private: true` | `packages/ui/package.json`、`tests/architecture/gate7-api-export-audit.test.ts` |
| `@4xian/jword-native` | free | `private: true` | `packages/native/package.json`、`tests/architecture/gate7-worker-capability.test.ts` |
| `@4xian/jword-docx` | paid format | `private: true` | `packages/docx/package.json`、`tests/architecture/gate5-diagnostics-schema.test.ts` |
| `@4xian/jword-pdf` | paid format | `private: true` | `packages/pdf/package.json`、`tests/architecture/gate5-pdf-file-budget.test.ts` |
| `@4xian/jword-license` | paid entitlement | `private: true` | `packages/license/package.json`、`packages/license/test/entitlement.test.ts` |
| `@4xian/jword-persistence` | free base / paid collab | `private: true` | `packages/persistence/package.json`、`packages/persistence/test/*` |
| `@4xian/jword-collab` | paid collaboration | `private: true` | `packages/collab/package.json`、`tests/architecture/gate6-package-exports.test.ts` |
| `@4xian/jword-collab-server` | paid collaboration | `private: true` | `packages/collab-server/package.json`、`tests/architecture/gate6-commercial-readiness.test.ts` |
| `@4xian/jword-devtools` | free developer tooling | `private: true` | `packages/devtools/package.json`、`packages/devtools/test/devtools.test.ts` |
| `@4xian/jword-react` | wrapper | `private: true` | `packages/react/package.json`、`tests/architecture/gate7-react-wrapper.test.ts` |
| `@4xian/jword-vue` | wrapper | `private: true` | `packages/vue/package.json`、`tests/architecture/gate7-vue-wrapper.test.ts` |

### 当前 examples

| 示例 | 当前状态 | 入口 |
| --- | --- | --- |
| `examples/vanilla` | `private: true` | `pnpm --filter @4xian/jword-example-vanilla dev` |
| `examples/docx` | `private: true` | `pnpm --filter @4xian/jword-example-docx dev` |
| `examples/collab` | `private: true` | `pnpm --filter @4xian/jword-example-collab dev` + `dev:server` |
| `examples/react` | `private: true` | `pnpm --filter @4xian/jword-example-react dev` |
| `examples/vue` | `private: true` | `pnpm --filter @4xian/jword-example-vue dev` |
| `examples/vue2` | `private: true` | `pnpm --filter @4xian/jword-example-vue2 dev` |

## 约束到证据索引

| 约束 | 当前实现事实 | 自动化/文档证据 | 状态 |
| --- | --- | --- | --- |
| Node / pnpm 固定 | 根 manifest 约束 Node `>=20.19.0`，`packageManager` 为 `pnpm@9.14.2`。 | `package.json`、`tools/lint/check-package-versions.mjs` | 已有脚本 |
| 依赖版本精确 | 外部依赖必须精确 semver；内部包依赖必须使用 `workspace:`。 | `tools/lint/check-package-versions.mjs`、`pnpm lint` | 已有脚本 |
| 包导出只走 dist | 公开包 `main`、`module`、`types` 均指向 `./dist/*`；export map 不暴露 `src`。 | `tests/architecture/gate7-api-export-audit.test.ts`、`tests/architecture/gate7-release-readiness.test.ts` | 已有测试 |
| 第三方不得导入源码路径 | 类型 fixture 只从 package 根入口、`./worker`、`./experimental` 或 `./styles.css` 等公开入口导入。 | `tests/types/gate7-public-api-entrypoints.ts`、`tests/types/gate7-public-api-examples.ts`、`pnpm test:types` | 已有测试 |
| release dry-run 不 publish | 发布演练脚本只执行 pack dry-run 和报告输出，显式声明 `publish: not-run`。 | `tools/release/gate7-release-dry-run.mjs`、`tests/architecture/gate7-release-readiness.test.ts` | 已有脚本 |
| no-alias 外部消费 | 第三方 smoke 从本地 tarball 安装，不使用 examples 或 workspace 源码 alias。 | `tools/release/check-gate7-third-party-smoke.mjs`、`docs/sdk/stable-e2e-matrix.md` | 已有脚本，发布前需 fresh run |
| core 框架无关 | core 顶层不得导入 UI、DOCX、PDF、collab provider、Vite、Playwright 等包。 | `tools/lint/core-boundary-policy.json`、`tools/lint/check-boundaries.mjs`、`tests/architecture/core-boundary.test.ts` | 已有脚本/测试 |
| core 顶层无 DOM 访问 | core 顶层不得直接访问 `window`、`document`、`HTMLElement`、`Worker`、`Image` 等浏览器全局。 | `tools/lint/core-boundary-policy.json`、`tests/architecture/core-boundary.test.ts` | 已有测试 |
| core 文件预算 | core 源码和测试纳入文件行数预算，避免回到大文件。 | `tests/architecture/core-file-budget.test.ts` | 已有测试 |
| 代码文件头与中文注释 | `.ts`、`.tsx`、`.js`、`.mjs` 文件头说明职责/边界等；注释不使用长英文 prose。 | `tools/lint/check-comments.mjs`、`pnpm lint:comments` | 已有脚本 |
| diagnostics registry 单一真源 | 公开诊断码集中登记，派生 SDK 文档和 core 摘要。 | `fixtures/collab/diagnostics-registry.json`、`tools/diagnostics/generate-diagnostics-artifacts.mjs`、`tests/architecture/gate7-diagnostics-registry.test.ts` | 已有脚本/测试 |
| support bundle 隐私裁剪 | support bundle 和 diagnostics snapshot 不包含正文、token、license private key、secret。 | `docs/sdk/support-bundle.md`、`packages/core/test/editor/observability.test.ts` | 已有文档/测试 |
| browser support 公开口径 | 桌面最低版本与窄屏适配边界由 SDK 文档记录。 | `docs/sdk/browser-support.md`、`tests/architecture/gate7-browser-support.test.ts` | 已有文档/测试 |
| stable / experimental / internal 分级 | 公开 API 分级集中记录，插件和 observability 当前仍是 experimental。 | `docs/sdk/public-api.md`、`docs/current-implementation/api-stability-review.md` | 已补审计 |
| 所有包仍未真实发布 | 所有 package manifest 当前 `private: true`；任何真实 publish 需人工审批。 | `packages/*/package.json`、`docs/current-implementation/release-metadata-audit.md` | 已补审计 |

## 当前缺口与处理位置

| 缺口 | 是否阻断当前代码运行 | 处理位置 |
| --- | --- | --- |
| 真实 registry publish | 不阻断本地构建测试；阻断对外发布宣称。 | `docs/current-implementation/release-metadata-audit.md` |
| 屏幕阅读器人工验证 | 不阻断自动化；阻断 a11y 人工通过宣称。 | `docs/current-implementation/backlog.md#jw-backlog-001屏幕阅读器人工验证矩阵` |
| Microsoft Word 桌面兼容（DOCX / DOC 边界） | 不阻断 Open XML 自动检查；阻断完整 Word 桌面兼容宣称；`.doc` 不是当前 SDK 直接读写能力。 | `docs/current-implementation/backlog.md#jw-backlog-002microsoft-word-桌面兼容证据docx--doc-边界` |
| 长耗时 full matrix fresh run | 不阻断文档落地；发布前必须重新执行。 | `docs/current-implementation/verification-2026-07-07.md` |

## 维护规则

- 新增包：先补 `packages/<name>/package.json` export map，再补 current-implementation 包摘要、public API 文档、类型测试和 release dry-run 包清单。
- 新增公开 API：先确认 stable / experimental / internal 分级，再同步 `docs/sdk/public-api.md`、类型测试和 package export audit。
- 新增诊断码：先改 `fixtures/collab/diagnostics-registry.json`，再运行 diagnostics 生成脚本并更新 SDK 文档。
- 新增或调整页面元素、toolbar、状态栏、弹窗、下拉菜单、按钮、图标、提示、可见文案或可见样式时，必须同步评估 i18n 与主题切换影响；若有影响，需补齐 `zh-CN` / `en-US` 语言数据、aria/live region 文案，以及亮色/暗色主题下的颜色、背景、hover、focus、disabled、overlay 等样式。
- 新增工程约束：必须指向源码、manifest、脚本、测试或 SDK 文档中的当前证据；没有证据的约束进入 backlog，不写成已满足事实。
