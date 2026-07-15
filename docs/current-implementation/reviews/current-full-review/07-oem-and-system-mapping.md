# OEM 与全项目问题映射

## 1. 边界

OEM 实施方案负责 License、商业模块授权、协作 deployment license 和发布运营。它不自动修复 core、native、DOCX/PDF、UI、wrapper 或持久化中的正确性问题。

全项目路线负责安排两类任务的先后顺序，并在发布阶段汇总退出条件。

## 2. OEM Phase 映射

| OEM 阶段 | 负责内容 | 对应当前问题 | 全项目阶段 |
| --- | --- | --- | --- |
| Phase 0 | SKU、期限、分发、claims、部署边界 | `LIC-013` 法律门禁 | 已冻结；法律门禁保留到阶段 7 |
| Phase 1 | JWL2、trust store、opaque handle、测试密钥隔离、密码实现 | `SEC-01`、`SEC-06` | 阶段 1 |
| Phase 2 | Professional Editing、DOCX/PDF、worker 授权迁移 | 与 `FMT-03/04/05/06/07/08/09` 共用发布门禁，但不是同一修复 | 阶段 4A |
| Phase 3 | deployment license context、admission、可信 actorId、开放写入 | `SEC-02/COLLAB-01/COLLAB-02`、`COLLAB-04` | 阶段 6A |
| Phase 4 | 删除 JWL1、raw entitlement、旧 feature key 和兼容入口 | License 迁移完整性 | 阶段 4C |
| Phase 5 | 签发、轮换、续期、分发、法律和发布运营 | `LIC-013`、artifact 和发布门禁 | 阶段 7 |

## 3. 不属于 OEM 的问题

| 领域 | 当前问题 | 处理阶段 |
| --- | --- | --- |
| native 输入安全 | `SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10` | 阶段 2A |
| 恢复和资源 | `SEC-04/PERS-01`、`FMT-03`、`PERS-03` | 阶段 2B |
| core 投影 | `CORE-01`、`CORE-05` | 阶段 2C |
| artifact 和消费 | tarball、CI、metadata、provenance、rollback | 阶段 3 |
| Formats 正确性 | `FMT-05`、`FMT-07`、`FMT-08`、`FMT-09` | 阶段 4B |
| core/plugin | `CORE-02`、`CORE-04`、`CORE-06`、`CORE-07` | 阶段 5 |
| UI/wrapper | `UI-01` 至 `UI-09` | 阶段 5 |
| 协作数据面 | `PERS-02`、`SEC-05/COLLAB-05/COLLAB-06`、`COLLAB-07` | 阶段 6B |

## 4. 关键依赖

### License 与 Formats

Phase 2 只把商业入口迁移到 opaque handle/transfer。native 资源预算、schema、取消、图片重开和 DOCX 有损行为必须由对应 finding 独立关闭；否则授权正确也不能发布 Formats。

### License 与 Collaboration

Phase 3 同时承接 deployment license 和 admission。License 只决定 deployment 是否拥有 `collaboration` 模块，admission 决定请求是否进入文档；两者不得合并成浏览器 entitlement。

### Collaboration 与首期发布

Collaboration 保持 private/unpublished 时，阶段 6 不阻断 Base + Professional Editing + Formats。要销售或部署 Collaboration 时，阶段 6A 和 6B 必须全部完成。

### 法律与内部实施

法律门禁不阻止内部实现和 release rehearsal，但阻止真实 npm 发布、商业 package 交付、收费 PoC 和签约。

## 5. 当前执行关系

1. 先执行 OEM Phase 1，关闭 `SEC-01`、`SEC-06`。
   Phase 1 依赖批准的 `jword-prod-2026-k1` 生产公钥；缺失时只能继续非密钥子任务，不能关闭阶段。
2. 再执行 native、恢复和 core 数据正确性。
3. 建立可安装 artifact 和第三方消费基线。
4. 执行 OEM Phase 2、Formats 正确性和 OEM Phase 4。
5. 处理 core、UI 和 wrapper 产品化问题。
6. Collaboration 只有在明确批准后进入 OEM Phase 3 和生产数据面。
7. 最后执行 OEM Phase 5、法律审批和真实发布门禁。
