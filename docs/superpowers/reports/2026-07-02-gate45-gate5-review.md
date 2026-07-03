# Gate 4.5（JWord 原生保存与打开）与 Gate 5（DOCX/PDF 互通）代码审查报告

- 日期：2026-07-02
- 分支：feature/docx
- 审查范围：`packages/native`、`packages/docx`、`packages/pdf`、`packages/license`、`examples/docx`、`fixtures/docx`、`fixtures/pdf`、`tools/compat`、`tests/architecture/gate45-*`、`tests/architecture/gate5-*`
- 严重级别定义：**P1** = 必须修复的 bug/语义错误；**P2** = 风险或缺陷，建议本 Gate 内修复；**P3** = 建议/优化；**正面** = 值得保持的设计。

---

## 一、总体结论

| 区域 | 评级 | 一句话结论 |
|------|------|-----------|
| packages/native | 良好，有 2 个 P1 | zip 结构与诊断体系设计合理；错误码误用与空迁移步骤需修复 |
| packages/docx | 良好，有 2 个 P1 | OPC/索引/opaque 保留设计诚实；run 属性 toggle 语义错误与多 section 导出丢失需修复 |
| packages/pdf | 良好，有 2 个 P1 | 换算与授权正确、缺字体拦截有效；文本样式渲染缺失与 Latin-1 误判需修复 |
| packages/license | 开发阶段可接受 | 契约清晰；签名强度不足，商业发布前必须替换 |
| examples/docx | 优秀 | 懒加载、取消会话、授权场景覆盖完整 |
| fixtures | 良好/早期 | DOCX 证据链完整；PDF fixture 仅 1/5 就绪；外部工具证据全部 pending |
| tools/compat | 优秀 | 证据绑定防伪严谨，不伪造结果 |
| tests/architecture | 优秀 | 门禁覆盖全面（边界/预算/诊断/商业就绪） |

**Gate 判定建议**：Gate 4.5 与 Gate 5 的骨架与门禁质量高，但存在 6 个 P1 问题（见下），建议修复 P1 后再宣布 Gate 通过。DOCX/PDF 的 Worker 路径已实现但未被示例演示（见横切问题 X-1），"Worker 执行"这一 Gate 5 目标只有消息层实现、缺端到端闭环。

---

## 二、P1 问题汇总（必须修复）

| 编号 | 包 | 位置 | 问题 |
|------|-----|------|------|
| N-1（R2 订正为 P2） | native | `packages/native/src/index.ts:630` | **大部分已过时**：`readDocument`（696）已用 `JWORD_NATIVE_DOCUMENT_INVALID`、`readChecksums`（660）已用 `JWORD_NATIVE_CHECKSUMS_INVALID`，且三者各有独立 `*_MISSING` 码。**唯一残留**：`readMetadata` 的 catch（630）仍误报 `JWORD_NATIVE_MANIFEST_INVALID`。降级为 P2。详见三节 N-1 订正条目 |
| N-2 | native | `packages/native/src/index.ts:868-882` | schema 0→1 迁移为空操作却声称执行了 `schema-0-to-1`；无 migration step chain，无法扩展到 v2+ |
| D-1 | docx | `packages/docx/src/import-readers.ts:78-89` | bold/italic/underline/strike 只检查元素存在性，`<w:b w:val="false"/>`、`<w:b w:val="0"/>` 会被误判为加粗，违反 OOXML on/off toggle 语义 |
| D-2 | docx | `packages/docx/src/export.ts:547-554` | 导出把所有 section 的 blocks 摊平进单一 body，只写最后一个 section 的 `sectPr`；多 section 文档静默丢失分节符与前面各节页面设置，且无任何 warning |
| P-1 | pdf | `packages/pdf/src/index.ts:390-406` | `renderPdfTextFragment` 只传 x/y/size/font/color，bold、italic、underline、strike、上下标、背景色（`packages/core/src/layout/font-manager.ts:13-34` 的 ResolvedFontStyle）全部丢失 |
| P-2 | pdf | `packages/pdf/src/index.ts:757-769,817-827` | `containsNonAsciiText` 以 codePoint>127 判定"需嵌入字体"，é/ü 等 Latin-1 字符 Helvetica 本可编码，未配置嵌入字体时含法语/德语文本的文档导出直接失败 |

### R2 复审对 P1 的逐条核实结论

| 编号 | R2 结论 | 证据 |
|------|---------|------|
| N-1 | **部分属实（降级 P2）** | `readMetadata` catch（`native/src/index.ts:630`）仍误报 MANIFEST_INVALID；但 document/checksums 已修复。见 N-1 订正条目 |
| N-2 | **属实** | `migrateDocument`（`native/src/index.ts:868-885`）`sourceVersion===0` 原样返回却写 `appliedSteps:['schema-0-to-1']`，if/else 硬编码无迁移链 |
| D-1 | **属实** | `import-readers.ts:78-89` 四个 toggle 仅 `children.some(localName===...)`，未读 `w:val`；同文件 70 行有 `resolveImportRunStyleId`、406 行有 `readOnOffValue` 却未复用 |
| D-2 | **属实** | `export.ts:548` `flatMap` 摊平全部 section，552-553 只写最后一个 section 的 sectPr；`collectExportUnsupportedWarnings`（274-326）确认无多 section warning |
| P-1 | **属实** | `pdf/src/index.ts:399-405` `drawText` 只传 x/y/size/font/color，ResolvedFontStyle 的 bold/italic/underline/strike/上下标/背景色全丢 |
| P-2 | **属实** | `pdf/src/index.ts:817-827` `containsNonAsciiText` 以 codePoint>127 判定，误伤 WinAnsi 可编码的 Latin-1 |

