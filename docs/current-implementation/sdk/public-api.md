# 公开 API 与导入边界当前实现摘要

## 对应文档

- `docs/sdk/public-api.md`
- `docs/sdk/public-api-examples.md`
- `tests/types/gate7-public-api-entrypoints.ts`
- `tests/types/gate7-public-api-examples.ts`
- `tests/types/gate7-free-quickstart.ts`

## 实际公开包

当前仓库有 12 个包入口：

- 免费基础：`@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native`。
- 高级格式：`@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-license`。
- 高级协作：`@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-persistence`。
- 集成扩展：`@4xian/jword-react`、`@4xian/jword-vue`、`@4xian/jword-devtools`。

所有包的 `exports` 都指向 `dist`，不公开 `src` 子路径。`docx`、`pdf`、`native` 额外公开 `./worker`；`collab` 额外公开 `./experimental`。

## API 分级实现

- stable：列在 `docs/sdk/public-api.md` 对应包小节内，且能从 package export map 或类型测试导入。
- experimental：当前主要包括 core plugin/decorations/observability 试用面、UI plugin extension、collab Hocuspocus adapter、IndexedDB adapter 行为。
- internal：provider 内部类型、Y.Doc store、worker helper、demo runtime、源码路径、具体 DOM/controller 实现。

## UI 当前公开能力摘要

- `@4xian/jword-ui` 根入口稳定导出 `createJWordUi()`、toolbar options/elements/tool ids、statusBar options/elements/item ids、页面水印 options、主题/i18n contract、media/table command adapter 和主要 panel controller。
- `createJWordUi({ editor, editorHost })` 默认装配专业 Tab toolbar 和底部 statusBar；显式 `statusBar: false` 才禁用状态栏。
- `JWordUiInstance.setTheme(...)` 与 `setLocale(...)` 是创建后动态刷新入口，会同步 toolbar、statusBar 和当前可见面板；首批内建语言为 `zh-CN` / `en-US`。
- `JWordUiInstance.setWatermark(...)`、`clearWatermark()`、`getWatermark()` 提供编辑器实例级页面水印；首轮不写入 core 文档模型、undo/redo、协作事务或导出包。
- toolbar 双模式和 statusBar 的 DOM/controller 内部实现仍属于 internal；宿主只应依赖公开 options、elements、tool/item id 和样式入口。

## 实现校验

- `tests/architecture/gate7-public-api-catalog.test.ts` 对照 package entry 和文档稳定符号。
- `tests/architecture/gate7-api-export-audit.test.ts` 锁定 export map 不暴露内部路径。
- `pnpm test:types` 使用独立 TypeScript fixture 模拟第三方只从 package 入口导入。
- `tools/release/check-gate7-third-party-smoke.mjs` 用本地 tarball 做 no-alias 验收。

## 当前限制

- 包未真实发布，仍需人工 release 审批。
- plugin/decorations/observability 当前有实现和文档，但不应直接宣称 1.0 stable，需要单独稳定化评审。
- 文档示例只能使用公开入口，不得复制 examples runtime 或内部 helper。
- `@4xian/jword-docx` 只提供 DOCX import/export；旧二进制 `.doc` 不是当前公开 API。
