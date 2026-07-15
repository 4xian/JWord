# 当前结论与交付边界

## 当前结论

JWord 已具备编辑器 core、UI、native、DOCX/PDF、协作、持久化、License 和框架 wrapper，但以下闭环仍未完成：

- 生产 License 信任根和 JWL2 runtime。
- 不可信 `.jword` 文件资源预算和严格 schema 校验。
- 原子恢复、资源重开和远端纯删除 update 的投影刷新。
- 可安装 artifact、第三方消费、发布 metadata 和回滚证据。
- Formats 授权迁移、DOCX 受限兼容和用户可见数据损失处理。
- 协作 admission、可信 `actorId`、多实例 history 和生产数据面。
- wrapper 动态状态、iframe/跨 realm 和 UI 生命周期完整性。

因此当前不能宣称已经达到正式商业交付或企业 GA。

## 当前 P0

1. `SEC-01`：默认验签公钥对应仓库公开测试私钥，商业 token 可伪造。
2. `SEC-02/COLLAB-01/COLLAB-02`：协作 admission 无真实凭据，history 作者和时间来自客户端 body。
3. `SEC-03/FMT-01`：`.jword` 解压没有输入、entry、解压体积、压缩比和 JSON 预算。
4. `SEC-04/PERS-01`：restore 先修改目标文档再持久化，失败后状态不一致。

## 交付边界

### 内部技术实施

可以继续。不得把设计文档写成已实现能力，不得执行真实 publish。

### 受控 PoC

至少关闭 `SEC-01`、`SEC-03/FMT-01`、`SEC-04/PERS-01`，并使用真实 tarball 完成创建、编辑、保存、重开和销毁。对外 PoC 还需要完成法律审核。

### Base + Professional Editing + Formats

需要完成 License Phase 1、Formats 授权迁移、JWL1 删除、artifact 消费、格式数据损失处理、受限 DOCX 兼容说明和商业发布门禁。

### Collaboration

当前不进入首期销售。销售前必须完成统一 admission、可信 `actorId`、deployment license context、持久化、多实例并发、备份恢复和生产部署验证。

### 公共 SDK GA

除上述条件外，还需要关闭公开支持范围内的 P1，完成 wrapper、iframe/跨 realm、人工 a11y、兼容矩阵和发布运维闭环。

## 状态规则

- `Open`：问题仍存在。
- `In Progress`：已开始修改，但退出标准未全部满足。
- `Closed`：聚焦验证和阶段验证通过，证据已记录。
- `Deferred`：明确不属于当前销售或实现范围，并有进入条件。

没有代码位置、验证命令和结果时，不得把问题标记为 `Closed`。
