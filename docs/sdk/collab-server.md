# @4xian/jword-collab-server self-host 部署

## 范围

`@4xian/jword-collab-server` 是 paid collaboration server package。第三方应安装正式 package 并调用公开 API，而不是复制 demo server 代码。

## 公开入口

```ts
import {
  createJWordCollabServer,
  startJWordCollabServer
} from '@4xian/jword-collab-server'
```

必须记录的 server API：`createJWordCollabServer()`、`startJWordCollabServer()`、`CreateJWordCollabServerOptions`、`JWordCollabServerState`。

## 最小 Node 启动

```ts
const server = createJWordCollabServer({
  port: 4017,
  authHook: async (context) => ({
    ok: true,
    userId: context.userId,
    role: 'write'
  }),
  tenantHook: async (context) => ({
    ok: true,
    tenantId: context.tenantId
  }),
  licenseHook: async () => ({ ok: true })
})

await startJWordCollabServer(server)
```

## Hooks

| Hook | 作用 | 失败口径 |
|---|---|---|
| `authHook` | 校验用户身份和 room/document 权限 | `COLLAB_AUTH_FAILED` 或 `COLLAB_PERMISSION_DENIED` |
| `tenantHook` | 校验 tenant/document 隔离 | tenant mismatch 必须拒绝 |
| `licenseHook` | 校验 collaboration/server feature entitlement | license denied 必须阻断写入 |
| `storage hook` | 接入 history/offline 存储 | storage missing 返回 recoverable diagnostic |

权限粒度为 `read`、`comment`、`write`。`comment` 当前按非 writer 处理，不能提交 document update。客户端 `readonly` 只是交互状态，不是安全边界。

## Health、version 与代理

self-host server 必须暴露 health/version 摘要，供 client/server version strategy 和 support bundle 采集。WebSocket 代理应保留 upgrade、tenant、room/documentId 和 requestId 相关日志字段，不能记录 token、cookie 或文档正文。

## dry-run 验证

发布前执行 Gate 7 no-alias smoke；server 包必须能在外部空项目中通过 package 入口 import，并与 client package 的 protocol/version 文档一致。