---

## 三、packages/native（Gate 4.5）

### 文件与职责

`types.ts`（常量/类型/错误码）、`utils.ts`（JSON/SHA-256 工具）、`validation.ts`（一致性校验）、`messages.ts`（worker 消息构造）、`worker.ts`（worker 运行时）、`index.ts`（save/load/validate 公开 API）。

### P1

**N-1（R2 订正，降级为 P2）错误码语义——大部分已修复，仅 metadata 残留一处**（`src/index.ts:630`）

R2 逐行复核发现首轮结论**大部分已过时**：

- `readDocument`（`src/index.ts:687-699`）已在 catch 使用 `JWORD_NATIVE_DOCUMENT_INVALID`，并在 690-691 行对主结构（`kind`/`id`/`sections`）做针对性校验后抛 `JWORD_NATIVE_DOCUMENT_INVALID`。
- `readChecksums`（`src/index.ts:657-663`）catch 已使用 `JWORD_NATIVE_CHECKSUMS_INVALID`。
- 三者（metadata/document/checksums）都已有各自独立的 `JWORD_NATIVE_*_MISSING` 缺失码（616/676/649 行）。

**唯一残留真实问题**：`readMetadata` 的 catch（`src/index.ts:630`）仍写 `JWORD_NATIVE_MANIFEST_INVALID`，`metadata.json` 内容损坏时会误报"manifest 无效"。同时底层 `parseJsonRecord`/`readString`/`readNumber`/`readStringArray`（804-845 行）在被 manifest 之外的场景复用时仍硬编码 `JWORD_NATIVE_MANIFEST_INVALID`，但当前 `readMetadata` 只调用 `parseJsonRecord`（未逐字段读 metadata），故实际影响面仅 630 行一处。
**修复建议**：将 `readMetadata` catch 改为 `JWORD_NATIVE_METADATA_INVALID`（需在 types.ts 补该码），或让 `parseJsonRecord` 接收 error code 参数由调用方注入。严重度从 P1 降为 P2。

**N-2 空迁移步骤 + 无迁移链机制**（`src/index.ts:868-882`）
`sourceVersion === 0` 分支原样返回 document，却在 `report.appliedSteps` 写入 `'schema-0-to-1'`。若 0 和 1 无结构差异则命名误导；若有差异则数据未被迁移。且当前用 if/else 硬编码，未来 v2/v3 需要逐级迁移（0→1→2→3）时无法扩展。
**修复建议**：建立 `migrationSteps: ReadonlyArray<{ from: number; to: number; migrate(doc): doc }>` 注册表，循环应用直至 `CURRENT_SCHEMA_VERSION`；为每个 step 配 fixture 验证实际数据转换。

### P2

- **manifest.json 自身不受 checksum 保护**（`src/index.ts:441` 附近 `createChecksums`）：只覆盖 document.json、metadata.json 和资源文件；篡改 manifest 的 `featureFlags`/`resources` 列表无法被检出。建议把 manifest.json 纳入 checksums，或增加包级摘要。**（R2 复审已精确确认）**：`createChecksums`（`src/index.ts:441-445`）的 `checksumEntries` 明确为 `['document.json', 'metadata.json', ...resources]`，且加载校验 `inspectChecksums`（`src/index.ts:710`）只遍历 `checksums.entries`——manifest.json 既不在计算集也不在校验集，`checksums.json` 自身也不参与自校验。攻击者可任意改写 manifest 与 checksums 而不被发现。
- **worker 并发与取消竞态**（`src/worker.ts:50-95`）：同一 requestId 重复请求会覆盖 Map 中旧任务引用，旧任务不可取消也不被清理；cancel 先于任务注册到达时静默发 cancelled 事件，但真实任务随后照常执行。建议：requestId 冲突时立即拒绝；cancel 时记录"预取消"集合。
- **校验循环不检查 AbortSignal**（`src/index.ts:703-734` `inspectChecksums`）：逐 entry 计算 SHA-256 期间不可取消，大包场景取消不生效。
- **诊断与警告重复**（`src/index.ts:225`）：`diagnostics` 拼入了 `migrated.report.warnings`，同一条信息在 `diagnostics` 与 `warnings` 两个字段重复出现。
- **深递归栈溢出风险**（`src/validation.ts:193-212` `collectNestedResourceIds`）：恶意构造的极深嵌套 document JSON 可打爆调用栈。建议改为显式栈迭代。
- **缺少 zip 炸弹/大小防护**：解压总量、单文件大小、`JSON.parse` 输入长度、checksums 条目数均无上限；checksums entry key 未显式做路径穿越检查；`metadata.json` 只要求是 JSON 对象，`createdAt` 等已知字段类型不校验。

### P3

