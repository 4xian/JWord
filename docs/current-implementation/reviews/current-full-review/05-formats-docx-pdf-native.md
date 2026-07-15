# 格式互通问题清单（DOCX / PDF / native）

> 范围：`packages/docx`、`packages/pdf`、`packages/native`。本文件只记录当前仍开放的问题，并区分实现缺陷与库能力限制。
>
> 说明：FMT-01 与 [02-security-and-licensing.md](02-security-and-licensing.md) 的 SEC-03 是同一问题，此处补充与 docx 的对称性对比。

## FMT-01（P0）native ZIP 反序列化完全没有 zip-bomb 预算（docx 有而 native 无）

- 位置：`packages/native/src/package-readers.ts:52`（`JSZip.loadAsync`）。
- 问题：`readPackageParts` 直接 loadAsync 后逐个 `file.async('string')` 解压，全程无 entry 数量、单项/总解压体积、压缩比限制。**关键对比**：docx 包 `package.ts:77-79,309-329` 已有 `DOCX_MAX_PART_COUNT / DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES / DOCX_MAX_PART_UNCOMPRESSED_BYTES` 并在 `readDocxZip` 里 `assertZipResourceLimits`——native 缺失同类保护，属明显不对称遗漏。
- 触发场景：打开恶意 `.jword`（高压缩比或超多 entry）。
- 后果：worker 内存爆炸/拒绝服务，可打挂宿主页面或标签页。
- 建议修复：把 docx 的 `assertZipResourceLimits` + `assertPartReadLimit` 移植到 native，读中央目录 uncompressedSize 在 `.async()` 前做上限校验。
- 当前结论：**确认**。docx 已有成套预算，native 没有，属于明确的不对称安全遗漏。
- 详细修复步骤：
  1. 将 docx 的预算模型抽成可复用但由 native 自行配置上限的 ZIP guard；不要直接共享 DOCX 特定错误码或 part 语义。
  2. 输入阶段限制压缩包字节数，并在加载前扫描中央目录以保留重复 entry、路径穿越和压缩元数据证据。
  3. 加载后先校验 entry 数、单项/总未压缩大小和压缩比，再允许任何 `file.async()`。
  4. 所有 part 读取共用累计预算，每次读取后核对实际大小并产出稳定 native diagnostic。
  5. `inspectChecksums` 必须复用同一预算上下文；每个目标 entry 解压前比较中央目录未压缩大小、checksum 声明 byteLength 与剩余预算，解压后再次核对实际 byteLength，再计算 SHA-256。
  6. 复用 SEC-03 的六类恶意 fixture，并增加一个 checksums 指向超大 entry 的用例；同一风险只维护一套样本。

## FMT-03（P1）blobUrl 资源在"保存-关闭-重开"后图片永久丢失

- 位置：`packages/native/src/package-codec.ts:224-236` + `index.ts:119-128`。
- 问题：保存时只有 dataUrl、或带 `metadata.nativeBytesBase64` 的 blobUrl 才写入 `resources/`，否则仅告警而 `document.json` 原样保留死的 `blob:...` URL。加载侧 `loadJWordDocument` 只回传 resources 摘要（id/path/mime/byteLength），**从不把 `resources/` 字节重新挂回 `document.resources[].source`**。
- 触发场景：运行期插入的 blobUrl 图片（无 nativeBytesBase64）→ 保存 → 关闭 → 重开。
- 后果：图片引用变失效 blob URL，正文图片彻底丢失（即便打包了字节也不会被重新关联）。
- 建议修复：加载时读取 packed resource 字节并把 source 重建为 dataUrl/内存字节；保存时对无字节的 blobUrl 主动解析或明确失败，而非静默保留死链接。
- 当前结论：**确认**。保存侧可能只留下不可复用 blob URL，加载侧即使发现 packed resource 也只返回摘要，没有回挂 document resource。
- 详细修复步骤：
  1. 明确 native 可持久化资源形态：插入资源时就保留 bytes/可序列化来源，不能把短生命周期 blob URL 当持久化身份。
  2. 保存前遍历所有被文档引用的资源并解析为 bytes；无法解析的 blob URL 返回稳定阻断诊断，不能只 warning 后报告保存成功。
  3. 写包时把 `document.json` 的 source 改为逻辑 packed-resource 引用，并保证 path/id/mime/checksum 一一对应。
  4. 加载时读取、校验并重建 resource source（data URL、内存 bytes 或有明确 revoke 生命周期的新 object URL），再返回 document。
  5. 增加保存后销毁原 blob URL、重新加载仍可读取相同图片字节的 roundtrip 测试。

## FMT-04（P1）native 取消（AbortSignal）无法真正中断解压

