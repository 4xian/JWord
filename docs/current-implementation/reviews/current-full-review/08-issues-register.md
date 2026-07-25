# 当前问题总台账

> 本台账记录仍需处理的问题，以及最近完成阶段的关闭状态和证据。实施顺序以 [09-remediation-roadmap.md](09-remediation-roadmap.md)为准，详细步骤见分领域文档。

## P0：阻断对应产品交付

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| SEC-01 | 固定生产 trust root、调用方换根、可信 handle、worker transfer、JWL2 signer、offline verifier、当前 runtime smoke、稳定诊断、test-only trust/key 隔离和单一 runtime identity 已收口，但 insecure fixture 与后续工作仍未关闭 | 保持正式入口拒绝测试 token；LIC-107B2 人工认证留作发布门禁，后续按 Phase 2/4 迁移调用方并删除 JWL1 兼容入口 | 1（Open；Phase 1 internal completed，LIC-107B2 manual certification deferred） | [02](02-security-and-licensing.md) |
| SEC-02 / COLLAB-01 / COLLAB-02 | admission 无真实凭据，history 作者和时间来自客户端 body | HTTP/WS 共用 admission；产生可信 `actorId`；服务端覆盖作者和时间 | 6A | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md) |
| SEC-03 / FMT-01 | `.jword` ZIP/JSON 解压无资源预算 | 增加输入、entry、单项、总解压、压缩比、JSON/checksum 预算 | 2A（Closed） | [02](02-security-and-licensing.md)、[05](05-formats-docx-pdf-native.md)、[12](12-phase2a-verification-evidence.md) |
| SEC-04 / PERS-01 | restore 非原子，持久化失败后文档已改变 | 2B 已前移仅限 `restoreVersion()` 的 pending/finalize/recovery；普通历史只在 finalize 后可见，recovery-required 可稳定重试 | 2B（Closed） | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md)、[13](13-phase2b-restore-and-resource-roundtrip-plan.md) |

## P1：正式发布或公开支持前完成

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| SEC-06 | 自研 verifier 已替换，Node 20.19.0 与当前浏览器/Worker 自动证据已通过，最低浏览器人工认证尚未完成 | 在 Chrome 100、Edge 100、Firefox 128、Safari 16.4 真实环境完成 LIC-107B2 剩余矩阵；内部推进已接受，认证前不得对外宣称最低版本实测通过 | 1（Accepted for internal progression；manual certification deferred） | [02](02-security-and-licensing.md) |
| CORE-01 | 多页文档的远端纯删除可能复用过期布局前缀 | dirty raw/shared transaction 从第一页全量失效；补后页 no-op 后首页删除回归 | 2C（Closed） | [03](03-core-editor-and-layout.md)、[14](14-phase2c-remote-delete-and-dirty-semantics-plan.md) |
| FMT-03 | blobUrl 图片保存重开后丢失 | 格式 2 使用 packed-resource 逻辑引用，校验后重建 data URL；无 bytes blob 保存 fail closed | 2B（Closed） | [05](05-formats-docx-pdf-native.md)、[13](13-phase2b-restore-and-resource-roundtrip-plan.md) |
| FMT-04 | AbortSignal 无法中断 JSZip 解压 | 引入可控解压边界，或明确取消只能在阶段间生效 | 2A（Closed） | [05](05-formats-docx-pdf-native.md)、[12](12-phase2a-verification-evidence.md) |
| FMT-06 | `document.json` 只做浅校验 | 使用严格 schema 解析嵌套结构和资源引用 | 2A（Closed） | [05](05-formats-docx-pdf-native.md)、[12](12-phase2a-verification-evidence.md) |
| FMT-05 | DOCX 导出丢页眉页脚、页码、批注和修订 | 写出对应 part，或 opaque 保留并明确有损/默认另存 | 4B | [05](05-formats-docx-pdf-native.md) |
| CORE-02 | plugin setup 失败后已注册能力不回滚 | 每插件注册事务；失败时反序释放 command/middleware/keybinding | 5 | [03](03-core-editor-and-layout.md) |
| UI-01 | Vue 未传 readonly 时覆盖 `uiOptions.readonly` | 区分 prop 缺失与显式 false | 5 | [06](06-ui-and-wrappers.md) |
| UI-02 | wrapper 动态 readonly/theme/locale 不生效，uiOptions 动态边界未定义 | 为三个标量提供稳定更新 API；其余选项明确为 mount-only | 5 | [06](06-ui-and-wrappers.md) |
| UI-03 | UI 使用全局 document/window，iframe 下失败 | DOM 能力从 ownerDocument/defaultView 派生；增加跨 realm 门禁 | 5 | [06](06-ui-and-wrappers.md) |
| PERS-02 | history read-modify-write 导致多实例丢更新 | DB 事务/CAS/幂等 append；双实例竞争验证 | 6B | [04](04-collaboration-and-persistence.md) |