- load/validate 进度只有开始/结束两个点，save 才有细粒度 percent（`src/worker.ts`、`src/index.ts`）。
- `isEditor` 守卫只检查 `getProjection` 是函数（`src/index.ts:272-284`），任何带该方法的对象都会误判。
- `sha256Hex` 与 save-result transferables 各多一次不必要的内存拷贝（`src/utils.ts:22`、`src/messages.ts`）。
- `stringifyJson` 的尾换行参与 checksum 计算（`src/utils.ts:29`），序列化格式即持久化契约，应在注释/规范中显式冻结。
- 资源 ID 用 `encodeURIComponent` 编码为路径，Unicode ID 会产生冗长不可读的 entry 名。

### 正面

- `.jword` 结构（manifest/document/metadata/checksums/resources）划分清晰，`minimumReaderVersion` + `featureFlags` 提供前向兼容；SHA-256 + byteLength 双重校验。
- 损坏文件诊断覆盖面广：zip 解析失败、四个核心 JSON 缺失/解析失败、版本不兼容、packageEntries 完整性、资源 checksum/MIME 不一致、未声明资源引用均有稳定诊断码。
- 高版本文件明确抛 `JWORD_NATIVE_SCHEMA_FUTURE`，不做危险降级。

---

## 四、packages/docx（Gate 5）

### P1

**D-1 run 属性 on/off toggle 语义错误**（`src/import-readers.ts:78-89`）

```ts
if (children.some((child) => child.localName === 'b')) {
  properties.bold = true
}
```

OOXML 中 `<w:b w:val="false"/>`、`<w:b w:val="0"/>` 表示显式关闭加粗（常用于覆盖样式继承）。当前实现只看元素是否存在，四个 toggle（b/i/u/strike）全部会把"显式关闭"误读成"开启"。Word/WPS 产出的真实文档大量使用该写法。值得注意的是同文件 `import-readers.ts:406-409` 已有现成的 `readOnOffValue` helper，却未用于这四个属性。
**修复建议**：四个 toggle 改用 `readOnOffValue` 读取 `w:val`，`false/0/none/off` 视为 false；underline 还需处理 `w:val="none"`。

**D-2 多 section 导出静默降级**（`src/export.ts:547-554`）

```ts
const blocks = projection.document.sections.flatMap((section) => section.blocks)
...
writeSectionPropertiesXml(projection.document.sections[projection.document.sections.length - 1])
```

所有 section 的块被摊平，仅末尾写最后一个 section 的 `sectPr`。分节符、各节独立页面尺寸/边距全部丢失，且 `collectExportUnsupportedWarnings`（`src/export.ts:274-326`）没有对应 warning——违反本包自己声明的"unsupported 内容通过 warning 表达，不伪装成已支持"原则。roundtrip diff 会暴露 sectionCount 差异（这点诚实），但导出 API 单独使用时调用方毫无感知。
**修复建议**：至少补 `DOCX_MULTI_SECTION_EXPORT_UNSUPPORTED` warning；正确做法是在每个 section 最后一个段落的 pPr 写入 sectPr。

### P2

