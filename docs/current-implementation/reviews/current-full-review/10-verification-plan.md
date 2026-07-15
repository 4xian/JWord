# 当前验证计划

## 1. 当前基础门禁

已确认可用的基础反馈环：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `packages/core/dist/index.js` Node ESM import

这些结果只代表基础工程门禁，不代表 License、文件安全、格式、协作或发布问题已关闭。

## 2. 阶段证据要求

每阶段记录：

- 当前 commit SHA 和 dirty flag。
- Node、pnpm、OS 和 lockfile hash。
- 复现命令、修复后同一命令和扩大验证命令。
- 命令 exit code、测试数量和关键 artifact。
- 未执行项和剩余风险。
- 发布阶段的 tarball/artifact hash。

没有上述证据时，问题保持 `Open` 或 `In Progress`。

## 3. 阶段 1：License

```bash
pnpm --filter @4xian/jword-license typecheck
pnpm --filter @4xian/jword-license test
pnpm test:types
pnpm typecheck
pnpm build
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate6-commercial-pack.mjs
```

必须额外证明：

- 公开测试私钥签发的 token 被生产入口拒绝。
- trust store 只包含批准的 `jword-prod-2026-k1` 生产公钥；缺少该输入时阶段不得关闭。
- 调用方无法注入公钥/verifier。
- tarball 不含私钥、测试 signer 或测试 trust store。
- 标准 Ed25519 向量通过。

## 4. 阶段 2：native、恢复和 core

聚焦运行对应 package test，并增加最少恶意 fixture：ZIP bomb、重复 entry、大 JSON、错误嵌套 schema、恢复故障、图片重开、纯删除 update。

扩大验证至少包括：

```bash
pnpm --filter @4xian/jword-native typecheck
pnpm --filter @4xian/jword-native test
pnpm --filter @4xian/jword-persistence typecheck
pnpm --filter @4xian/jword-persistence test
pnpm --filter @4xian/jword-core test
pnpm typecheck
```

必须证明失败路径不修改目标文档、不遗留 history、不泄漏 object URL。

## 5. 阶段 3：artifact 和消费

```bash
pnpm lint
pnpm typecheck
pnpm test:types
pnpm build
node tools/release/normalize-dist-relative-imports.mjs --check
node --input-type=module -e "await import('./packages/core/dist/index.js')"
node tools/release/gate7-release-dry-run.mjs
node tools/release/check-gate7-third-party-smoke.mjs
pnpm audit --prod
```

Vanilla、React、Vue、CSS、worker 和 EditorShell 必须从同一批 tarball 安装，不允许 workspace alias。

## 6. 阶段 4：商业模块和 Formats

```bash
pnpm --filter @4xian/jword-docx typecheck
pnpm --filter @4xian/jword-docx test
pnpm --filter @4xian/jword-pdf typecheck
pnpm --filter @4xian/jword-pdf test
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate5-third-party-smoke.mjs
pnpm test:types
```

至少覆盖授权成功、缺授权、篡改 transfer、未授权不 dispatch、DOCX 有损 diagnostic、图片 roundtrip 和 worker 路径。

## 7. 阶段 5：Core、UI 和 wrapper

运行受影响 package test、`pnpm test:types`、Vanilla/React/Vue runtime smoke 和 iframe/跨 realm E2E。生命周期问题必须通过构造失败和 destroy 故障注入验证无残留 DOM、listener、observer 或 timer。

## 8. 阶段 6：Collaboration

```bash
pnpm --filter @4xian/jword-collab typecheck
pnpm --filter @4xian/jword-collab test
pnpm --filter @4xian/jword-collab-server typecheck
pnpm --filter @4xian/jword-collab-server test
```

另需真实集成验证：

- HTTP/WS admission 共用 credential 和 `actorId`。
- 未准入请求在 storage 前拒绝。
- 双实例并发不丢 update、不重复 version。
- 重启、断网重连、备份和恢复。
- Origin allowlist、可信代理、共享限流。
- 缺 license 或生产配置时不监听端口。

## 9. 阶段 7：发布候选

在同一干净 SHA 和 artifact 上执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:types
pnpm test
pnpm build
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate6-commercial-pack.mjs
node tools/release/check-gate5-third-party-smoke.mjs
node tools/release/check-gate6-third-party-smoke.mjs
node tools/release/check-gate7-third-party-smoke.mjs
pnpm audit --prod
pnpm test:e2e
pnpm test:visual
pnpm bench
pnpm size
```

随后完成人工 Word 桌面、屏幕阅读器、签发、续期、到期、key rotation 和 rollback 演练。真实 publish 还必须满足法律门禁。
