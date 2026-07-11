# 产品、DOCX 与编辑能力审查

> 后续决策：默认 SDK 接入改为单 Host `EditorShell`；授权、协作和开放写入范围以[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准。SSO/SCIM、组织/RBAC 和文档 ACL 保留为未来能力，不阻塞 V1。

## 文档与真实代码的一致性

`docs/current-implementation/README.md` 作为入口的组织方式是合理的，包级文档大多能够区分“已实现能力”和“当前限制”。例如 UI 文档明确承认只读不是 core 权限边界、表格粘贴会降级、页眉页脚和修订仍是基础形态：`docs/current-implementation/packages/ui.md:169-179`。

但“当前实现事实”不能直接等价为“当前可交付状态”。本轮发现以下明显偏差：

1. `docs/sdk/quickstart.md:13-28` 未调用 `editor.mount(editorHost)`，也未导入 `@4xian/jword-ui/styles.css`；新版整改不再让普通用户补这两步，而是由 `createJWord({ host })` 的 EditorShell 内部完成 mount，并由文档明确唯一 CSS 引入责任。
2. Quickstart 在 `loadDocumentModel()` 后调用 `createDocument()`：`docs/sdk/quickstart.md:53-69`；而 `createDocument()` 会 replace/reset 文档：`packages/core/src/editor/facade-runtime.ts:45-49`，所以刚打开的内容被覆盖。
3. `docs/sdk/jword-format.md:51-62` 写成 `editor.loadDocumentModel(loaded.document)`；真实类型要求 `{ document: loaded.document }`：`packages/core/src/editor/types.ts:152-158`。
4. `docs/current-implementation/verification-2026-07-07.md:35-56` 记录的全绿结果属于 7 月 7 日快照，不能认证当前 755 个变更路径的工作树。
5. backlog 将 fresh verification 和 publish readiness 标为 Done 的部分，已被本轮 lint/typecheck/dist/no-alias 结果推翻，不能继续作为当前完成态。

结论：文档体系有价值，但需要把“能力存在”“测试曾通过”“当前 RC 可交付”分成三个独立状态，并让自动生成或验证结果绑定 commit SHA、dirty flag 和 artifact hash。

## 已有能力评价

### Core

当前 core 能力并不薄弱：文档结构、Y.Doc store、projection、command/operation/transaction、undo/redo、分页布局、Canvas 渲染、输入法、剪贴板、选区、图片、表格、批注、链接、修订 metadata、查找替换、页眉页脚配置、插件和 diagnostics 均有实现入口。主要证据见 `docs/current-implementation/packages/core.md:49-113`。

架构价值在于：

- 单一 Y.Doc 真源，写路径相对统一。
- projection/layout 对读取侧做隔离。
- DOM 延迟到 mount，便于 Node/SSR 导入。
- 格式包、UI 和协作包没有直接获得 document store 内部写权限。

不足在于“基础能力”和“完整 Word 语义”之间仍有较大距离。例如修订目前主要是 metadata 与接受/拒绝，不是完整 track changes；页眉页脚是 section 属性和 ID 配置，不是独立正文编辑器；复杂表格、浮动对象和交叉引用仍未完成。

### UI

UI 已覆盖专业/常用 toolbar、状态栏、主题、双语、图片、表格、批注、链接、查找替换、目录、页眉页脚、修订、粘贴清洗、只读、selection actions、水印和基础 a11y。功能广度足以支撑产品原型和受控试点。

但企业产品还缺：

- 保存/同步/权限/离线冲突等可理解的产品状态。
- 批注、修订和协作状态的统一工作流。
- 完整键盘操作、焦点管理和人工读屏验证。
- 动态权限、主题和语言在 React/Vue 中的可靠同步。
- 可稳定演进而不暴露内部 DOM 的公共组件契约。

## DOCX 结论

### 当前属于受限子集，不是无损互通

导出器会明确发出 warning 并省略：

- 页眉页脚：`packages/docx/src/diagnostics.ts:163-168`、`packages/docx/src/export.ts:273-283`。
- section 页码：`packages/docx/src/diagnostics.ts:169-174`、`packages/docx/src/export.ts:285-295`。
- 批注：`packages/docx/src/diagnostics.ts:175-180`、`packages/docx/src/export.ts:297-307`。
- 修订 metadata：`packages/docx/src/diagnostics.ts:181-185`、`packages/docx/src/export.ts:309-317`。

导入浮动图片时会 warning 后返回空数组：`packages/docx/src/import-readers.ts:321-340`。复杂表格、嵌套表格、复杂 section、浮动对象、部分图片类型和 opaque relationship 也存在降级或省略路径。

这类行为不是单纯“格式稍有差异”，而是可能丢失客户文档中的业务语义。因此：

- 不得宣传 Office 完全兼容。
- 不得宣传无损 roundtrip。
- 不应默认对未知客户文档执行覆盖式保存。
- 导入和导出 UI 必须在操作前提示兼容级别与可能丢失项，并保留原文件或另存为。

### 人工兼容证据不足

`fixtures/docx/compatibility-results.json:17-130` 中 Word 工具状态为 missing，14 个 Word 桌面 evidence request 均为 pending。Open XML validator 通过只能证明部分结构有效，不能替代 Word 中的打开、修复提示、编辑、保存、重开和视觉对比。

企业交付至少需要按支持级别建立矩阵：

- T1：必须保真的段落、样式、列表、基础表格、行内图片、页面设置。
- T2：明确支持或明确阻断的页眉页脚、页码、批注、修订。
- T3：复杂表格、浮动对象、文本框、域、脚注尾注、交叉引用和复杂 section。

每个 fixture 都要记录 Word 版本、OS、artifact SHA、是否修复、编辑保存重开结果和差异说明。

## `.jword` 原生格式

基础 save/load、manifest、checksum、schema migration 和资源 entry 已存在，但当前仍有三个产品级缺口：

1. **packed resource 重开不闭环**：save 把原 document 写入 `document.json`，同时把 bytes 写入 `resources/*`：`packages/native/src/package-codec.ts:51-68`。load 只返回 document 和资源摘要，没有读出 bytes 并重建 data/blob URL：`packages/native/src/index.ts:81-128`。带 `blobUrl + nativeBytesBase64` 的图片跨会话后仍可能引用失效 URL。
2. **不可信 ZIP 没有资源上限**：`packages/native/src/package-readers.ts:45-53,126-238` 直接加载并解压 JSON entry，没有 entry 数、单项、总解压体积和 JSON 长度限制。对比 DOCX 已有明确包限制：`packages/docx/src/package.ts:77-80`。
3. **版本恢复不是原子操作**：持久化 adapter 先替换文档，再追加 restore 版本；后续保存失败时 API 返回失败，但文档已经改变：`packages/persistence/src/index.ts:498-525`、`packages/persistence/src/storage-history-adapter.ts:285-319`。

因此 `.jword` 还不能被当作完全可靠的企业文档容器。应先完成资源回绑、ZIP bomb 防护、恢复事务和损坏包/大包测试。

## PDF

基础 PDF export、字体和图片路径已实现，适合受控导出。当前文档也明确仅提供 export，CJK 字体通常需要宿主显式配置：`docs/current-implementation/packages/pdf.md:84-92`。

如果定位企业归档或合规交付，还缺 PDF/A、PDF/UA、数字签名、嵌入字体策略、表单/批注处理和长期兼容证据。现阶段不应把“可导出 PDF”扩展为“合规归档 PDF”。

## 无障碍、i18n 与窄屏

当前已有 live region、text mirror、ARIA、键盘和 axe/浏览器测试入口，也有中文/英文和 light/dark 基础。但自动测试不等于企业无障碍认证：

- VoiceOver/NVDA/JAWS 人工矩阵尚未完成。
- SSR 只验证 renderToString，没有 hydration 证据。
- 完整 RTL 仍在 backlog。
- a11y Host 存在 core/UI/wrapper 重复所有权。

窄屏应继续作为响应式适配，不引入独立“移动端编辑器”产品概念。验收重点是分页预览、工具栏可操作性、面板不遮挡和文本不溢出。

## 企业功能缺口

以下不是本轮新增想象，而是源码边界和 `docs/current-implementation/backlog.md` 已暴露的产品缺口：

- 完整 track changes、比较/合并、修订作者策略和审阅工作流。
- 脚注、尾注、题注、交叉引用、域和目录更新。
- 浮动对象、文本框、艺术字、复杂/嵌套/跨页表格。
- 完整 RTL、人工读屏矩阵和可访问导出。
- SSO/OIDC/SAML、SCIM、组织、RBAC、资源级权限和治理审计报表；这些属于未来 Enterprise Governance，不在当前 V1。
- 保存/同步/离线/权限/冲突/企业治理状态。
- 托管协作、备份恢复、保留删除、legal hold、SLA 和支持流程。
- license portal、客户 entitlement 生命周期和 usage metering。
- AI 助手仍应保持研究项，不能先于安全、数据和治理基础。

这些缺口决定了产品更适合“编辑器 SDK beta”而不是“完整企业办公套件”。其中 V1 明确排除的治理能力不再作为当前 OEM 方案的实施阻断，但在未实现前仍不得对外宣称具备相应企业能力。