- **XML 数字字符引用不解码**（`src/xml.ts:325-332` `decodeXml`）：只处理五个预定义实体，`&#8212;`/`&#x4E2D;` 会以字面量进入文本内容，导入文本被污染。修复：补 `/&#x?[0-9a-f]+;/gi` 解码。
- **不支持 CDATA**（`src/xml.ts:100-147` `parseElement`）：遇到 `<![CDATA[...]]>` 直接抛 `XML_PARSE_INVALID`。CDATA 在 OOXML 中合法（少见但存在）。
- **namespace 解析不继承祖先声明**（`src/xml.ts:246-259、283-292`）：`createElement` 只在元素自身属性里找 `xmlns:*`，而 OOXML 的 namespace 通常只声明在根元素上，因此几乎所有子元素 `namespaceUri` 为 undefined，实际匹配全部退化为 prefix/localName 字符串比较。使用非常规 prefix（如 `ns0:document` 绑定 wordprocessingml namespace，某些生成器会这样输出）的合法 DOCX 无法正确识别。声称的 "namespace-aware" 只对常规 `w:` 前缀成立。修复：解析时维护 namespace scope 栈，按 URI 匹配。
- **段落/单元格内未知元素静默丢弃**（`src/import.ts:417-486`、`342-390`）：`fldSimple`、`bookmarkStart/End`、`sdt`、`smartTag` 等段落级子元素既不导入也不产生 warning、不进 opaque fragments（body 级未知元素有 warning，段落级没有）。另外 `model.ts:149-156` 有 bookmark inline 的转换分支，但 import 端从不产生 bookmark，属死代码，印证 bookmark 导入缺失。
- **`w:color w:val="auto"` 产生非法颜色**（`src/import-readers.ts:94-99`）：`'#' + 'auto'` → `#auto`。应把 `auto` 映射为 undefined 或主题默认色。
- **导出 `w:shd` 缺少必需属性 `w:val`**（`src/export.ts:803-808`）：CT_Shd 的 `w:val` 是 schema 必需属性，OpenXML validator 会报错，影响"Transitional 标准合规"目标。应写 `<w:shd w:val="clear" w:color="auto" w:fill="..."/>`。同理 `<w:u/>` 无 `w:val`（`src/export.ts:749`），Word/WPS 对缺 val 的 w:u 多数按无下划线处理，下划线格式实际会丢。
- **图片导出静默丢弃**（`src/export.ts:360-385、841-846`）：resource 非 success/非 dataUrl/非 PNG-JPEG 时被跳过，引用它的 image inline 直接输出为空，无 warning。
- **worker 无进度事件、有取消竞态**（`src/worker.ts:51-93`）：`createDocxProgressEvent`（`src/messages.ts:20-31`）从未被 dispatch 调用，import/export 全程无中间进度，Gate 5 的 "worker progress" 只有消息形状没有实现；cancel 先于任务注册到达时，任务照常执行并 post 结果，调用方会先收到 cancelled 错误事件再收到成功结果。
- **媒体字节内存放大**（`src/package.ts:651-658`）：`Array.from(uint8array)` 把二进制转 number[]（≈8 倍内存）；`src/model.ts:338-346` `bytesToBase64` 逐字节字符串拼接，大图导入性能差。建议中间模型保留 Uint8Array（配合结构化克隆传输），或分块 base64。
- **缺失 part 静默返回空内容**（`src/package.ts:900-911`）：`readPartText`/`readPartBytes` 对 zip 中不存在的 part 返回 `''`/空数组，调用点若未先检查 `parts.includes(...)` 会把损坏包当空内容处理。
- **批注文本读取逻辑有误**（`src/package.ts:671-678`）：`readXmlChildren(text).length === 0 ? readElementText(text) : ''` —— `w:t` 一旦含子元素其文本被清空为 `''`，该 children 判断多余且有害，批注正文可能丢失。**（R2 复审补充）** 同一 `buildCommentsIndex` 还有第二处隐患：`createDocxImportCommentId(readXmlAttribute(comment, 'w:id') ?? '')`（`src/package.ts:672`）在 `w:id` 缺失时兜底为空字符串 `''`，多个无 id 批注会共享空 id 相互覆盖/错配。建议缺 `w:id` 时跳过并产 warning，而非静默用空 id。另外 `readElementText`（`src/package.ts:872-873`）本身是递归展开所有后代文本节点，与此处"含子元素就清空"的判断自相矛盾，应统一为直接 `readElementText(text)`。
- **commentRangeEnd 在段落尚无 run 时静默丢弃**（`src/import.ts:427-439`）：`runs.length === 0` 时 end marker 既不附着也不发 warning；同理段落结束时未消费的 pendingMarkers（start marker 后无 run）也被丢弃，跨段批注范围可能残缺。
- **负数页边距被丢弃**（`src/import-sections.ts:149-153`）：`pgMar` 用 `readPositiveNumber` 读取，OOXML 允许负 margin（如页眉悬挂），负值被静默归零丢失。
- **`normalizePartPath` 对多余 `..` 无防御**（`src/package-paths.ts:31-48`）：越界的 `../` 相对 Target 会被静默解析为错误路径导致关系丢失且无 warning。
- **入口静态 re-export 拉入 JSZip**（`src/index.ts:15、27`）：`exportDocx`/`inspectDocxPackage` 静态 re-export 自依赖 JSZip 的模块，无 bundler 的 Node ESM 环境下加载 docx 入口即加载 JSZip。应用层懒加载（整包动态 import）不受影响，但包内部无按需分层。
- **（R2 复审补充，P2）DOCX 解压无 zip 炸弹/大小防护**（`src/package.ts:253`）：`JSZip.loadAsync(input)` 直接解压外部 `.docx`，无解压总量上限、单 part 大小上限、part 数量上限或 `JSON.parse`/XML 输入长度上限。DOCX 处理的是**不受信任的外部文件**（比 native `.jword` 风险面更大：native 至少是本应用自己产出的格式），恶意构造的高压缩比 DOCX 可打爆 worker 内存。首轮报告只在 native 部分提了 zip 炸弹，未针对 docx 明确指出。**修复建议**：解压前检查 `zip.files` 条目数与累计 `_data.uncompressedSize`，超阈值 fail-fast；对 `word/document.xml` 等文本 part 设置读取字节上限。
- **（R2 复审补充，P2）toggle 属性被误读后不产生 warning，数据丢失完全静默**（`src/import-readers.ts:78-89,146-157`）：与 D-1 同源但独立——`appendUnsupportedRunPropertyWarnings` 的 `supported` 集合（146-157 行）包含 `b/i/u/strike`，因此这四个 toggle 即便被 `<w:b w:val="false"/>` 误读为开启，也**不会进入任何 warning**。结果：显式关闭的加粗被静默翻转，调用方（含 roundtrip diff 的 warning 对比）完全无感知。**修复建议**：D-1 修复（改用 `readOnOffValue`）落地后此项自动缓解；在此之前至少对 `w:val` 存在但非 true 的 toggle 输出诊断。
- **（R2 复审补充，P3）underline 不区分 `w:val="none"` 且不处理下划线线型**（`src/import-readers.ts:84-86`）：`children.some((child) => child.localName === 'u')` 把 `<w:u w:val="none"/>`（显式关闭下划线）误读为开启，也丢弃 `single/double/dotted` 等线型信息。属 D-1 toggle 家族的下划线特例，单独记录以免修复时遗漏 `none`。

### P3

