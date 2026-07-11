# JWord Vanilla Example

当前 `examples/vanilla` 是 JWord 单 Host EditorShell 的最小集成示例。

## Current Scope

- 页面只提供一个专用空根元素 `#jword`。
- `src/main.ts` 只调用 `createJWord({ host })`，不手动 mount editor、toolbar、status bar 或辅助技术 Host。
- 默认示例不接入 media、table、native、devtools 或浏览器测试桥接。
- 复杂 Gate 场景只存在于 `tests/fixtures`，不进入默认构建入口或客户 interface。

## Current Responsibilities

- [examples/vanilla/index.html](/Users/jian/Desktop/tools/JWord/examples/vanilla/index.html:1)：只声明 `#jword` 根元素。
- [examples/vanilla/src/main.ts](/Users/jian/Desktop/tools/JWord/examples/vanilla/src/main.ts:1)：只创建和销毁 EditorShell。
- [examples/vanilla/src/styles.css](/Users/jian/Desktop/tools/JWord/examples/vanilla/src/styles.css:1)：只提供页面尺寸和画布背景。
- [examples/vanilla/test-fixture.html](/Users/jian/Desktop/tools/JWord/examples/vanilla/test-fixture.html:1)：仅供 Playwright 使用的复杂场景入口。
- [examples/vanilla/tests/fixtures](/Users/jian/Desktop/tools/JWord/examples/vanilla/tests/fixtures)：Gate 场景适配器和测试专用 bridge，不被默认页面加载。

## 默认集成

```ts
const jword = createJWord({
  host: document.querySelector('#jword')!
})

jword.destroy()
```

低层 `createEditor() + createJWordUi()` 继续作为高级接口，但不是本示例的默认路径。

## Commands

```sh
pnpm --filter @4xian/jword-example-vanilla dev
pnpm --filter @4xian/jword-example-vanilla build
pnpm --filter @4xian/jword-example-vanilla typecheck
```
