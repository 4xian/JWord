# @4xian/jword-collab

Gate 6 商业协作 client 包只暴露公开 API。第三方宿主从空项目接入时，应先安装基础包、协作高级包、授权包和 self-host server 包，再由宿主自己的 editor facade 传入协作 SDK。

## Public API

```ts
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
import { createJWordCollabServer } from '@4xian/jword-collab-server'

const server = createJWordCollabServer({
  address: '127.0.0.1',
  port: 4188,
  featureFlags: Object.values(GATE6_COLLAB_FEATURES),
  licenseHook: ({ feature }) => ({
    ok: feature === GATE6_COLLAB_FEATURES.server || feature === GATE6_COLLAB_FEATURES.history,
    diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
  })
})

const state = await server.start()
const connection = await connectJWordCollaboration(editor, {
  serverUrl: state.httpUrl,
  documentId: 'doc-a',
  roomId: 'room-a',
  user: {
    id: 'user-a',
    name: 'Alice'
  },
  token: 'host-issued-token',
  license,
  features: [
    GATE6_COLLAB_FEATURES.multiplayer,
    GATE6_COLLAB_FEATURES.history,
    GATE6_COLLAB_FEATURES.autoInsert
  ],
  provider: createMemoryCollabProviderAdapter({
    documentId: 'doc-a',
    roomId: 'room-a',
    clientId: 'user-a'
  })
})

await connection.history.recordVersion({ label: 'initial' })
const session = connection.startAutoInsertSession({
  position: {
    anchor: hostCreatedAnchor
  }
})
session.write('协作内容')
```

## Boundaries

- 基础编辑器和 `.jword` 原生保存能力不依赖本包。
- 第三方宿主只使用 `connectJWordCollaboration()`、`createMemoryCollabProviderAdapter()`、`GATE6_COLLAB_FEATURES` 和 self-host server 公开 API。
- 自动插入必须传入显式 `position` 或 `range`，不得默认读取 live caret。
- 历史版本通过 `connection.history.recordVersion()`、`listVersions()`、`previewVersion()` 和 `restoreVersion()` 接入。
- 未授权失败必须先返回 diagnostics，再阻止 provider 连接或 server 写入。license 层的 `JWORD_LICENSE_MISSING` 在协作 client 中归一为 `COLLAB_LICENSE_MISSING`。

## Smoke

仓库内的第三方空项目 smoke 脚本会从当前 workspace 打包基础包、高级包和 server 包，安装到临时空项目，并只通过公开 API 启动协作、自动插入、历史版本和未授权失败演示。

```sh
node tools/release/check-gate6-third-party-smoke.mjs
```
