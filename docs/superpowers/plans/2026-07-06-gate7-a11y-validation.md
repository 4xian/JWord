# Gate 7 A11y 系统性验收清单（2026-07-06）

来源：`2026-07-02-plan-review.md` §2.4、修复计划 Phase 6 `[计划审查 2.4]`，以及 canonical specs `04-engineering-standards.md` §4.8 / `06-acceptance-and-testing.md` §6.7。

本清单用于把 Gate 4-6 新功能的 a11y 验收从零散属性断言提升为可复跑门禁。当前完成自动化 serious/critical 扫描；屏幕阅读器人工矩阵保留为 Gate 7 正式阶段人工复核项。

## 1. 自动化门禁

| 覆盖对象 | 自动化入口 | 当前断言 |
|---|---|---|
| 共享 axe helper | `tests/e2e/a11y-axe.ts` | 向页面注入 `axe-core`，默认阻断 serious / critical violation |
| Gate 4 表格 | `examples/vanilla/tests/gate4-a11y.e2e.ts` | 表格自定义尺寸 dialog 可被 axe 扫描，无 serious / critical violation |
| Gate 4 批注 | `examples/vanilla/tests/gate4-a11y.e2e.ts` | 批注草稿输入可被 axe 扫描，无 serious / critical violation |
| Gate 4 查找替换 | `examples/vanilla/tests/gate4-a11y.e2e.ts` | 查找替换面板可被 axe 扫描，无 serious / critical violation |
| Gate 6 协作光标 | `examples/collab/tests/collab-a11y.e2e.ts` | 远端光标 / 远端选区 / 状态面板可被 axe 扫描，无 serious / critical violation |
| 架构护栏 | `tests/architecture/gate7-a11y-e2e.test.ts` | 锁定 `axe-core` devDependency、helper 和 Gate 4-6 E2E 覆盖文件 |

## 2. 本次修复消除的自动化红灯

1. Vanilla 初始 editor：`axe-core` 报 `color-contrast`，原因是 toolbar empty select label 使用 `#9aa3af`，与白色背景对比不足；已调整为 `#64748b`。
2. Vanilla editor viewport：`axe-core` 报 `scrollable-region-focusable`，原因是可滚动 canvas container 不可聚焦；已补 `role="region"`、`aria-label`、`tabIndex=0`，并把焦点转交给隐藏输入层。
3. Collab 远端选区：`axe-core` 报 `color-contrast`，原因是协作用户色作为背景时白色文字不一定达标；已按用户色自动选择黑/白文字。
4. Collab debug pre：`axe-core` 报 `scrollable-region-focusable`，原因是可滚动 JSON debug 区不可聚焦；已补 `tabindex="0"` 和稳定 `aria-label`。

## 3. 手动复核矩阵

| 场景 | 人工检查点 | 当前状态 |
|---|---|---|
| 表格 keyboard navigation | Tab / Enter / Escape 能到达表格插入菜单、自定义尺寸输入、确认和取消按钮 | 待 Gate 7 人工复核 |
| 批注屏幕阅读器 | 新建批注、resolve/reopen 后能读出线程状态和输入框用途 | 待 Gate 7 人工复核 |
| 查找替换屏幕阅读器 | `Control+F` / `Control+H` 后焦点落点、结果数 live region 不刷屏 | 待 Gate 7 人工复核 |
| 协作光标 | 远端光标与远端选区有可读标签，断连/重连状态可读 | 自动化已覆盖标签与 serious/critical；屏幕阅读器朗读待人工复核 |
| 颜色对比 | toolbar、远端选区、状态面板满足 WCAG AA | serious/critical 自动化已覆盖当前 demo；完整主题矩阵待 Gate 7 theme 项继续 |

## 4. 验证命令

- `pnpm exec vitest run tests/architecture/gate7-a11y-e2e.test.ts`
- `pnpm exec playwright test examples/vanilla/tests/gate4-a11y.e2e.ts --project=chromium`
- `pnpm exec playwright test examples/collab/tests/collab-a11y.e2e.ts --project=chromium`
- `pnpm typecheck`
- `pnpm lint`