## P2：结构收敛和完整产品阶段

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| PERS-03 | 通用 Y.Text attributes 在恢复时丢失 | 两个正式 adapter 已无损复制 delta/attributes；collab 示例仍是独立后续范围 | 2B（Closed） | [04](04-collaboration-and-persistence.md)、[13](13-phase2b-restore-and-resource-roundtrip-plan.md) |
| FMT-10 | manifest/checksum 数字字段接受负数和小数 | 对版本、byteLength 和计数使用有限非负整数校验 | 2A（Closed） | [05](05-formats-docx-pdf-native.md)、[12](12-phase2a-verification-evidence.md) |
| CORE-05 | `run()` 与 `applyUpdate()` 的 dirty 语义不一致 | 与 CORE-01 共用统一变化判定 | 2C（Closed） | [03](03-core-editor-and-layout.md) |
| FMT-07 | PDF save/嵌入阶段不可取消 | 在可控阶段检查取消；明确不可中断边界 | 4B | [05](05-formats-docx-pdf-native.md) |
| FMT-08 | 单张坏 data URL 图片导致整份 DOCX 导出失败 | 单资源错误转 warning/占位或稳定拒绝，不中断无关内容 | 4B | [05](05-formats-docx-pdf-native.md) |
| FMT-09 | DOCX 浮动图片 anchor 整体丢弃 | 支持转换或 opaque 保存 anchor part | 4B | [05](05-formats-docx-pdf-native.md) |
| CORE-04 | 查找静默 trim 查询首尾空格 | 保留原查询或提供显式选项 | 5 | [03](03-core-editor-and-layout.md) |
| CORE-06 | 生产事务监听器异常被吞掉 | 通过 diagnostics/reportError 可观测，不破坏事务提交 | 5 | [03](03-core-editor-and-layout.md) |
| CORE-07 | `readErrorCode` 未使用 | 删除死代码或接入唯一调用路径 | 5 | [03](03-core-editor-and-layout.md) |
| UI-04 | paste sanitizer 绑定全局 realm | 注入 ownerDocument/defaultView 并使用同 realm 构造器 | 5 | [06](06-ui-and-wrappers.md) |
| UI-05 | 水印轮询冒充安全边界且存在性能风险 | 降级为品牌恢复机制；移除安全宣传；按需减少观察范围 | 5 | [06](06-ui-and-wrappers.md) |
| UI-06 | `ui.destroy()` 抛错后跳过其他清理 | 独立执行所有清理步骤并汇总错误 | 5 | [06](06-ui-and-wrappers.md) |
| UI-07 | toolbar 构造失败不回滚已创建 DOM | 创建即登记清理；失败时反序回滚 | 5 | [06](06-ui-and-wrappers.md) |
| UI-08 | 用户文案硬编码中文 | 迁入 i18n 字典并补缺 key 门禁 | 5 | [06](06-ui-and-wrappers.md) |
| UI-09 | React controlled value 在 mount 时加载两次 | 明确初始化所有权，首个 effect 跳过重复 load | 5 | [06](06-ui-and-wrappers.md) |
| COLLAB-04 | tenant 表面能力默认放行 | 按当前单 deployment 决策直接删除 tenant 表面能力 | 6A | [04](04-collaboration-and-persistence.md) |
| COLLAB-05 / SEC-05 | CORS 默认 `*` | production preset 使用 Origin allowlist | 6B | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md) |
| COLLAB-06 / SEC-05 | 限流为进程内状态且不理解可信代理 | 定义可信代理和共享限流 key/store | 6B | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md) |
| COLLAB-07 | `snapshotStorage?: unknown` 无实现 | 删除虚假扩展点，或以强类型接口和行为测试重新引入 | 6B | [04](04-collaboration-and-persistence.md) |

