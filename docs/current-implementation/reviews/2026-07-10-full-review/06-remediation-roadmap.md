# 整改路线与验收顺序

## 决策基线

整改不应从继续增加功能开始。授权、协作准入和开放写入语义以[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准；本报告不再要求 V1 建设 tenant、组织、RBAC、ACL、SSO、SCIM 或 comment-only role。

每个批次都遵循：先建立失败反馈环，做最小修复，复跑同一反馈环，再扩大验证。所有 release 证据必须绑定同一个干净 RC SHA、dirty flag 和 artifact hash。

## 当前实施队列

当前代码实施严格按以下顺序推进：

1. **第一批：只修复 `pnpm typecheck`（已完成，2026-07-10）。** 修复前的 32 个错误全部集中在 vanilla E2E/辅助代码把 `__jwordDemo.selectTextRange`、`__jwordDemo.native` 等可选成员当作必选调用。本批次已统一 demo hook 的真实类型契约，根 `pnpm typecheck` 退出 0，未夹带 EditorShell 或其它重构。
2. **第二批：单 Host `EditorShell`（已完成，2026-07-10）。** 已新增 `createJWord({ host })`，shell 内部固定创建上方 toolbar、中间 editor、下方 status bar，并统一内部面板、a11y、构造失败回滚和幂等 destroy。默认 vanilla 示例只保留单 Host 集成；复杂 Gate 能力迁入独立测试夹具。
3. **第三批：OEM License 深模块（未开始）。** 按 OEM 方案 Phase 0/1 关闭公开测试私钥、调用方信任根和自研密码实现等收费阻断。
4. **第四批：基础数据安全与发布消费。** 加固 `.jword`、原子恢复、资源重开、dist、tarball、CI 和发布治理。
5. **条件批次：DOCX/PDF 与协作。** 只有进入首期销售范围时，分别执行 OEM 方案 Phase 2/3 和本报告对应整改。

商业合同、feature catalog、有效期和交付形态的 Phase 0 决策可以与前两批并行准备，但不得改变上述代码修改顺序。

## 第一批：修复当前 typecheck

目标：先恢复唯一明确指定的基础反馈环，不把历史类型错误带入 EditorShell 改造。

状态：已完成。2026-07-10 根 `pnpm typecheck` 退出 0；后续第二批也已独立完成。

任务：

1. 以 `examples/vanilla/src/vite-env.d.ts` 与 `window.__jwordDemo` 的真实运行时对象为一个契约，确认 `selectTextRange` 和 `native` 在对应测试环境中究竟是必选还是可选。
2. 生产 demo hook 若始终提供成员，就在构造对象和全局声明中统一为必选；确实按 fixture 懒加载的成员，则在测试侧显式等待并窄化，禁止散落非空断言。
3. 只修改该契约及受影响调用点，不在本批次引入 EditorShell、改动布局或重写 E2E。
4. 复跑同一个根命令；不得只跑局部 `tsc` 后宣称完成。

验收：

```bash
pnpm typecheck
```

必须退出 0，且 `window.__jwordDemo` 的运行时对象、全局声明和测试调用三者一致。`pnpm lint` 与文件预算仍保留为后续完整 RC 门禁，不因本批次通过而自动关闭。

## 第二批：单 Host EditorShell

目标：一级 OEM 的默认集成只要求一个根元素；内部 DOM seam、装配顺序和资源所有权不再泄漏给普通调用方。

状态：已完成。2026-07-10 单 Host API、默认 demo、Quickstart、React/Vue wrapper、slots、构造失败回滚和统一 destroy 均已落地；第三批尚未开始。发布 tarball 消费仍归第四批与 `JWR-P0-005` 剩余关闭条件处理。

默认用法：

```ts
const jword = createJWord({
  host: document.querySelector('#jword')!
})

jword.destroy()
```

默认结构：

```text
root host（EditorShell 专用容器）
├── toolbar host
├── editor shell / canvas host
└── status bar host
```

任务：

1. 在 UI package 新增稳定的 `createJWord({ host })` 与 `JWordEditorShell` interface；基础调用只要求专用空 `host`，并返回 `editor` 与幂等 `destroy()`。根 Host 本身作为 shell 容器，不额外增加无行为价值的 wrapper。
2. 复用当前 `editor.mount()`、自动 toolbar mount 和自动 status bar mount，不重写 toolbar、editor 或 status bar controller。
3. shell 内部固定使用纵向 flex，按 toolbar → editor → status bar 顺序挂载；禁止 grid 和 `gap`。
4. dropdown、dialog、find/replace、header/footer、revisions 和普通 overlay 默认使用 shell 的 editor 区域，不额外创建包装；live region 与 text mirror 复用 core editor 的视觉隐藏节点，不要求调用方提供 Host。
5. comments、outline、fullscreen 等真实外置布局需求保留为可选高级 `slots`；统一继承 `ownerDocument`、theme、locale、focus、z-index 和 destroy 契约；普通 panel 不公开额外挂载 slot。
6. shell 构造中任一步失败时反序销毁已创建资源；普通路径只由 shell 持有销毁所有权。低层 `createEditor()` + `createJWordUi()` 保留为 advanced interface。
7. 修复 `headerFooter/findReplace/revisions` 显式高级 Host 被内部 `panelHost` 覆盖的问题。
8. Quickstart 改成单根 Host、单 `createJWord()`、单 `destroy()`；不再教普通用户手动 mount toolbar/status/a11y Host。
9. vanilla 默认 demo 以 `createJWord({ host })` 为唯一可见集成入口；Gate fixture、media/table/native adapter 和测试 bridge 移入 `tests/fixtures`，默认示例不再声明或接线 `__jwordDemo`。
10. React/Vue wrapper 后续复用同一 shell，而不是继续各自创建 toolbar/editor/a11y Host；本批次至少锁定迁移 interface，不顺带完成全部动态 props/hydration 工作。

最小验收：

- 只传一个根元素即可创建默认编辑器，DOM 顺序严格为 toolbar、editor、status bar。
- 不传 slots 时，所有 dropdown、panel 和 overlay 都有内部有效挂载点。
- 高级 slot 存在时，显式位置优先于内部默认位置。
- 构造故障注入后无残留 DOM、listener、observer 或 timer；连续调用 `destroy()` 不抛错。
- 默认 demo 和 Quickstart 不直接调用 `editor.mount()` 或 `createJWordUi()`。
- 复跑 `pnpm typecheck`、EditorShell focused Vitest 和 vanilla package typecheck；只增加证明默认结构、slot 优先级和 destroy 的最少测试。

## 第三批：OEM 授权与协作准入

目标：收费 token 不可伪造；付费能力与用户准入分离；协作使用可信 actor，但 V1 不建设文档权限。

任务以 OEM 方案 Phase 0/1/3 为准：

1. 删除生产默认测试信任根；普通调用方不能传入或覆盖公钥/verifier。
2. 测试签发 helper、测试 trust store 和私钥 fixture 不进入正式 exports/tarball。
3. 使用内置 `issuer + keyId` trust store、严格 JWL2 parser 和 WeakMap-branded handle。
4. 替换或独立审计当前 Ed25519 实现，并补标准向量。
5. 协作建立 deployment-level license context 与统一 `JWordCollabAdmission`。
6. admission 产生不可由 body 覆盖的 `actorId`，贯穿 document access 与 history author。
7. V1 `authorizeDocumentAccess()` 恒定返回 `write`；删除或限时 deprecate 旧 `tenantId`/`tenantHook` 和角色表面能力。
8. 一个 deployment 只绑定一个 OEM license，`documentId` 在整个 deployment 内唯一。

验收条件：

- 仓库测试私钥签发的 token 被生产入口拒绝。
- 正式 tarball 不包含私钥、测试 signer、测试 trust store 或调用方公钥注入入口。
- 未通过 admission 的请求在数据读取前被拒绝；通过 admission 的用户固定获得 write。
- history 作者只能来自 admission `actorId`；浏览器伪造 entitlement、feature 或 author 不能扩权。
- 不宣传 tenant、多角色或文档 ACL。

## 第四批：基础数据安全与发布消费

### `.jword` 与恢复完整性

1. 增加输入大小、entry 数、单 entry、总解压体积、文本 JSON 和 checksum 条目限制。
2. 拒绝路径穿越、重复关键 entry、异常压缩比和超预算包，并返回稳定 diagnostic。
3. 在隔离 Y.Doc 中准备 restore，使用事务/CAS 一次提交；失败时当前文档与历史均不变。
4. packed resource load 时读取 bytes，重建可用 data/blob URL 或稳定 resource resolver。
5. 增加图片保存、关闭页面、重新打开、渲染成功的最小 E2E。

### 完整 RC 与发布消费

1. 修复 `pnpm lint` 和当前 file-budget 红灯，并记录 Node、pnpm、OS、commit SHA、dirty flag、lockfile hash 与 artifact hash。
2. 在干净 RC 上 fresh build，禁止复用旧 dist；normalization check 进入 build 后置门禁。
3. 修复 pnpm 9.14.2 下本地 tarball 的传递 workspace dependency 解析。
4. 第三方项目覆盖 TypeScript、Vite、Chromium、CSS、worker、React/Vue runtime 和单 Host EditorShell。
5. CI 增加 `test:types`、prod audit、release consumer 和 artifact 上传。
6. 补版本、license metadata、私有 registry/交付包、2FA、provenance、dist-tag、rollback 与 changeset runbook。

验收：

```bash
pnpm lint
pnpm typecheck
pnpm test:types
pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts
pnpm build
node tools/release/normalize-dist-relative-imports.mjs --check
node --input-type=module -e "await import('./packages/core/dist/index.js')"
node tools/release/gate7-release-dry-run.mjs
node tools/release/check-gate7-third-party-smoke.mjs
pnpm audit --prod
```

所有命令必须在同一 SHA 上退出 0；若 audit 有正式豁免，需要记录 advisory、真实调用路径、补偿控制、owner 和到期日。

## 条件批次：格式与协作销售范围

### DOCX/PDF 进入首期销售

执行 OEM 方案 Phase 2，并从以下路径中明确选择 DOCX 承诺：

- **受限子集路径**：只承诺经过验证的 T1 子集；编辑前显示兼容报告，默认另存为，不覆盖原 DOCX。
- **企业互通路径**：补齐页眉页脚、页码、批注、修订等关键 T2 导出，再完成 Word 打开、编辑、保存、重开矩阵。

无论选择哪条，14 个 pending 的 Word evidence request 都要形成真实证据；validator 不能替代桌面 Word 验收。

### 协作进入首期销售

执行 OEM 方案 Phase 3，并同时完成：

1. 统一或明确编排 HTTP+WS deployment。
2. WebSocket 文档接入持久数据库 load/store。
3. history 使用事务 append、幂等 ID 和跨实例并发控制，不依赖进程内锁。
4. 启用真实 admission、license、origin allowlist、payload/connection limit。
5. 完成重启恢复、断网重连、备份恢复和双实例并发测试。

## 企业 GA 与完整 Word 产品后续项

企业 GA 仍需完成 iframe/跨 realm、wrapper 动态状态与 hydration、依赖安全、数据库 migration、备份恢复、HA、metrics/trace、容量、无障碍和兼容矩阵。

SSO/SCIM、组织/RBAC、文档 ACL、comment-only enforcement、可信治理审计、保留删除和 legal hold 属于未来 Enterprise Governance，不是当前 V1 的关闭条件。完整 track changes、复杂 Word 语义、PDF/A/PDF/UA、完整 RTL、托管多 OEM 云、license portal、usage metering 和 AI 继续后置。

## 阶段退出标准

| 阶段 | 必须满足 |
| --- | --- |
| 第一批 typecheck | 根 `pnpm typecheck` 退出 0，demo hook 的声明、构造与调用一致。 |
| 第二批 EditorShell | 单根 Host 默认集成、上中下布局、内部面板挂载范围、统一 destroy、Quickstart/demo 和最小测试全部完成。 |
| 受控 PoC | OEM License Phase 1、基础数据安全、可安装 artifact 与明确销售范围完成；DOCX/协作未完成时必须从合同排除。 |
| 私有 SDK beta | 干净 RC、可安装 tarball、单 Host Quickstart、native 数据闭环、受限兼容矩阵和人工支持。 |
| 企业 GA | 已承诺范围的安全、生产协作、兼容、无障碍、发布和运维矩阵全部完成；不自动包含 V1 明确排除的治理能力。 |
| Word 替代品 | 在企业 GA 基础上完成核心文档语义和可验证 roundtrip，不只增加 toolbar 按钮。 |
