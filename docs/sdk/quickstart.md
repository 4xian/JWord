# JWord Free Quickstart

Gate 7 Step 7.4 免费基础版 quickstart。本文只使用 `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` 三个免费基础包入口；更完整的导出面见 [`public-api.md`](./public-api.md)，可编译版本见 `tests/types/gate7-free-quickstart.ts`。

## 安装

```bash
pnpm add @4xian/jword-core @4xian/jword-ui @4xian/jword-native
```

## 初始化 JWord

```ts
import { createJWord } from '@4xian/jword-ui'

const host = document.querySelector<HTMLElement>('#jword')

if (host === null) {
  throw new Error('JWord requires #jword.')
}

const jword = createJWord({
  host,
  editor: {
    initialText: '第一段内容'
  }
})
```

页面只需要一个专用空根元素：`<div id="jword"></div>`。JWord 会在内部依次创建 toolbar、editor 和 status bar，在 editor 区域管理普通面板，并统一管理辅助技术节点和销毁生命周期。

EditorShell 初始化完成后会自动聚焦编辑器。不配置时，折叠光标默认位于文档尾部；如需首次聚焦到文档头部，可传入 `editor: { initialFocusPosition: 'start' }`。

## 基础编辑

```ts
jword.editor.createDocument({
  text: '可以继续编辑的正文'
})
```

公开 quickstart 只通过 `Editor` facade 写入内容；不要直接改写内部文档容器或 provider 状态。

## 保存 `.jword`

```ts
import { saveJWordDocument } from '@4xian/jword-native'

const saved = await saveJWordDocument(jword.editor, {
  requestId: 'quickstart-save-1'
})

const packageBlob = saved.blob
```

## 打开 `.jword` 并继续编辑

```ts
import { loadJWordDocument } from '@4xian/jword-native'

const opened = await loadJWordDocument(packageBlob, {
  requestId: 'quickstart-load-1'
})

jword.editor.loadDocumentModel({
  document: opened.document
})

jword.editor.createDocument({
  text: '重新打开后继续编辑'
})
```

## 基础错误处理

```ts
import { JWordError } from '@4xian/jword-core'
import { JWordNativePackageError } from '@4xian/jword-native'

try {
  await loadJWordDocument(packageBlob, {
    requestId: 'quickstart-load-2'
  })
} catch (error) {
  if (error instanceof JWordNativePackageError) {
    console.error(error.code, error.recoverable)
  } else if (error instanceof JWordError) {
    console.error(error.code, error.message)
  } else if (error instanceof Error) {
    console.error(error.message)
  }
}
```

基础错误处理只展示稳定 `code`、`message`、`recoverable` 和 `requestId`，不要记录用户正文或原始二进制内容。

## 销毁

```ts
jword.destroy()
```

普通集成只调用一次 `destroy()`。需要分别控制 editor 与 UI 宿主的场景可使用高级接口 `createEditor() + createJWordUi()`，但不属于默认接入路径。