- `mainDocumentPart` 未处理以 `/` 开头的绝对 Target（`src/package.ts:200-206`）；Content_Types 的 Default Extension 匹配大小写敏感（`src/package.ts:482-503`），OPC 规定扩展名比较不区分大小写。
- **roundtrip snapshot 覆盖缺口**（`src/roundtrip.ts:130-220`）：run.link（超链接目标）、run.field、段落 tabs、bookmark、comment 数据均不在 snapshot 中，这些能力的 roundtrip 回归是盲区。**R3 订正**：canonical plan 将 hyperlink 列为 T2，不应写成 T1 完成阻塞；应表述为 T2 hyperlink roundtrip/回归增强缺口。
- 每个带链接的 run 单独包一层 `<w:hyperlink>`（`src/export.ts:630-638`），相邻同目标 run 不合并，文件略膨胀但合法。
- XML 闭合标签用全限定名字符串精确匹配（`src/xml.ts:115`），namespace prefix rebinding 场景可能误配。
- 段落级 lineHeight 被下沉到 run properties（`src/import.ts:499-512`），导出侧只取第一个 run 的值（`src/export.ts:716-727`）——语义可逆但脆弱，run 级差异会丢。
- `registerDocxWorkerRuntime` 在模块加载即执行副作用（`src/worker.ts:264`），非 worker 环境导入 worker 模块也会注册监听（有环境探测保护，风险低）。
- helper 重复定义：`src/export-utils.ts:229-250` 与 `src/roundtrip.ts:276-292` 的 readStringProperty/readNumberProperty；转义实现两套风格（`src/export-utils.ts:216-221` 与 `src/xml.ts:315-322`）；`src/compatibility.ts:213-215` `createPendingAppResults` 为死代码。

### 正面

- 授权校验严格前置：`import.ts:74`、`package.ts:69/103`、`export.ts:110`、`worker.ts:106/121/135` 都在读取任何用户内容（zip 解析）之前执行 `assertJWordFeatureEntitled`。
- opaque preservation 设计诚实：`unsafeToPreserveAfterEdit` 标记 + 导出时只回写 safe part/relationship + skip warning（`src/export.ts:217-271`），不伪装保真。
- 确定性导出：固定 zip entry 日期为 1980-01-01（`src/export.ts:65、159-165`），相同投影导出相同哈希，支撑 compat 工具的 SHA-256 证据绑定。
- roundtrip 闭环真实：`src/roundtrip.ts:92-127` 走 `createEditor().loadDocumentModel` 而不是绕过 pipeline 对拷。
- OOXML indexes（style/numbering/relationship/media/comments/headerFooter）结构完整（`src/package.ts:513-539`），table style 与非 bullet/decimal 编号格式如实输出 warning 不伪装支持。
- OPC 解析对缺失 Content_Types、根 rels、主文档 part 有稳定错误码；断裂 relationship 有恢复性 warning（`src/package.ts:960-989`）。
- 手写 XML parser 不处理 DTD/外部实体，天然免疫 XXE 与实体膨胀攻击。

---

## 五、packages/pdf（Gate 5）

### P1

**P-1 文本样式渲染缺失**（`src/index.ts:390-406`）
`renderPdfTextFragment` 只传 x/y/size/font/color，完全未处理 ResolvedFontStyle（`packages/core/src/layout/font-manager.ts:13-34`）中的 bold、italic、underline、strike、superscript/subscript、backgroundColor。粗体/斜体需要选择字体变体（或合成加粗/倾斜矩阵），下划线/删除线需要额外 drawLine。当前导出 PDF 与画布渲染结果不一致，丢失所有字符格式。
**修复建议**：字体注册表按 family+weight+style 维度组织；underline/strike 依据 font metrics 画线；上下标调整 size 与 baseline 偏移。

**P-2 Latin-1 文本被误判为需嵌入字体**（`src/index.ts:757-769、817-827`）
`containsNonAsciiText` 以 codePoint>127 为界，而 Helvetica（WinAnsi 编码）本身覆盖 é、ü、ñ 等字符。未配置嵌入字体时，含西欧字符的文档被 `assertPdfFontsCanCoverLayout` 直接拦截抛 `PDF_FONT_MISSING`，导出失败。
**修复建议**：用 pdf-lib 标准字体的实际可编码集（WinAnsi）判定，或对 128-255 区间放行标准字体。

### P2

- **字体不子集化**（`src/index.ts:662` `embedFont(bytes, { subset: false })`）：中文字体常 5-20MB，全量嵌入导致 PDF 体积和 worker 内存峰值巨大。建议默认 `subset: true` 或在 `PdfFontConfig` 暴露选项。
- **无字体 fallback chain**（`src/index.ts:772-787`）：要求单一嵌入字体覆盖整段文本全部字符，中日韩混排且无单一全覆盖字体时，即使多字体组合可覆盖也抛 `PDF_FONT_MISSING`。应按字符区间切分 fragment 分配字体。
- **图片重复嵌入**（`src/index.ts:409-437`）：每个 image inline box 都调 `embedPdfImage`（427 行），同一 resourceId 出现在多页/多处时重复嵌入，无缓存。建议按 asset.id 缓存 PDFImage。
- **图片全量预加载**（`src/index.ts:247` `readPdfImageAssets`）：渲染前一次性读入全部图片字节，高分辨率多图场景有 OOM 风险。
- **页内渲染不可取消**（`src/index.ts:260-264`）：页循环之间有取消检查，但 `renderPdfPage` 内部的图片嵌入等异步操作之间没有 `assertPdfExportNotCancelled`。
- **fontkit 强制类型转换**（`src/index.ts:654`）：fontkit 2.0.4 模块 `as PdfDocumentFontkit` 传给 pdf-lib 1.17.1 的 `registerFontkit`，接口无编译期保证，版本升级有运行时断裂风险。建议加运行时探测或版本锁定注释。
- **无页面尺寸上限检查**（`src/index.ts:371-374`）：PDF 规范单页上限 14400x14400 points，layout 尺寸直接透传，超限生成不合规 PDF。

