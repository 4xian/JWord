# @4xian/jword-persistence

Gate 6 persistence 包提供协作历史、snapshot、preview、restore 和离线恢复 adapter 契约。第三方宿主只应从包入口导入公开 API，不依赖 `src` 路径或 demo runtime。

## Public API

```ts
import {
  createMemoryPersistenceAdapter,
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'

const historyStorage = createVolatileHistoryStorage()
const persistence = createStoragePersistenceAdapter({
  storage: historyStorage
})

await persistence.appendUpdate({
  documentId: 'doc-a',
  update: yjsUpdate,
  label: 'initial'
})
```

## Boundaries

- 包发布内容只包含 `dist`、`README.md` 和 package metadata。
- persistence 只保存 Yjs binary update、snapshot 和版本 metadata，不保存 projection JSON。
- IndexedDB adapter 只用于浏览器离线恢复；服务端历史存储由宿主注入。
- preview 与 restore 必须使用隔离 `Y.Doc`，避免污染 live collaboration doc。
