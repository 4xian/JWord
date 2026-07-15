# JWord 当前全项目审查

> 当前判定：`REQUEST CHANGES`。项目可以继续内部技术实施，但尚未达到公共 SDK GA、正式商业交付或生产级协作服务标准。

## 阅读顺序

1. [01-current-conclusion.md](01-current-conclusion.md)：当前结论和交付边界。
2. [09-remediation-roadmap.md](09-remediation-roadmap.md)：当前阶段、下一步任务和退出标准。
3. [08-issues-register.md](08-issues-register.md)：全部开放问题及阶段归属。
4. [02](02-security-and-licensing.md) 至 [06](06-ui-and-wrappers.md)：问题证据、修复步骤和最小验收。
5. [07-oem-and-system-mapping.md](07-oem-and-system-mapping.md)：问题与 OEM Phase/LIC 任务的对应关系。
6. [10-verification-plan.md](10-verification-plan.md)：每阶段验证命令和证据要求。

## 当前下一步

执行 License 深模块阶段：

- 修复 `SEC-01`：生产信任根对应公开测试私钥、测试 signer 暴露、调用方可换根。
- 修复 `SEC-06`：自研 Ed25519/SHA-512 缺少成熟实现或独立审计。
- 对应 OEM `LIC-100` 至 `LIC-111`。
- 前置输入：获得批准的 `jword-prod-2026-k1` 生产公钥；缺失时保持 fail closed，不得用测试或临时密钥代替。
- 完成后停止，不自动进入 native、DOCX、协作或 UI 阶段。

## 文档职责

- 产品、商业和法律输入：[OEM License Phase 0 决策记录](../../oem-licensing-phase0-decision-record.md)。
- License/JWL2/OEM 技术设计：[OEM 实施方案](../../oem-licensing-open-access-implementation-plan.md)。
- 全项目实施顺序：[09-remediation-roadmap.md](09-remediation-roadmap.md)。
- 当前问题和状态：[08-issues-register.md](08-issues-register.md)。
- 完成证据：[10-verification-plan.md](10-verification-plan.md)。

文档与源码冲突时，以当前源码和可复跑验证为准，并立即回写本目录。