### P3

- `twipsToPdfPoints` 在 `src/index.ts:902-904` 与 `src/visual-report.ts:884-886` 重复定义，应抽共享。
- 颜色解析逻辑重复（`src/index.ts:602-615` 与 `618-634`）且只支持 `#RRGGBB`，`#RGB`/`rgba()`/命名颜色静默回退黑色。
- `readOwnedArrayBuffer`（`src/index.ts:939-945`）对 `save()` 结果整体再复制一份，大文档多一个内存峰值。
- TTC 字体集合只取第一个子字体做覆盖检测（`src/index.ts:709-723`）。
- 表格单元格只画边框不渲染背景填充（`src/index.ts:449-504`）。
- 图片仅支持 PNG/JPEG（`src/index.ts:921-927`），SVG/GIF/WebP 无降级路径（好在有稳定错误码 `PDF_IMAGE_UNSUPPORTED`）。
- **（R2 复审补充，P3）页眉页脚文本 baseline 用硬编码 `box.height * 0.6` 近似**（`src/index.ts:538`）：正文 fragment 用 layout 真实 `fragment.baseline`（401 行），而 `renderPdfHeaderFooterBoxes` 的 y 坐标为 `page.height - box.y - box.height * 0.6`，且字号固定 `size = 9`（533 行）。0.6 是与 box 高度绑定的经验系数，页眉页脚字号/行高变化时会垂直错位，与正文 baseline 口径不一致。**修复建议**：让 layout 为 header/footer box 输出真实 baseline，renderer 消费该值而非硬编码比例。
- **（R2 复审补充，P3）twip→point、fontSizePx×0.75、twip→EMU 换算均已核实正确**：`twipsToPdfPoints`（`src/index.ts:902-904`）= twips/20 正确；`readPdfFontSize`（597-599）= fontSizePx×0.75（96→72 DPI）正确；docx 侧 `twipsToEmu`（`packages/docx/src/export-utils.ts:85-86`）= twips×635（1 twip = 635 EMU）正确。此条为对首轮"换算数学正确"结论的 R2 独立复核确认（非新问题）。

### 正面

- **twip→points 换算数学正确**：`twips / 20`（1 twip = 1/20 point）；字号 `fontSizePx * 0.75`（96 DPI → 72 DPI）正确。
- **授权双重前置**：worker 路径 `src/index.ts:207` 与直接 API 路径 `src/index.ts:229` 都在处理用户内容前调用 `assertJWordFeatureEntitled`。
- **缺字体阻止乱码**：导出前对正文、表格、页眉页脚做全文覆盖检查（`src/index.ts:757-814`），无覆盖即抛 `PdfExportFontMissingError`，不会输出乱码 PDF——满足 Gate 要求。
- **AbortSignal 处理健壮**：主流程约 14 个取消检查点；`src/worker.ts:98-121` `bindPdfAbortSignal` 正确处理已取消/未取消/清理监听三种情况。
- 空文档输出一页空白页（`src/index.ts:335-361`）；pdf-lib/fontkit 均动态 import，不进首屏；进度事件（queued/mapping/font-loading/writing/done）同时进结果数组和 onProgress 回调，设计合理。

---

## 六、packages/license

- **P1-commercial / GA blocker 签名强度不足**（`src/index.ts:227-236`）：`createStableLicenseHash` 用 32 位 FNV-1a，输出 8 个十六进制字符，碰撞和伪造成本极低；且 verifier material 为 `jword-local-verifier:${issuer}`（`src/index.ts:222-224`），知道 issuer 即可伪造合法签名。注释已声明"非密码学签名、仅离线测试契约"，开发阶段可接受，但 **必须阻塞任何商业发布/对外试用**，不应仅标普通 P2。修复需替换为 HMAC-SHA256 或非对称签名，并在 `tests/architecture/gate5-commercial-readiness.test.ts` 或 release check 中禁止 FNV/dev verifier 进入发布路径。
- **P3 `server-unavailable` 与离线宽限期语义矛盾**（`src/index.ts:135-137`）：状态为 server-unavailable 时直接抛错，`offlineGraceUntil` 在此路径不生效。若设计意图是强制联网可接受，但应在类型注释里写明，否则字段语义误导。
- **正面**：纯函数、零依赖、`private: true` + `publishConfig.access: restricted`；诊断错误只含 `code: feature` 格式，不携带用户文档内容；features 排序后参与签名，免疫顺序差异。

---

## 七、examples/docx

