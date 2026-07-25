# 免费 Quickstart 当前实现摘要

## 对应文档

- `docs/sdk/quickstart.md`
- `tests/types/gate7-free-quickstart.ts`
- `tests/architecture/gate7-free-quickstart.test.ts`

## 覆盖能力

Quickstart 只覆盖免费基础包：

- `@4xian/jword-core`：`createEditor()`、Editor facade、基础编辑写入。
- `@4xian/jword-ui`：`createJWordUi()` 挂载官方 DOM UI。
- `@4xian/jword-native`：`saveJWordDocument()`、`loadJWordDocument()` 保存/打开 `.jword`。

## 实现路径

- editor 状态写入通过 core `Editor` facade，不直接访问 Y.Doc store。
- UI 挂载由 `packages/ui/src/index.ts` 暴露的 `createJWordUi()` 负责，toolbar/assistive/live-region 都在 UI 包内完成。
- `.jword` 保存/打开由 native 包读取 editor projection 并打包 manifest/document/metadata/checksum/resource entries。

## 验证命令

```bash
pnpm test:types
pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose
```

## 当前限制

- Quickstart 不覆盖 DOCX/PDF、协作、服务端、授权门户和真实发布。
- 示例默认是浏览器宿主；SSR 只由 React/Vue wrapper 的测试覆盖。