- 位置：`package-readers.ts:46-95`、`index.ts:86-93`。
- 问题：`assertNotAborted` 只在步骤之间检查，但耗时的 `JSZip.loadAsync` 和各 `file.async()` 本身不接受 signal。
- 触发场景：用户对大文件点取消。
- 后果：取消不生效，worker 继续占用资源直至解压完成。
- 建议修复：解压前用大小预算 fail-fast（治本），并在逐 entry 处插入取消检查。
- 当前结论：**确认（能力边界）**。步骤间检查只能缩短阶段之间的取消延迟，不能中断正在执行的 `JSZip.loadAsync/file.async`；原建议不足以实现“真正中断”。
- 详细修复步骤：
  1. 先完成 FMT-01 资源预算，限制不可取消阶段的最坏资源消耗。
  2. 在每个 entry 解压前后检查 signal，避免取消后继续进入下一项，但文档明确单次 JSZip 调用仍不可中断。
  3. 如产品要求硬取消，把 JSZip 工作放进可销毁的专用 Worker，由主线程在 abort 时 terminate；或替换为支持流式取消的 ZIP 实现。
  4. 用超大但预算内 fixture 验证 abort 后在约定时间内 worker 被终止、Promise 返回取消诊断且不返回部分文档。

## FMT-05（P1）DOCX 导出丢失页眉页脚/页码/批注/修订

- 位置：`packages/docx/src/export.ts:269-320`。
- 问题：导出器对 headerIds/footerIds、pageNumbering、comments、revisions 只产生警告，`writeDocumentXml` 完全不写出对应 part（无 header/footer part、无 comments.xml、无修订标记）。这是已知未实现，但对导出/roundtrip 是实打实的数据损失。
- 触发场景：导出任何带页眉页脚、页码、批注或修订的文档。
- 后果：往返后这些内容永久消失；import 侧其实已能保留部分 header/footer source id，能力不对称。
- 建议修复：文档明确“导出为有损”，优先补齐 header/footer 与 comments part 写出；短期内保证导入侧 opaque 保留能覆盖这些 part，以便无损回写。首期继续采用受限兼容子集和默认另存策略。
- 当前结论：**确认（已知能力缺口）**。当前导出器明确告警后省略这些结构；这不是隐藏实现 bug，但对 roundtrip 是真实数据损失。
- 详细修复步骤：
  1. 先冻结首期兼容矩阵和 warning code，UI 在导出前展示有损项并默认“另存为”，不得宣称完整 roundtrip。
  2. 第一阶段实现 header/footer part、relationship、section reference 与页码字段写出，并用最小 fixture 做 Word 打开验证。
  3. 第二阶段实现 comments.xml、comments relationship 与正文 range/引用；批注内容、作者和锚点需成套验证。
  4. 修订要么实现标准 w:ins/w:del 写出，要么完整保留原 part/relationship/顺序的 opaque roundtrip；仅保存一段原始 XML 不足以保证无损。
  5. 每个阶段只加一个含该能力的 roundtrip fixture，比较关键 XML/relationship 并实际用 Word/LibreOffice smoke 打开。

## FMT-06（P1）native document.json 反序列化只做浅校验即强制转型

- 位置：`package-readers.ts:238-244`（`if (parsed.kind !== 'document' || typeof parsed.id !== 'string' || !Array.isArray(parsed.sections)) throw; return parsed as unknown as Document`）。
- 问题：只校验三个顶层字段就 `as unknown as Document`，sections 内部结构、resources、inline 等未验证，`migrateSchema0To1` 又是空迁移。
- 触发场景：手工构造结构合法但字段类型错误的 document.json。
- 后果：错误被推迟到 layout/render/协同阶段才崩，定位困难，可能污染 Y.Doc。
- 建议修复：入 pipeline 前做结构化 schema 校验（sections/blocks/runs 形状与资源引用），失败即产出稳定诊断。
- 当前结论：**确认**。当前只验证三个顶层字段，嵌套 discriminated union、属性类型和资源引用均未经解析。
- 详细修复步骤：
  1. 把读取流程拆为 envelope/version 校验、版本特定 schema 解析、migration、当前 schema 复验四步。
  2. 使用结构化 parser 逐层校验 section/block/run/table/resource 的 kind、必填字段、数值范围和唯一 ID，不再使用 `as unknown as Document` 作为边界。
  3. 建立 ID/resource reference 索引，拒绝重复 ID、悬空引用和不支持的 discriminant，并在 diagnostic 中带 JSON path。
  4. 只补三个无效 fixture：错误嵌套类型、未知 kind、悬空资源引用；再保留一个合法旧 schema migration 用例。

## FMT-07（P2）PDF 大文档导出 save/嵌入阶段不可取消

- 位置：`packages/pdf/src/index.ts:170-179`。
- 问题：逐页有 `assertPdfExportNotCancelled`，但 `pdfDocument.save(...)`（179）及 `embedPng/embedJpg`、`embedFont` 是单次阻塞调用，中途不检查 signal。
- 后果：大文档在 save 阶段无法取消，取消延迟到整份序列化完成后才生效。
- 建议修复：在 save 前后与每张图片嵌入前后补取消检查；文档说明 save 为不可中断阶段。
- 当前结论：**确认（库能力限制）**。补检查只能阻止后续阶段，不能中断正在运行的 `save/embed*`。
- 详细修复步骤：
  1. 在每次图片/字体 embed 前后与 save 前后检查 signal，尽早停止进入下一阶段。
  2. 文档和进度事件明确标记 `pdfDocument.save()` 为不可中断区间，并限制单次导出的页数/资源预算。
  3. 若必须提供硬取消，把整个 PDF 导出放在可 terminate 的 Worker；abort 时销毁 worker 并丢弃部分结果。
  4. 加一个大图片或多页 fixture，断言取消返回稳定 diagnostic；不要把“save 后才发现 abort”描述成即时取消。

