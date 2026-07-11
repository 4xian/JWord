# JWord 2026-07-10 全项目审查

> 审查对象：当前 checkout，而不是 2026-07-07 的历史验证快照。
>
> 基准提交：`fb4d8a830d04d4935dc2f076fcc05b9a4b636893`。
>
> 工作树：审查开始时共有 755 个变更路径，因此所有结论都必须绑定本次工作树，不能外推到其它分支或未来 RC。

## 后续产品决策覆盖

本目录保留 2026-07-10 的原始代码事实；整改目标和执行顺序以随后冻结的[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准。发生冲突时采用以下新版口径：

- JWord V1 只授权一级 OEM，不建设 tenant、组织、RBAC、ACL、SSO 或 SCIM。
- 一个协作 deployment 只绑定一个 OEM license，`documentId` 在整个 deployment 内唯一。
- deployment admission 产生可信 `actorId`；通过准入的用户对文档固定获得 `write`。
- 原 `tenantId`、`tenantHook` 和 comment-only role 事实仍是历史审查证据，但不再作为 V1 的目标 interface。
- 当前执行顺序已经调整为：第一批只恢复 `pnpm typecheck`；第二批实现单 Host `EditorShell`；之后再按 OEM 方案推进授权、格式和协作迁移。

## 总判定

**REQUEST CHANGES：当前 checkout 不能作为成熟企业级 Word 替代品、公共 SDK GA 或生产级协作服务直接售卖。**

JWord 不是空壳。core 已形成 Y.Doc 真源、Command -> Operation -> Transaction 写入路径、只读 projection、分页 Canvas、输入运行时、图片、表格、批注、修订、查找替换、插件与 diagnostics；UI、native、DOCX/PDF、协作、持久化和框架 wrapper 也已有相当规模。包边界与写入路径的总体方向合理。

但当前存在会直接阻断商业交付的问题：

1. 默认授权信任根对应的测试私钥公开在仓库中，默认商业授权可被伪造。
2. HTTP auth hook 无法读取真实凭据，认证用户没有贯穿到 history 作者；新版整改目标是统一 deployment admission 与可信 `actorId`，V1 不宣称多租户隔离。
3. `.jword` 解压没有 entry、单项、总解压体积或 JSON 大小上限。
4. 官方 Quickstart 未 mount editor、未导入 UI CSS，重开示例还会覆盖刚加载的文档。
5. 当前 `lint`、`typecheck` 和文件预算门禁为红灯；2026-07-10 再次运行 `pnpm typecheck` 时，已确认 32 个错误集中在 vanilla E2E/辅助代码把 `__jwordDemo` 的可选成员当作必选调用。
6. release dry-run 返回成功，但当前 `dist` 不能被 Node ESM 导入；第三方 no-alias smoke 也在安装阶段失败。
7. DOCX 导出明确丢弃页眉页脚、页码、批注和修订，Word 桌面兼容证据仍全部 pending。
8. 默认协作容器只启动 HTTP、使用易失 history、没有可用 auth 配置，也没有 WebSocket 文档持久化闭环。

修完 P0 后，才适合进入受控客户 PoC 或限定范围的私有 SDK beta。企业 GA 还需要完成 P1 的协作数据面、治理、兼容矩阵、无障碍、发布与运维闭环。

## 报告导航

- [01-executive-sale-readiness.md](01-executive-sale-readiness.md)：管理层结论、能力矩阵、可售卖边界。
- [02-architecture-host-and-api.md](02-architecture-host-and-api.md)：架构评价、Host 设计、公开 API 和过度设计。
- [03-product-docx-and-editor-capabilities.md](03-product-docx-and-editor-capabilities.md)：编辑能力、DOCX/native、产品缺口与文档一致性。
- [04-collaboration-security-and-licensing.md](04-collaboration-security-and-licensing.md)：授权、deployment admission、开放写入、文件安全、持久化与依赖安全。
- [05-engineering-quality-release-and-operations.md](05-engineering-quality-release-and-operations.md)：工程门禁、测试、CI、发布产物和运维。
- [06-remediation-roadmap.md](06-remediation-roadmap.md)：P0/P1/P2 整改顺序与验收条件。
- [07-issues-register.md](07-issues-register.md)：去重后的问题台账。
- [08-verification-evidence.md](08-verification-evidence.md)：本轮命令、结果、未执行项和证据边界。

## 证据等级

| 等级 | 含义 |
| --- | --- |
| 运行复现 | 本轮在当前工作树执行命令或最小运行时探测，结果可重复。 |
| 静态确认 | 由当前源码控制流、类型和调用关系直接确认。 |
| 能力缺口 | 源码、backlog 或人工矩阵明确显示尚未完成。 |
| 风险/待验证 | 存在合理风险，但本轮没有完成端到端动态复现，不写成确定故障。 |

## 审查方法与边界

- 先阅读 `docs/current-implementation/README.md`，再沿每个包的源码、公开 API、测试和发布脚本核对。
- 结构问题先使用当前 `.codegraph` 索引，再用精确源码读取和 `rg` 补证。
- 三个并行审查方向分别覆盖架构/Host、产品/企业能力、工程/安全；主进程负责交叉核验、去重和严重度校准。
- 没有执行真实 publish，没有修改业务源码，没有主动提交代码。
- 未运行会先执行完整 build 并改写 `dist` 的 `pnpm test`，也未把 2026-07-07 的历史全绿记录当作本轮结果。

## 正向评价

- core 保持框架无关，DOM 延迟到 mount，Node/SSR 导入边界意识较好。
- 文档写路径统一走 command/transaction，读取侧使用 projection/layout，方向清晰。
- package 按 core、UI、格式、协作、持久化、授权和 wrapper 拆分，总体职责划分合理。
- 已建立单元、类型、架构、安全、E2E、视觉、性能、体积和第三方消费等多类门禁。
- diagnostics 有隐私裁剪，插件异常有隔离，粘贴使用 DOMPurify 后转换为结构化片段。

这些优点说明项目值得继续产品化，但不能抵消当前安全、数据完整性、兼容性和发布链的阻断问题。
