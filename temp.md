### 1. 完全完成
  这些我认为可以改成计划里的已完成：

- Step 3.1 mount lifecycle
    证据： packages/core/src/editor.ts:777, packages/core/src/editor.ts:897
- Step 3.2 hidden textarea 第一版
    证据： packages/core/src/editor.ts:2463, packages/core/test/editor-input.test.ts:20
- Step 3.5 pointer selection
    证据： packages/core/src/editor.ts:1690, packages/core/test/editor-input.test.ts:192
- Step 3.6 clipboard plain text
    证据： packages/core/src/editor.ts:1644, packages/core/test/editor-input.test.ts:265
- Step 3.8 toolbar 第一版
    证据： examples/vanilla/src/main.ts:494, examples/vanilla/tests/gate3-toolbar.e2e.ts:14
- Step 3.10 aria-live 和隐藏文本镜像第一版
    证据： packages/core/src/editor.ts:2488, examples/vanilla/src/main.ts:578, examples/vanilla/tests/gate3-
    toolbar.e2e.ts:14
- Step 3.11 基础错误恢复
    证据： packages/core/src/editor.ts:1753, packages/core/test/editor-input.test.ts:100

### 2. 部分完成
  这些不能直接勾完成，只能记为部分完成：

- Step 3.3 composition handler
    已有 composition start/update/end 和 transaction 提交，但没有 Chrome/Safari/Firefox、macOS/Windows 的真实差异覆
    盖。
    证据： packages/core/src/editor.ts:1526, packages/core/test/editor-input.test.ts:61
- Step 3.4 keyboard handler
    已有输入、删除、回车、左右方向、撤销重做、B/I 快捷键；但没有上下方向、Home/End 等完整导航。
    证据： packages/core/src/editor.ts:1569
- Step 3.7 基础 commands
    core 的 builder 基本齐了，但 demo 只接通了 B/I，其余格式能力还没接到用户可操作面。
    证据： packages/core/src/command-builders.ts:22, examples/vanilla/src/main.ts:317, examples/vanilla/src/
    main.ts:463
- Step 3.9 toolbar 状态同步
    core 的 formatting state 很完整，demo 也接了真实同步，但 UI 只消费了 B/I 和部分摘要，不是完整状态面板。
    证据： packages/core/src/formatting-state.ts:31, packages/core/test/editor-facade.test.ts:130, examples/vanilla/
    src/main.ts:231
- Step 3.12 Alpha E2E
    目前只有 toolbar/a11y/部分 undo-redo 的浏览器 E2E，缺 IME、键盘输入、剪贴板、真实鼠标选择。
    证据： examples/vanilla/tests/gate3-toolbar.e2e.ts:3, packages/core/test/editor-input.test.ts:192
- Step 3.13 Alpha 性能验证
    已有 examples/vanilla/tests/gate3.perf.e2e.ts:29，但它测的是 Alpha 小样例 toolbar 闭环和复用的 Gate 2 滚动指标，
    不是 1-2 万字真实编辑热路径，也没接入默认 pnpm test:e2e。
    证据： examples/vanilla/tests/gate3.perf.e2e.ts:2, package.json:18

### 3. 明确未完成
  这些还不能当 Gate 3 已过：

- Gate 3 验收项整体未闭环，见 docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md:232
- “macOS 和 Windows 中文输入可用”没有足够证据
- “输入、删除、回车、方向键、选择、复制粘贴可用”缺真实浏览器闭环
- “加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进可用”缺完整用户面和 E2E
- “1-2 万字文档编辑不卡顿”缺真实 Gate 3 性能证据
- Gate 3 没有 visual 自动化证据
- 0.1-alpha 还不能宣布完成
- 确保修复scroll卡顿、输入卡顿、拖选卡死的问题