## Phase 2A 当前状态

`SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10` 当前为 `Closed`。后续复核确认的有限数字、非法 data URL 和保存最终进度取消竞态三个 P1 行为阻断项，以及 ZIP64 回归矩阵、逐方法中文注释、文档状态、攻击者 `resourceId` diagnostic `entry` 泄漏和取消证据问题均已修复；focused、package、架构验证和 Standards/Spec 双轴复审均无剩余 finding。Chrome 100、Edge 100、Firefox 128、Safari 16.4 的最低版本证据仍为 `Deferred/not-run`。

## Phase 2B 当前状态

`SEC-04/PERS-01` 的原 scoped 单次 restore 语义在 B2 复审中因 target apply 失败窗口被否决；用户已批准并完成仅限 `restoreVersion()` 的 pending/finalize/recovery 修复。后续 Spec 复审先后发现 observer divergence 不收敛、finalize 提交后确认丢失会重复 restore、pending append 复用版本 ID，以及跳号虽唯一但 finalize 尾插会破坏历史顺序/内容。当前修复在同 backing owner 上阻止 restore 与 append 交错，durable pending 存在时拒绝 append，并让 `target-applied` pending 保存实际 target state update；append 只在 pending 收敛后生成连续版本。`FMT-03` 与 `PERS-03` 既有实现不变。历史顺序修复后的 B2 与 B4 最终 Standards/Spec 复审均为 `PASS`、0 finding；批准范围内 B4 门禁及根测试全部通过，Phase 2B 已 `Closed`。

Phase 6B 仍负责通用 append 的 transaction/CAS/idempotency、multi-instance 竞争、外部 operation store 和完整 `PERS-02`；不得把本次 restore 专用协议描述成通用 history 强一致。Phase 2C 没有改变该边界。

## Phase 2C 当前状态（2026-07-20）

`CORE-05` 保持 `Closed`；`CORE-01` 曾因多页布局反例重开。原单页回归没有覆盖后页 no-op 遗留局部布局范围后再从首页接收远端删除的序列，导致 projection 正确但 layout 复用旧前缀。当前已补 raw update 与共享 Editor 公开 seam 回归，让两条 dirty 外部事务路径从第一页到缓存末页失效、清除旧 `layoutDirtyRange`，并锁定同名本地 command 仍使用增量布局；全部自动门禁及最终 Standards/Spec 双轴复审均通过。`CORE-01`、Phase 2C B3/B4 与 Phase 2C 重新 `Closed`，下一边界为 Phase 3。

## TEST-BASELINE-01 历史关闭证据（2026-07-19）

- test-only License seam 已恢复 DOCX/PDF/Collab 的合法业务 fixture 覆盖，并由未 mock 的 License public root 自动回归锁定 marker 必须以 `JWORD_LICENSE_SIGNATURE_INVALID` fail closed；未恢复生产公钥、signer、trust root 或 `allowInsecureFixtureLicense`。
- Gate 7 已把 devtools/theme/i18n token 指向真实 `examples/vanilla/tests/fixtures/test-fixture.ts`，并把该 fixture 纳入 `collectInternalImportFailures()` 扫描；三个 Core 空测试入口已删除，并同步 Phase 5 split 架构断言。Gate 5 commercial readiness 通过 Vitest `maxWorkers: 4` 测试隔离稳定为 6/6。
- TEST-BASELINE-01 收口时根 `pnpm test` 为 235 个文件、1238 个测试全部通过。Toolbar DOM 测试保留结构分组和非绝对定位契约；Gate 0 Husky 测试按当前 pre-commit 只执行 `pnpm lint` 的真实契约验证脚本头、lint 命令和可执行位，focused 为 1/1。该数字是历史基线，不是 Phase 2C 最新根测试。
- 状态：`Closed`。测试基线已恢复，不再阻断后续阶段；Phase 2C 最新根测试为 236 个文件、1244 个测试，见上方 Phase 2C 状态。

## 状态汇总

- P0：4 项。
- P1：11 项。
- P2：19 项。
- Phase 2A、Phase 2B、Phase 2C 均为 `Closed`；Phase 2 整体完成，下一步按路线进入 Phase 3。
