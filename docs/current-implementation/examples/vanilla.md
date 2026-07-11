# Vanilla 示例当前实现摘要

## 默认示例做什么

`examples/vanilla` 是单 Host EditorShell 的最小浏览器集成。页面只提供一个专用空根元素 `#jword`，`src/main.ts` 只调用 `createJWord({ host })`，由 UI package 内部创建 toolbar、editor 和 status bar，在 editor 区域管理普通面板，复用 core editor 的辅助技术节点，并通过一个 `destroy()` 统一释放资源。

默认示例不接入 media、table、native、devtools、Gate fixture 或浏览器测试 bridge，也不直接调用 `createEditor()`、`editor.mount()` 或 `createJWordUi()`。

## 依赖与入口

默认运行依赖只有：

- `@4xian/jword-ui`

`@4xian/jword-core`、`@4xian/jword-native` 和 `@4xian/jword-devtools` 仅供 `tests/fixtures` 下的历史 Gate 场景使用，因此列为开发依赖。

真实入口：

- 默认页面：`examples/vanilla/index.html`
- 默认浏览器入口：`examples/vanilla/src/main.ts`
- 默认页面样式：`examples/vanilla/src/styles.css`
- Playwright 专用页面：`examples/vanilla/test-fixture.html`
- 测试场景模块：`examples/vanilla/tests/fixtures/*`
- Vite 配置：`examples/vanilla/vite.config.ts`

## 默认集成

```ts
import { createJWord } from '@4xian/jword-ui'

const host = document.querySelector<HTMLElement>('#jword')

if (host === null) {
  throw new Error('JWord vanilla example requires #jword.')
}

const jword = createJWord({ host })
```

默认根节点直属区域顺序固定为 toolbar、editor、status bar，布局使用纵向 flex，不使用 grid 或 `gap`。

EditorShell 完成全部 UI 装配后会自动聚焦 core 输入层。`initialFocusPosition` 保留 `start` / `end` 配置；默认值为 `end`，因此 vanilla 默认页面加载后光标直接落在文档尾部。

## 测试夹具边界

Gate 2/3/4/7 的复杂媒体、表格、native、devtools 和性能场景继续保留，但只通过 `/test-fixture.html` 加载。测试专用 bridge 为 `window.__jwordTestFixture`，不进入默认页面、SDK interface 或客户文档。

## 命令

```bash
pnpm --filter @4xian/jword-example-vanilla dev
pnpm --filter @4xian/jword-example-vanilla typecheck
pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts --project=chromium
```

根命令 `pnpm dev` 当前也会委托到 vanilla 示例。

## 当前限制

- 这是 monorepo 开发示例，Vite alias 指向 workspace 源码，不等同外部 no-alias/tarball 消费验证。
- 默认示例只证明免费基础编辑与单 Host 装配；高级格式、native、协作和授权不属于该页面。
- 复杂 Gate 夹具用于回归测试，不是客户集成示例或稳定 SDK API。