- **正面 懒加载属实**（`src/main.ts:26、36-37、733-744`）：DOCX/PDF runtime 用 `import()` 动态加载并 memoize，静态 import 仅 type-only（编译期擦除）；`packages/core/src` 无任何对 docx/pdf/native 的引用。首屏不含高级包，Gate 目标达成。
- **正面 导入进入正规管线**（`src/main.ts:193-205`）：import 结果经 `convertDocxImportDocumentToCoreDocument` → `editor.loadDocumentModel`，未绕过 transaction pipeline 直接替换状态。
- **正面 授权场景全覆盖**（`src/main.ts:668-720`）：`?license=valid|missing|expired|feature-mismatch|server-unavailable` 五种模式；取消会话 `task-session.ts` 的 `canCommit()` guard 防止已取消任务写回 editor。
- **P3 fixture 选择 fallback**（`src/main.ts:278-290`）：非 `demo-basic` 值也回退到内置 fixture，将来加选项时易踩坑，建议对未知值告警。
- **P3 `isObjectRecord` 在 main.ts 与 task-session.ts 各有一份**，demo 级重复可接受。

---

## 八、横切问题（跨包）

**X-1（P2）示例未走 Worker 路径，"Worker 执行"目标缺端到端闭环**
`examples/docx/src/main.ts` 中没有任何 `new Worker(...)`；`importDocx`/`exportDocx`/`exportPdfFromLayout` 均在主线程直接调用（main.ts:613-641）。`packages/docx/src/worker.ts` 与 `packages/pdf/src/worker.ts` 的消息运行时存在且实现了 AbortSignal 绑定，但：
1. CLAUDE.md 不变式"docx/pdf 互通在 Worker 中执行"未被示例或 e2e 演示；
2. DOCX worker 全程不发 progress 事件（见 D 部分）；
3. 大文档导入导出会阻塞示例主线程，与 Gate 5 "Worker 执行" 目标不符。
**修复建议**：examples/docx 增加 Worker 模式（或默认走 Worker），e2e 补一条 worker 路径用例；架构测试可加"示例必须通过 worker 入口调用"约束。

**X-2（正面）授权校验时机全线正确**：native 无授权需求（设计如此，架构测试 gate45-native-boundary 验证其不依赖 license）；docx/pdf 的所有公开入口和 worker 入口都在解析用户字节前校验 entitlement。

---

## 九、fixtures 与 tools/compat

### fixtures

- **正面**：`fixtures/docx` 的 registry T1/T2 分层清晰，inputs/exports 各 14 个文件与 registry 一一对应；`manual-compatibility-results.json` 含全部 14 个 fixture 的 WPS 手动验证证据（SHA-256 绑定 + 编辑/保存/重开步骤）。
- **P2 commercial-readiness 外部证据全部 pending**：`compatibility-matrix.json` 中 Word/LibreOffice/OpenXML validator 结果全为 pending，`openxml-validation-results.json` 为空集。当前 WPS 手动证据合格，且按 Gate 5 当前 WPS-only 口径不阻塞内部验收；但进入商业/对外文档时只能声明 “WPS verified”，Word/OpenXML/LibreOffice 必须标 pending/not-run，不能包装成完整商业格式互通。OpenXML validator 缺口还会影响 Transitional 标准合规证据（例如 D 部分 `w:shd` 缺 `w:val`）。
- **P3 两个 T2 fixture 导出产物完全相同**：`docx-t2-header-footer` 与 `docx-t2-page-number` 的导出 SHA-256 均为 `dbaf6e32...`、4756 字节。原因是导出端 omit 了 header/footer 与 page numbering（T2 fallback），两文档退化为相同最小包。行为可解释，但应在 registry 注明预期，避免误判证据造假。
- **早期 PDF fixtures**：仅 `pdf-chinese-font` 就绪（含字体、期望文本、progress 阶段断言），其余 4/5 为 placeholder。
- **正面**：`NotoSansSC-gate5-subset.ttf` 子集字体已入库，中文字体验证可离线执行。

### tools/compat

- **正面 证据绑定防伪**：`run-gate5-docx-compatibility.mjs:481-492` 强制外部证据匹配当前导出 artifact 的 path/SHA-256/byteLength，不匹配降级 pending；stale/unbound 证据显式标记；工具缺失时保留 pending 而非伪造 pass。
- **正面** WPS 进程级辅助证据（pgrep+lsof，337-376 行）；evidence 模板只生成 TODO 占位。
- **P3**：`run-gate5-docx-compatibility.mjs` 约 875 行，逼近 1000 行门禁上限，继续演进前应拆分。

---

## 十、tests/architecture 门禁

- **Gate 4.5**（4 个文件）：native 边界（禁 DOCX/PDF/collab/license/yjs 依赖、禁保存 Y.Doc/layout cache/canvas bitmap）、lazy bundle token、发布面（files 不含 src/test）、benchmark 覆盖（1/50/200 页 + 图片 + 表格，save/load/validate 耗时与 heap 峰值）。约束设计严谨。
- **Gate 5**（10 个文件）：fixture id 冻结与对齐、DOCX/PDF/compat-runner 每文件 1000 行预算、interop benchmark、诊断码注册表与 fixture 预期对齐、compat runner 全路径测试（dry-run/证据完整性/模板/stale/unbound/超时/WPS 进程证据）、商业就绪（license 声明、release 审计、Node ESM 后缀、Gate 7 文档计划）。
- **未发现缺失的关键约束**，唯一建议：补充 X-1 所述"示例走 worker 入口"与"license 签名算法商业化升级"两条门禁。

