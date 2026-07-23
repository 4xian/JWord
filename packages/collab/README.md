# @4xian/jword-collab

Gate 6 商业协作 client 包只暴露浏览器公开 API。客户应用安装基础包、协作高级包和所需浏览器依赖，再由自己的 editor facade 传入协作 SDK；self-host 服务端由客户运维侧部署 JWord 版本化 Docker 镜像，不在应用代码中安装 server package。

## Public API

```ts
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
const connection = await connectJWordCollaboration(editor, {
  serverUrl: 'https://collab.example.test',
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
- 客户应用只使用 `connectJWordCollaboration()`、浏览器 provider adapter、`GATE6_COLLAB_FEATURES` 和已部署的 HTTP/WSS endpoint，不导入服务端 npm package。
- 自动插入必须传入显式 `position` 或 `range`，不得默认读取 live caret。
- 历史版本通过 `connection.history.recordVersion()`、`listVersions()`、`previewVersion()` 和 `restoreVersion()` 接入。
- 未授权失败必须先返回 diagnostics，再阻止 provider 连接或 server 写入。协作 client 原样传播 license 层的 `JWORD_*` 稳定诊断 code。

## Smoke

Gate 6 smoke 只读取 B4 canonical builder 产生并下载的 run-a manifest/binding，不重新打包 server package；该结果不代表客户应从 npm 集成服务端，也不等于 LIC-309 正式镜像验收。

```sh
: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"
node tools/release/check-gate6-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"
```
