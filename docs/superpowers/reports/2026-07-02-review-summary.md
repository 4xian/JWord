# JWord 全项目代码审查总览（2026-07-02）

## 审查范围与方法

以企业级标准对 JWord 全项目进行了一次对照 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` 的完整审查，采用 7 个并行审查方向，每个方向独立阅读规划文档对应章节并逐文件核对本地实现（关键发现均在源码中实证复核）：

| # | 报告 | 审查对象 |
|---|------|----------|
| 1 | [计划文档审查](./2026-07-02-plan-review.md) | 规划文档本身：架构设计、技术选型、实施方案、缺失能力 |
| 2 | [Gate 0/1 审查](./2026-07-02-gate0-gate1-review.md) | 工程基座（lint/构建/门禁）+ 状态模型与 Transaction Pipeline |
| 3 | [Gate 2/3 审查](./2026-07-02-gate2-gate3-review.md) | 分页布局引擎、Canvas 渲染、输入系统、选区、工具栏、a11y |
| 4 | [Gate 4 审查](./2026-07-02-gate4-review.md) | 图片、表格、批注、超链接、目录、查找替换、页眉页脚、修订、粘贴、只读 |
| 5 | [Gate 4.5/5 审查](./2026-07-02-gate45-gate5-review.md) | `.jword` 原生格式、DOCX 导入导出、PDF 导出、license、示例与兼容工具 |
| 6 | [Gate 6 审查](./2026-07-02-gate6-review.md) | 协作 client/server、离线持久化、历史、自动插入 |
| 7 | [Gate 7 审查](./2026-07-02-gate7-review.md) | SDK 稳定化方案评审（未实施，仅审方案） |

修复计划见：**[`docs/superpowers/plans/2026-07-02-jword-remediation-plan.md`](../plans/2026-07-02-jword-remediation-plan.md)**（Phase 0-6 分阶段，含每项的修复方案、验证方式、工作量与依赖）。

## 问题分布汇总

各报告严重度体系略有差异，此处归一为四级（阻断 / 严重 / 中等 / 轻微建议）：

| 审查方向 | 阻断 | 严重 | 中等 | 轻微/建议 | 合计 | Critical 级架构问题 |
|----------|------|------|------|-----------|------|---------------------|
| 计划文档 | — | 3 | 6 | 10 | 19 | 无（问题在维护性与完整性） |
| Gate 0/1 | 0 | 3（P0 项） | 13 | 22 | 38 | **无**（架构不变式实证成立） |
| Gate 2/3 | **2** | 8 | 20 | 17 | 47 | 无 |
| Gate 4 | **1**（BUG） | 2 | 8 | 6 | 17 | 无 |
| Gate 4.5/5 | 0 | 6 | ~15 | ~10 | ~31 | 无（另有 1 项商业 GA 阻塞） |
| Gate 6 | 0 | 3 | 6 | 3 | 12 | 无 |
| Gate 7（方案） | — | 1（Plugin API） | 7 | — | 8 | 方案性风险 |

## 全项目 Top 10 最严重问题

1. **Shift+Arrow 键盘选区扩展完全缺失**（Gate 3，P0）— 基础编辑能力硬缺口，`packages/core/src/editor/input-runtime.ts`
2. **有选区时按 Enter 无效**（Gate 3，P0）— `text-editing-runtime.ts:1330`，受 deleteRange 仅支持同 run（G1-02）牵连
3. **浮动工具栏格式按钮始终隐藏**（Gate 4，BUG）— `packages/ui/src/selection-actions/dom.ts`
4. **license 签名可伪造**（Gate 5，商业 GA 阻塞）— 32 位 FNV-1a + 可推导 verifier，知道 issuer 即可伪造，GA 前必须换密码学签名
5. **DOCX 导入忽略 `w:val` on/off 语义**（Gate 5，P1）— `<w:b w:val="false"/>` 被导成加粗，数据正确性问题
6. **PDF 导出丢失全部文本样式**（Gate 5，P1）— bold/italic/underline/strike/上下标/背景色不渲染
7. **DOCX 多 section 导出静默丢失分节**（Gate 5，P1）— 且无任何 warning
8. **协作历史 base64 编码栈溢出**（Gate 6，HIGH）— >100KB update 必现崩溃，`client-history.ts:478`
9. **内存泄漏簇**（Gate 1/2/3，P1）— Canvas 池无 dispose、focus/blur 监听器 destroy 不移除、UI 控件监听未清理
10. **Rollup externals 缺失**（Gate 0，P1）— dompurify/jszip 等被打进 dist 产物，包体积虚高且依赖重复

## 整体健康度评价

**架构面：优**。核心不变式经全仓实证全部成立——Y.Doc 唯一真源无旁路写入、所有变更走 Transaction Pipeline（`transaction.ts` 外无 `doc.transact` 调用）、Projection 深冻结只读、History 三 origin 作用域隔离正确、授权校验全线先于读取用户内容、批注用 Y.RelativePosition 锚点、粘贴与 URL 双层安全防护到位。分层设计与 OOXML 对齐策略被评为项目最大长期资产。

**功能面：中**。存在 3 个用户立即可感知的阻断问题（键盘选区、选区回车、浮动工具栏），以及一批"功能骨架完整但语义缺口"问题（Justify 未实现、表格不跨页、修订只标首 run、PDF 丢样式、DOCX toggle 语义错误）。修复集中在 Phase 0-1，工程量可控。

**工程面：良，防线有洞**。lint/typecheck/test/build 链路齐备，但边界防线三层（ESLint、check-boundaries 脚本、架构测试）互不一致且存在真实绕过通道；rollup externals 缺失污染产物；输入热路径 P95 < 50ms 验收长期未达标；超千行文件（最大 2037 行）成为系统性维护风险。

**商业化面：有硬阻塞**。免费/付费边界与 feature key 设计清晰、lazy-load 属实、授权前置正确；但 license 签名可伪造是 GA 硬阻塞，Gate 7 的 Plugin API 前置改造（估 7-10 人周）是 1.0-stable 最大工期风险，bundle size 预算与实际严重脱节需重新校准。

## 结论

项目架构地基扎实（未发现任何 Critical 级架构问题），问题集中在功能完整性、工程防线一致性与商业化收尾三个层面，全部可修复且已在修复计划中排期。建议按修复计划的 Phase 0（本周）→ Phase 1（2-3 周）执行，优先解除三个 P0 阻断，并尽早启动 license 签名替换与 Plugin 扩展点改造两个长周期项。