## FMT-08（P2）DOCX 导出内联图片 data URL 解码无容错，单张坏图导致整份失败

- 位置：`packages/docx/src/export.ts:399-421,482-493`。
- 问题：`collectExportMediaItems` 对每个 dataUrl 资源急切调用 `readDataUrlBytes`→`globalThis.atob`，无 try/catch。
- 触发场景：projection 中存在一张 base64 非法的图片资源。
- 后果：整份 DOCX 导出失败，而非跳过坏图并告警（MIME 不支持时是走 warning 跳过的）。
- 建议修复：包裹解码，失败时产出警告并跳过该图。
- 当前结论：**确认**。非法 base64 会从 `globalThis.atob` 直接抛出并终止媒体收集。
- 详细修复步骤：
  1. 在单资源边界捕获 data URL 解析/解码错误，生成带 resourceId 的稳定 warning，并把该资源标记为 skipped。
  2. 仅为成功解码的图片创建 media item、relationship 和 drawing reference，避免留下悬空 rel。
  3. 保持非图片导出继续完成；若产品要求更醒目，可在兼容报告汇总跳过数量。
  4. 加一份含一张坏图和一段正常文本的测试，断言 DOCX 仍生成、warning 存在且包内无坏图 relationship。

## FMT-09（P2）浮动图片（anchor）整体丢弃，不保留 opaque

- 位置：`packages/docx/src/import-readers.ts:330-341`。
- 问题：`readDrawingInlines` 遇 `wp:anchor` 直接 `return []` 并告警，既不导入也不作为 opaque fragment 保留原始 XML（对比修订元素走 `preserveUnsupportedRevisionElement` 保留了 XML）。
- 后果：浮动图片往返后彻底消失，无法无损回写。
- 建议修复：把 anchor 原始 XML 存入 `unsupportedElementFragments`，与修订元素一致。
- 当前结论：**确认，但仅保存 anchor XML 仍不够**。浮动图片通常还依赖 relationship、media part 和文档顺序信息，修复必须成套保留。
- 详细修复步骤：
  1. 导入时保存完整 `wp:anchor` XML、所属 paragraph/run 顺序、相关 rId 和 compatibility warning。
  2. 同时保留 rId 指向的 image part、content type 与 relationship；不能只留下引用失效的 XML。
  3. 文档未编辑该 opaque fragment 时，导出按原顺序重新写入 XML/relationship/media；无法安全回写时明确阻断或告警。
  4. 用一个浮动图片 fixture 做 import-export-import，核对 anchor、rId 和媒体字节仍存在。

## FMT-10（P2）native manifest/checksums 数字字段接受负数和小数

- 位置：`package-readers.ts:346-355`（`readNumber`）。
- 问题：`readNumber` 只检查 `typeof value === 'number'`，因此负数和小数可进入 byteLength/formatVersion/schemaVersion/minimumReaderVersion。JSON 输入本身不支持 NaN 或 Infinity，当前缺陷是可表达的负数、小数和超安全整数未被拒绝。
- 建议修复：`readNumber` 增加 `Number.isFinite` 及取值范围（非负整数）校验。
- 当前结论：**确认**。范围、整数性和安全整数校验均缺失。
- 详细修复步骤：
  1. 按字段分别校验：版本号必须是支持范围内的整数，byteLength 必须是 `0..Number.MAX_SAFE_INTEGER` 的整数；不要只在通用 helper 中接受任意 number。
  2. 保留 `Number.isFinite` 作为防御性断言，但测试重点是 JSON 可表达的负数、小数和超安全整数。
  3. 解析后再核对 checksum byteLength 与实际 entry 大小，版本比较只接收已校验整数。
  4. 增加负版本、小数版本、负 byteLength 和超安全整数四个表驱动 case，不添加无法通过 JSON.parse 的 NaN fixture。

## 正向确认（非缺陷）

- 自研 XML 解析器 `docx/src/xml.ts` **无** XXE / 十亿笑风险：`decodeXml` 只处理预定义实体与数值字符引用、不做自定义 `<!ENTITY>` 展开，遇 `<!DOCTYPE` 会因 `readName` 无法匹配 `!` 直接抛 `XML_PARSE_INVALID`。
- 三个包 src 内均未发现顶层 DOM 访问；`crypto.subtle/atob/Intl.Segmenter/fetch` 都是 worker 安全 API。
- PDF 字体 URL 为调用方配置，SSRF 风险低（但字体 `fetch` 与"worker 不联网"文档约束存在张力，建议文档澄清）。
