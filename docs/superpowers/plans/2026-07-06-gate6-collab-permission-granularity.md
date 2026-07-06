# Gate 6 协同权限粒度设计与实施方案（2026-07-06）

## 1. 背景与目标

来源：修复计划 `[计划审查 3.11] 协同权限粒度设计（R2 复审补充）` 与补充文档 §3.5。

目标是把正式 Hocuspocus WebSocket 服务端的房间级授权从“只要连接成功即可写”收敛为宿主可控的 per-user 权限：

1. documentName 使用 `{tenantId}/{documentId}`，缺 tenant 段时归入 `default`。
2. `authHook` 接收 `tenantId`、`documentId`、`roomId`、`userId`、`token`，返回 `read` / `comment` / `write`。
3. `beforeSync` 只允许 `write` 角色提交 Yjs update；`read` 和 `comment` 写入返回 `COLLAB_PERMISSION_DENIED`。
4. `tenantHook` 与 `licenseHook` 继续在同步前执行，跨 tenant 或无授权不进入正常同步路径。
5. 文档明确：客户端 `readonly` 只属于 UX 语义，不是安全边界。

## 2. 权限模型

| 角色 | 可连接 | 可接收同步 | 可提交 Yjs update | 1.0 语义 |
|---|---:|---:|---:|---|
| `read` | 是 | 是 | 否 | 只读协同观察者 |
| `comment` | 是 | 是 | 否 | 预留批注权限，当前按非 writer 处理 |
| `write` | 是 | 是 | 是 | 可编辑协同成员 |

`comment` 的精确服务端 enforcement 放到 post-1.0：当前批注、正文、格式和 selection 更新都表现为 Yjs binary update，服务端无法在 `beforeSync` 低成本、低风险地区分“只新增批注”和“修改正文”。因此 1.0 只冻结角色名称和安全默认值，不把 comment 冒认为可写批注能力。

## 3. 服务端 contract

`CreateJWordCollabHocuspocusServerOptions.authHook` 使用以下公开类型：

- `JWordCollabHocuspocusRole = 'read' | 'comment' | 'write'`
- `JWordCollabHocuspocusAuthHookInput`
- `JWordCollabHocuspocusAuthHookResult`
- `JWordCollabHocuspocusAuthHook`

拒绝规则：

1. 缺 `authHook`：连接阶段拒绝，provider 收到 `COLLAB_PROVIDER_AUTH_FAILED`。
2. `authHook.allow === false`：连接阶段拒绝，优先使用 hook 返回的诊断码。
3. `role !== 'write'` 且收到 Yjs update：`beforeSync` 拒绝，provider 收到 `COLLAB_PERMISSION_DENIED`。
4. `tenantHook` 或 `licenseHook` 拒绝：连接或 update 阶段拒绝，使用稳定诊断码。

## 4. 实施切片

1. 红灯：扩展 public API catalog 架构测试，要求 collab-server root 导出 Hocuspocus auth hook 与 role 类型，并在公开文档记录 read/comment/write。
2. 实现：`packages/collab-server/src/hocuspocus-server.ts` 将 `JWordCollabHocuspocusRole` 扩展为 `read | comment | write`；root `index.ts` 公开相关类型。
3. 行为回归：`packages/collab-server/test/server.test.ts` 增加 comment-only 客户端提交 update 时返回 `COLLAB_PERMISSION_DENIED`。
4. 文档：更新 `docs/sdk/public-api.md`、`packages/collab-server/README.md` 与诊断码生成产物，声明 `readonly` 不具备安全语义。
5. 回写：勾选 remediation item，并在人工验证日志登记阶段报告。

## 5. 验收命令

- `pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose`
- `pnpm exec vitest run packages/collab-server/test/server.test.ts --testNamePattern "comment-only|read-only|auth hook" --reporter=verbose`
- `node tools/diagnostics/generate-diagnostics-artifacts.mjs --check`
- `pnpm --filter @4xian/jword-collab-server test`
- `pnpm typecheck`
- `pnpm lint`

## 6. 后续边界

- comment 级服务端可写批注需要后续为批注操作定义可识别的 signed intent 或 server-side operation envelope，不能在当前 Yjs update 层猜测。
- UI `readonly` 和 collab server `read` / `comment` / `write` 不能互相替代；宿主必须在服务端 hook 中执行真实权限判断。
