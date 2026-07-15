# 当前问题总台账

> 本台账只记录仍需处理的问题。实施顺序以 [09-remediation-roadmap.md](09-remediation-roadmap.md)为准，详细步骤见分领域文档。

## P0：阻断对应产品交付

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| SEC-01 | 默认信任根对应公开测试私钥，测试 signer 暴露，调用方可换根 | 固定生产 `issuer + keyId` trust store；测试 signer/trust 仅限测试；正式入口拒绝测试 token | 1 | [02](02-security-and-licensing.md) |
| SEC-02 / COLLAB-01 / COLLAB-02 | admission 无真实凭据，history 作者和时间来自客户端 body | HTTP/WS 共用 admission；产生可信 `actorId`；服务端覆盖作者和时间 | 6A | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md) |
| SEC-03 / FMT-01 | `.jword` ZIP/JSON 解压无资源预算 | 增加输入、entry、单项、总解压、压缩比、JSON/checksum 预算 | 2A | [02](02-security-and-licensing.md)、[05](05-formats-docx-pdf-native.md) |
| SEC-04 / PERS-01 | restore 非原子，持久化失败后文档已改变 | 隔离准备；事务/CAS 原子提交；故障时目标文档和 history 均不变 | 2B | [02](02-security-and-licensing.md)、[04](04-collaboration-and-persistence.md) |

## P1：正式发布或公开支持前完成

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| SEC-06 | 自研 SHA-512/Ed25519 无独立审计 | 使用成熟实现，或补独立审计、标准向量和必要模糊验证 | 1 | [02](02-security-and-licensing.md) |
| CORE-01 | 远端纯删除 update 不刷新投影和布局 | 使用真实 transaction 变化判断；补纯删除和幂等 update 回归 | 2C | [03](03-core-editor-and-layout.md) |
| FMT-03 | blobUrl 图片保存重开后丢失 | 读取 packed bytes，重建资源 URL，定义释放时机 | 2B | [05](05-formats-docx-pdf-native.md) |
| FMT-04 | AbortSignal 无法中断 JSZip 解压 | 引入可控解压边界，或明确取消只能在阶段间生效 | 2A | [05](05-formats-docx-pdf-native.md) |
| FMT-06 | `document.json` 只做浅校验 | 使用严格 schema 解析嵌套结构和资源引用 | 2A | [05](05-formats-docx-pdf-native.md) |
| FMT-05 | DOCX 导出丢页眉页脚、页码、批注和修订 | 写出对应 part，或 opaque 保留并明确有损/默认另存 | 4B | [05](05-formats-docx-pdf-native.md) |
| CORE-02 | plugin setup 失败后已注册能力不回滚 | 每插件注册事务；失败时反序释放 command/middleware/keybinding | 5 | [03](03-core-editor-and-layout.md) |
| UI-01 | Vue 未传 readonly 时覆盖 `uiOptions.readonly` | 区分 prop 缺失与显式 false | 5 | [06](06-ui-and-wrappers.md) |
| UI-02 | wrapper 动态 readonly/theme/locale 不生效，uiOptions 动态边界未定义 | 为三个标量提供稳定更新 API；其余选项明确为 mount-only | 5 | [06](06-ui-and-wrappers.md) |
| UI-03 | UI 使用全局 document/window，iframe 下失败 | DOM 能力从 ownerDocument/defaultView 派生；增加跨 realm 门禁 | 5 | [06](06-ui-and-wrappers.md) |
| PERS-02 | history read-modify-write 导致多实例丢更新 | DB 事务/CAS/幂等 append；双实例竞争验证 | 6B | [04](04-collaboration-and-persistence.md) |

## P2：结构收敛和完整产品阶段

| ID | 问题 | 修复要点 | 阶段 | 明细 |
| --- | --- | --- | --- | --- |
| PERS-03 | 通用 Y.Text attributes 在恢复时丢失 | 无损复制 delta/attributes；不影响 run.properties 的结论保持明确 | 2B | [04](04-collaboration-and-persistence.md) |
| FMT-10 | manifest/checksum 数字字段接受负数和小数 | 对版本、byteLength 和计数使用有限非负整数校验 | 2A | [05](05-formats-docx-pdf-native.md) |
| CORE-05 | `run()` 与 `applyUpdate()` 的 dirty 语义不一致 | 与 CORE-01 共用统一变化判定 | 2C | [03](03-core-editor-and-layout.md) |
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

## 状态汇总

- P0：4 项。
- P1：11 项。
- P2：19 项。
- 当前全部为 `Open`；阶段完成后在对应行增加状态和证据链接。