---

## 十一、审查重点逐项结论

| 审查项 | 结论 |
|--------|------|
| .jword zip 结构 | 合理（manifest/document/metadata/checksums/resources），但 manifest 自身不受 checksum 保护（P2） |
| schema migration 升级路径 | **不完整**：0→1 为空操作且无迁移链机制（P1 N-2） |
| 损坏文件诊断 | 覆盖面好；缺 zip 炸弹/大小/路径穿越防护（P2） |
| DOCX OPC 解析健壮性 | 良好：必需 part 校验、断链 warning、稳定错误码；绝对 Target 与扩展名大小写有小缺口（P3） |
| XML parser namespace 安全 | **不完全**：namespace 声明不继承祖先，实际按 prefix 匹配（P2）；不解码数字字符引用、不支持 CDATA（P2）；免疫 XXE（正面） |
| OOXML indexes 完整性 | style/numbering/relationship/media/comments/headerFooter 六类齐备；table style 如实告警不伪装 |
| import 中间模型覆盖 | 主体覆盖（段落/run/表格/图片/超链接/批注/节属性）；bookmark/field/sdt 段落级静默丢失（P2）；toggle 属性语义错误（P1 D-1） |
| export Transitional 合规 | 基本合规但 `w:shd` 缺必需 `w:val`、`w:u` 缺 val（P2）；多 section 摊平（P1 D-2）；OpenXML validator 证据尚为空 |
| roundtrip diff T1/T2 覆盖 | T1 覆盖文本/样式/列表/表格/图片/节页面设置；**hyperlink、field、tabs、bookmark、comment 不在 snapshot**（P3，R3 订正：hyperlink 属 T2，不是 T1 阻塞） |
| PDF twip→points | 正确（/20；字号 x0.75） |
| PDF 中文字体嵌入 | 路径正确；subset:false 体积风险、TTC 只用首字体、fontkit as 转换风险（P2） |
| PDF 缺字体阻止乱码 | 是，导出前全文拦截；但 >127 阈值误伤 Latin-1（P1 P-2）、无多字体 fallback（P2） |
| worker progress/cancel/AbortSignal | PDF 可靠（页内嵌图不可取消为小缺口）；native save 有细粒度进度、load/validate 只有端点；**DOCX worker 完全无 progress**（P2）；native/docx 均有 cancel 先到竞态（P2） |
| 授权先于读取用户内容 | 全线正确（docx/pdf 双路径均前置） |
| lazy-load 避免首屏加载 | 应用层属实：core 零引用、示例动态 import、type-only 静态导入；但 docx 入口静态 re-export 拉入 JSZip，包内部无按需分层（P2#12） |
| 兼容验证工具可靠性 | 可靠：证据 SHA-256 绑定、不伪造 pass、工具缺失降级 pending |

---

## 十二、修复优先级建议

1. **立即修复（P1）**：D-1（toggle 语义，含 R2 补充的"误读不产 warning"与 underline `w:val="none"`）、P-1（PDF 文本样式）、P-2（Latin-1 误判）、D-2（多 section 至少补 warning）、N-2（迁移链）。
2. **本 Gate 内（P2）**：N-1 残留一处（`readMetadata` catch 错误码，R2 从 P1 降级）、批注文本读取 bug（package.ts:671-678，含 R2 补充的空 `w:id` 兜底）与 commentRangeEnd 丢弃、DOCX worker progress 接线与 cancel 竞态、XML 数字字符引用/CDATA/namespace 继承、`w:shd`/`w:u` schema 合规（配合接入 OpenXML validator 证据）、负页边距、normalizePartPath 防御、**R2 新增：DOCX 解压 zip 炸弹/大小防护（package.ts:253）**、PDF subset 与 fallback chain、native manifest checksum 与 zip 防护、示例 Worker 路径闭环（X-1）。
3. **商业发布前（阻塞 GA）**：license 签名算法替换为密码学签名；对外兼容矩阵只声明 WPS verified，Word/OpenXML/LibreOffice pending 需在 Gate 7 feature matrix 明确标注或补验。
4. **持续改进（P3）**：roundtrip 补 hyperlink、媒体字节内存优化、重复工具函数抽取、PDF 颜色/页面尺寸边界、**R2 新增：PDF 页眉页脚 baseline 硬编码 0.6（index.ts:538）**。

### R2 复审新增/订正总览

- **新增（P2）**：DOCX 解压无 zip 炸弹防护（`docx/src/package.ts:253`）；toggle 被误读后不产 warning（`docx/src/import-readers.ts:146-157`）。
- **新增（P3）**：PDF 页眉页脚 baseline 硬编码 0.6（`pdf/src/index.ts:538`）；underline 不处理 `w:val="none"`/线型（`docx/src/import-readers.ts:84-86`）；批注空 `w:id` 兜底相互覆盖（`docx/src/package.ts:672`）。
- **订正**：N-1 从 P1 降为 P2（document/checksums 错误码已修复，仅 `readMetadata` catch 残留）。
- **换算复核确认（非问题）**：twip/20、fontSizePx×0.75、twip×635 EMU、空格保留 `xml:space="preserve"`（`docx/src/export-utils.ts:102-104`）均正确。
