# JWord Free Quickstart

Gate 7 Step 7.4 免费基础版 quickstart。本文只使用 `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` 三个免费基础包入口；更完整的导出面见 [`public-api.md`](./public-api.md)，可编译版本见 `tests/types/gate7-free-quickstart.ts`。

## 安装

```bash
pnpm add @4xian/jword-core @4xian/jword-ui @4xian/jword-native
```

## 初始化 editor 和 UI

```ts
import { createEditor } from '@4xian/jword-core'
import { createJWordUi } from '@4xian/jword-ui'

const editorHost = document.querySelector('#editor') as HTMLElement
const toolbarHost = document.querySelector('#toolbar') as HTMLElement

const editor = createEditor({
  initialText: '第一段内容'
})

createJWordUi({
  editor,
  editorHost,
  toolbarHost
})
```

## 基础编辑

```ts
editor.createDocument({
  text: '可以继续编辑的正文'
})
```

公开 quickstart 只通过 `Editor` facade 写入内容；不要直接改写内部文档容器或 provider 状态。

## 保存 `.jword`

```ts
import { saveJWordDocument } from '@4xian/jword-native'

const saved = await saveJWordDocument(editor, {
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

editor.loadDocumentModel({
  document: opened.document
})

editor.createDocument({
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
