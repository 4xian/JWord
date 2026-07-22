# JWord Collaboration self-host Docker 部署

## 客户交付边界

正式 Collaboration 服务端只以 JWord 提供的版本化 Docker 镜像交付。客户应用代码只集成浏览器 SDK，并连接部署后的 HTTP/WSS endpoint；不直接安装或导入 `@4xian/jword-collab-server`，也不复制 `examples/collab/server` 作为生产服务。

Node 运行时和 server package 位于镜像内，客户业务宿主不需要直接安装 Node。客户运维侧需要 Docker 兼容的容器运行环境、持久化存储和 secret 管理。后续新增的任何 JWord 正式服务端也必须遵守同一 Docker-only 交付边界。

## 客户集成流程

1. 客户前端从浏览器 SDK 公开入口接入 Collaboration client，配置 HTTP/WSS endpoint 和部署准入凭据。
2. 客户运维侧按批准的 image tag 和 digest 部署 JWord 正式镜像，挂载只读 License secret/file 和持久化存储。
3. 反向代理对外提供 HTTPS/WSS，保留 WebSocket upgrade，并执行 Origin allowlist、TLS 和可信代理边界。
4. 浏览器不接收或上送 deployment License；服务端在容器内独立完成 License、admission 和存储边界校验。

## 生产镜像契约

- 镜像必须以不可变版本和 digest 交付，不要求客户在宿主机执行 `pnpm install` 或 Node 启动脚本。
- License 只从只读 secret/file 进入容器；缺失、签名无效、class 不匹配或运行中过期必须 fail closed。
- 必须提供独立 liveness 和 readiness；不可就绪时 `/ready` 返回 503，缺生产配置时不监听业务端口。
- history/snapshot 必须使用可持久化存储，并有双实例一致性、备份和恢复证据。
- HTTP 和 WebSocket 必须共用 admission 与可信 `actorId`；客户端 `readonly` 只是交互状态，不是安全边界。

## 当前实现状态

生产镜像仍是 `LIC-309` 的 Pending 任务。当前 `packages/collab-server/Dockerfile` 只能证明仓库可容器化构建和启动，其默认 CMD 仍使用 allow-all `licenseHook` 和 volatile storage，且没有完成正式 admission、双实例持久化、readiness 与备份恢复契约。因此它不得作为客户生产镜像发布。

## 镜像内部 package 记录

`@4xian/jword-collab-server` 当前仍是 `private: true` 的 server package。以下入口用于仓库内部实现、镜像组装和现有架构验证，不是客户应用集成指南：

```ts
import {
  createJWordCollabServer,
  startJWordCollabServer
} from '@4xian/jword-collab-server'
```

当前 server API 包括 `createJWordCollabServer()`、`startJWordCollabServer()`、`CreateJWordCollabServerOptions` 和 `JWordCollabServerState`。现有 `authHook`、`tenantHook`、`licenseHook` 与 storage hook 是当前实现契约；Phase 3 会按 deployment-level License/admission 方案收口，不对客户承诺当前 Node API 作为生产部署面。

## Health、version 与代理

self-host server 必须暴露 health/version 摘要，供 client/server version strategy 和 support bundle 采集。WebSocket 代理应保留 upgrade、documentId 和 requestId 相关日志字段，不能记录 token、cookie 或文档正文。

## 验证边界

当前 Gate 6/7 package no-alias smoke 只验证 server package 能在外部空项目通过入口 import，不等于生产镜像验收。`LIC-309` 及生产数据面关闭前，Collaboration 不进入客户销售和生产部署。
