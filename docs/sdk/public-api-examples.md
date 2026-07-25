# JWord Public API Examples

Gate 7 Step 7.3 最小公开接口示例。所有示例只从 package 入口导入，不依赖 monorepo 内部路径、provider 内部类型、worker helper 或 demo runtime。可编译版本见 `tests/types/gate7-public-api-examples.ts`，并由 `pnpm test:types` 验收。

## 免费基础版：单 Host EditorShell、原生保存

```ts
import { createEditor, createEditorSharedDocument, createTextInserter } from '@4xian/jword-core'
import { createJWord } from '@4xian/jword-ui'
import { saveJWordDocument, loadJWordDocument } from '@4xian/jword-native'
import { createMemoryPersistenceAdapter, createStoragePersistenceAdapter } from '@4xian/jword-persistence'

const jword = createJWord({
  host: document.querySelector('#jword')!,
  editor: { initialText: 'Hello JWord' }
})

const saved = await saveJWordDocument(jword.editor, { requestId: 'save-1' })
await loadJWordDocument(saved.blob, { requestId: 'load-1' })

const sharedDocument = createEditorSharedDocument()
const storage = createStoragePersistenceAdapter(createMemoryPersistenceAdapter())
const inserter = createTextInserter(createEditor(), { requestId: 'insert-1' })
inserter.abort('example-finished')
await storage.listVersions(sharedDocument.toString())
jword.destroy()
```

需要分别控制 editor 与 UI 宿主时，可使用高级接口 `createEditor() + createJWordUi()`；默认集成不需要手动 mount toolbar、status bar 或辅助技术 Host。

## Gate 5 高级格式：DOCX 和 PDF

```ts
import type { DocumentProjection } from '@4xian/jword-core'
import { importDocx, exportDocx } from '@4xian/jword-docx'
import { exportPdfFromLayout } from '@4xian/jword-pdf'
import { GATE5_FORMAT_FEATURES, assertJWordFeatureEntitled, type JWordLicenseEntitlement } from '@4xian/jword-license'

declare const entitlement: JWordLicenseEntitlement
declare const binaryInput: Blob
declare const projection: DocumentProjection
declare const layout: Parameters<typeof exportPdfFromLayout>[0]

assertJWordFeatureEntitled(entitlement, GATE5_FORMAT_FEATURES.docxImport)
const imported = await importDocx(binaryInput, { license: entitlement })
const exported = await exportDocx(projection, { license: entitlement })
const pdf = await exportPdfFromLayout(layout, { license: entitlement })
console.log(imported.warnings.length, exported.bytes.byteLength, pdf.bytes.byteLength)
```

## Gate 6 高级协同：浏览器 client 和 Docker endpoint

```ts
import { connectJWordCollaboration, createMemoryCollabProviderAdapter, GATE6_COLLAB_FEATURES } from '@4xian/jword-collab'
import type { JWordLicenseEntitlement } from '@4xian/jword-license'

declare const entitlement: JWordLicenseEntitlement
declare const editor: Parameters<typeof connectJWordCollaboration>[0]

const provider = createMemoryCollabProviderAdapter({
  documentId: 'doc-1',
  roomId: 'room-1',
  clientId: 'client-1'
})

const connection = await connectJWordCollaboration(editor, {
  serverUrl: 'https://collab.example.test',
  documentId: 'doc-1',
  roomId: 'room-1',
  user: { id: 'user-1', name: 'User 1' },
  token: 'demo-token',
  license: entitlement,
  features: [GATE6_COLLAB_FEATURES.multiplayer],
  provider
})
await connection.destroy()
```

生产 endpoint 由客户运维侧部署 JWord 版本化 Docker 镜像后提供。客户应用不安装、导入或嵌入 `@4xian/jword-collab-server`；当前内存 provider 仅用于展示公开 client options，真实 provider 接入按 Collaboration 文档执行。

## Diagnostics payload contract

公开诊断载荷的稳定字段来自 `docs/sdk/diagnostic-codes.md` 与 `JWordDiagnosticsSnapshot`：

- `code`：稳定诊断码，必须能在 `diagnostic-codes.md` 找到。
- `severity`：`warning` 或 `error`。
- `recoverable`：宿主是否可以通过重试、降级、重新授权或缩小 payload 恢复。
- `recommendedAction`：面向宿主的动作短语，不包含用户文档内容。
- `metadataTags`：诊断分类标签，例如 `authorization`、`worker`、`payload-limit`。
- `JWordDiagnosticsSnapshot.registry`：生成快照时使用的 registry 摘要。
- `JWordDiagnosticsSnapshot.privacy`：固定说明正文、字符串 details 和 details key 已裁剪。
- `JWordDiagnosticsSnapshot.plugins`：插件诊断只保留 `pluginName`、`code`、`lifecycle`、`commandName`、`reasonCode` 与 `recoverable`。

```ts
import type { JWordDiagnosticsSnapshot } from '@4xian/jword-core'

function readDiagnostics(snapshot: JWordDiagnosticsSnapshot): readonly string[] {
  return snapshot.plugins.map((entry) => `${entry.pluginName}:${entry.code}`)
}
```

Feature key handoff：Gate 5 使用 `GATE5_FORMAT_FEATURES`，Gate 6 使用 `GATE6_COLLAB_FEATURES`。授权失败时只返回稳定 `code` 与必要的 `feature`、`requestId`、`recoverable` 等结构化字段，不返回 `customerId`、token、signature 或用户文档内容。
