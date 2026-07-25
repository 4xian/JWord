# JWord 当前全项目审查

> 当前判定：`REQUEST CHANGES`。项目可以继续内部技术实施，但尚未达到公共 SDK GA、正式商业交付或生产级协作服务标准。

## 阅读顺序

1. [01-current-conclusion.md](01-current-conclusion.md)：当前结论和交付边界。
2. [09-remediation-roadmap.md](09-remediation-roadmap.md)：当前阶段、下一步任务和退出标准。
3. [08-issues-register.md](08-issues-register.md)：全部开放问题及阶段归属。
4. [02](02-security-and-licensing.md) 至 [06](06-ui-and-wrappers.md)：问题证据、修复步骤和最小验收。
5. [07-oem-and-system-mapping.md](07-oem-and-system-mapping.md)：问题与 OEM Phase/LIC 任务的对应关系。
6. [10-verification-plan.md](10-verification-plan.md)：每阶段验证命令和证据要求。
7. [12-phase2a-verification-evidence.md](12-phase2a-verification-evidence.md)：Phase 2A B1-B5 实际执行证据和复核边界。
8. [13-phase2b-restore-and-resource-roundtrip-plan.md](13-phase2b-restore-and-resource-roundtrip-plan.md)：Phase 2B B0 决策、B1-B3 实现证据、B2 pending/finalize 修复和 B4 关单边界。
9. [14-phase2c-remote-delete-and-dirty-semantics-plan.md](14-phase2c-remote-delete-and-dirty-semantics-plan.md)：Phase 2C dirty 契约、公开 seam 回归、重开修复和 B4 关单边界。

## 当前阶段边界

统一路线阶段 2 的子批次 2A、2B 保持 `Closed`。Phase 2C 的原关单曾被多页公开 seam 反例推翻：后页 no-op 遗留局部布局范围后，首页远端删除虽得到正确 projection，layout 仍复用过期前缀。`CORE-01` 与 Phase 2C B3/B4 已完成重开修复、全部自动门禁及最终 Standards/Spec 双轴复审，当前重新 `Closed`，下一边界为 Phase 3：

- 已处理 native 不可信输入预算，对应 `SEC-03/FMT-01`、`FMT-04`、`FMT-06` 和 `FMT-10`。
- 已增加输入 bytes、entry 数、单 entry、总解压体积、压缩比、JSON/checksum 和嵌套 schema 预算，并拒绝重复关键 entry、路径穿越和非法计数字段。
- License Phase 1 已完成内部实施退出；`LIC-107B2` 为 `Conditionally Accepted / manual certification deferred`，不阻断阶段 2A，但完成前不得对外宣称最低浏览器认证通过。
- 不跳过阶段 2A 直接进入 OEM `LIC-200` 至 `LIC-208`；这些任务位于统一路线阶段 4A。
- 后续复核发现的有限数字、非法 data URL、保存最终进度取消竞态、ZIP64 回归、逐方法中文注释、文档状态、攻击者 `resourceId` diagnostic `entry` 泄漏和取消证据问题均已修复；Standards/Spec 双轴复审无剩余 finding。
- 当前实际命令、通过数量和浏览器失败边界统一记录在 [Phase 2A 验证证据](12-phase2a-verification-evidence.md)。
- Phase 2B 已完成两个正式 persistence adapter 的无损 Y.Text clone、仅限 `restoreVersion()` 的 `prepared -> target-applied -> finalized` 协议、restore/append 进程内屏障与 Native 格式 2 packed-resource roundtrip；通用 append CAS/幂等、multi-instance、外部 operation store 和完整 PERS-02 继续归入 Phase 6B。
- 当前 B2 公开 seam 为 2 文件/18 测试，Persistence package 为 4 文件/41 测试，B2 与 B4 最终 Standards/Spec 双轴复审均为 `PASS`、0 finding。B4 的 package、Core、fresh build、architecture、types、typecheck、lint 和 whitespace 均通过；`TEST-BASELINE-01` 收口后根 `pnpm test` 为 235 文件、1238 测试全部通过。`TEST-BASELINE-01` 与 Phase 2B 均已 `Closed`。
- `TEST-BASELINE-01` 已迁移 License 业务 fixture 到显式 test-only seam，并补充未 mock public root 拒绝 marker 的自动回归；Gate 7 已修正 vanilla fixture 路径并把该 fixture 纳入内部导入扫描；同时删除 3 个空 Core 测试入口并同步 Phase 5 split 断言。Gate 5 commercial readiness 通过 `maxWorkers: 4` 测试隔离稳定为 6/6。Toolbar DOM 测试保留结构分组和非绝对定位契约，移除没有独立设计规范的精确像素间距断言后为 18/18；Gate 0 Husky 测试按当前 pre-commit 只执行 `pnpm lint` 的真实契约收窄后为 1/1。
- 当前 Chromium/Firefox/WebKit focused smoke 为 6/6、exit 0；Chrome 100、Edge 100、Firefox 128、Safari 16.4 的 Phase 2B 最低版本认证未执行，保持 `Deferred/not-run`。
- Phase 2C 重开修复让 dirty raw update 和共享 Editor 接收其他实例 dirty 事务时从第一页到缓存末页失效，并清除旧 `layoutDirtyRange`；同名本地 command 仍保留增量布局。focused 5 文件/24 测试、Core 73 文件/371 测试、architecture 3 文件/19 测试、build、types、typecheck、lint 和根测试 236 文件/1244 测试均已通过，最终 Standards/Spec 均为 `PASS`、0 finding。

## 文档职责

- 产品、商业和法律输入：[OEM License Phase 0 决策记录](../../oem-licensing-phase0-decision-record.md)。
- License/JWL2/OEM 技术设计：[OEM 实施方案](../../oem-licensing-open-access-implementation-plan.md)。
- 全项目实施顺序：[09-remediation-roadmap.md](09-remediation-roadmap.md)。
- 当前问题和状态：[08-issues-register.md](08-issues-register.md)。
- 完成证据：[10-verification-plan.md](10-verification-plan.md)。
- Phase 2B 执行证据：[13-phase2b-restore-and-resource-roundtrip-plan.md](13-phase2b-restore-and-resource-roundtrip-plan.md)。
- Phase 2C 执行证据：[14-phase2c-remote-delete-and-dirty-semantics-plan.md](14-phase2c-remote-delete-and-dirty-semantics-plan.md)。

文档与源码冲突时，以当前源码和可复跑验证为准，并立即回写本目录。
