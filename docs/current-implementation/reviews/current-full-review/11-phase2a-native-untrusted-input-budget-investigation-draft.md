# 阶段 2A：native 不可信输入预算调查与已批准实施基线

> 状态：2A-B0 四项决策已批准并作为实施基线；执行、复核与最终关单证据见 [12-phase2a-verification-evidence.md](12-phase2a-verification-evidence.md)。
>
> Phase 2A 已在后续复核修复和 Standards/Spec 双轴复审后重新 `Closed`；本文件不单独作为关闭证据，最终证据以 12 号文档为准。
>
> 调查范围仅包括 `.jword` ZIP/JSON 资源预算、JSZip 取消边界、`document.json` 严格嵌套 schema，以及 manifest/checksum 数字字段校验。

## 当前结论

阶段 2A 的四项 finding 均已确认。

最重要的新结论是：仅复制 DOCX 的中央目录预算，再继续使用 `file.async()`，不足以严格关闭 `SEC-03/FMT-01`。

实测一个 4,200 字节的 ZIP 可以把本地文件头和中央目录中的未压缩大小伪造为 1 字节；JSZip 仍会处理原始 4 MiB 解压输出，最后才报告长度不匹配。因此：

- 中央目录预算能拦截常规 ZIP bomb。
- 解压后检查能发现结果错误。
- 但两者不能限制“伪造中央目录大小”的实际解压输出。
- 若要把 SEC-03 正式标记 Completed，必须选择支持实际输出上限的解压路线。
- 若继续使用 `JSZip.file.async()`，本批最多只能标记为部分缓解，不能宣称建立了严格的不可信输入预算。

## 1. 当前读取调用链和公开 seam

```text
loadJWordDocument()
  └─ 初始 AbortSignal 检查
     └─ readPackageParts()
        ├─ Blob/File.arrayBuffer()
        ├─ JSZip.loadAsync()
        ├─ manifest.json → file.async('string')
        ├─ metadata.json → file.async('string')
        ├─ checksums.json → file.async('string')
        ├─ document.json → file.async('string')
        ├─ inspectChecksums()
        │  └─ 每个 checksum entry 再次 file.async('uint8array')
        ├─ manifest/document/checksum 一致性检查
        └─ schema migration 可达性检查
     ├─ 抛出首个不可恢复 diagnostic
     ├─ migrateDocument()
     └─ 返回 canonical Document

validateJWordPackage()
  └─ 使用同一 readPackageParts()
     └─ 返回 valid/diagnostics，不写入 Editor

Worker
  └─ dispatchJWordNativeWorkerRequest()
     └─ AbortController
        └─ 调用相同 load/validate 公开入口
```

关键位置：

- [`packages/native/src/package-readers.ts`](../../../../packages/native/src/package-readers.ts)
- [`packages/native/src/index.ts`](../../../../packages/native/src/index.ts)
- [`packages/native/src/package-validation.ts`](../../../../packages/native/src/package-validation.ts)
- [`packages/native/src/worker.ts`](../../../../packages/native/src/worker.ts)
- [`packages/native/src/schema-migrations.ts`](../../../../packages/native/src/schema-migrations.ts)

Native 本身不修改 Editor 或 Y.Doc。`loadJWordDocument()` 只返回数据；宿主随后显式调用 `editor.loadDocumentModel()` 才进入 core。Core 当前也会先建立 staged records，再清空旧 store，但严格拒绝不可信结构仍应发生在 native seam 内。

## 2. 当前资源预算缺口

| 项目 | 当前行为 | 风险 |
| --- | --- | --- |
| 输入 ZIP bytes | 无上限；Blob/File 先完整 `arrayBuffer()` | 检查前已分配全部输入内存 |
| entry 数量 | 无上限 | 大量 entry 消耗解析时间和对象内存 |
| 单 entry | 无声明或实际输出上限 | 单个 JSON/资源可耗尽内存 |
| 总未压缩量 | 无累计预算 | 多 entry 累积耗尽内存 |
| 压缩比 | 不检查 | 高压缩比 ZIP bomb |
| JSON 大小 | 四个 JSON 均完整解压并完整解码 | 大字符串和 `JSON.parse()` 分配 |
| checksums 数量 | `entries` 数量无上限 | 可驱动大量额外读取和 SHA-256 |
| checksum 目标 | 可指向 ZIP 中任意 entry | 可诱导读取非业务 entry |
| 重复解压 | document、metadata 等先读 JSON，checksum 阶段再次解压 | CPU、内存成本放大 |
| 实际输出累计 | 无缓存、无累计 | 无法约束真实工作量 |
| 文档节点/深度 | 无节点数、嵌套深度预算 | 深层 table/properties 可造成递归和内存问题 |

`inspectChecksums()` 当前不使用 checksum 的 `byteLength` 做解压前判断，而是在完整读取后比较长度。

## 3. ZIP 特殊输入的真实行为

### 重复 entry

JSZip 将 entry 写入以文件名为 key 的对象，后出现的同名 entry 覆盖前一个。

实测：

```text
document.json = first
document.json = second
→ 最终只保留 second
```

`loadAsync()` 后已经无法恢复重复 entry 证据。

### 路径穿越

JSZip 3.10.1 会规范化 `../`，而不是拒绝：

```text
../document.json
→ document.json
```

实测 `../document.json` 可以覆盖正常的 `document.json`。JSZip 会在最后一个对象上保存 `unsafeOriginalName`，但当前 native 完全没有检查它。

### 加密 entry

JSZip 在解析中央目录时直接抛出：

```text
Encrypted zip are not supported
```

当前被外层转换为 `JWORD_NATIVE_PACKAGE_INVALID`。结果是 fail closed，但发生在 JSZip 解析阶段，没有 native 自己的前置、稳定分类。

### 伪造未压缩大小

实测：

```json
{
  "compressedInputBytes": 4200,
  "declaredUncompressedSize": 1,
  "sourceExpandedBytes": 4194304,
  "error": "Bug : uncompressed data size mismatch"
}
```

JSZip 完成解压后才报 `uncompressed data size mismatch`。这证明仅依赖 `_data.uncompressedSize` 的 DOCX 模型不能成为严格的实际输出预算。

### 可复现实验和证据

复现环境：Darwin arm64、Node `v24.14.0`、Python `3.9.6`、pnpm `9.14.2`、JSZip `3.10.1`。以下命令只写系统临时目录，并通过 `trap` 清理：

```bash
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

python3 - "$tmpdir" <<'PY'
import sys, warnings, zipfile
from pathlib import Path

warnings.filterwarnings('ignore', message='Duplicate name:.*')
root = Path(sys.argv[1])

with zipfile.ZipFile(root / 'duplicate.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('document.json', b'first')
    archive.writestr('document.json', b'second')

with zipfile.ZipFile(root / 'traversal.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('document.json', b'safe')
    archive.writestr('../document.json', b'unsafe')
PY

TMPDIR_NATIVE_EVIDENCE="$tmpdir" node --input-type=module <<'NODE'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const requireFromNative = createRequire(new URL('./packages/native/package.json', import.meta.url))
const JSZip = requireFromNative('jszip')
const root = process.env.TMPDIR_NATIVE_EVIDENCE
const duplicate = await JSZip.loadAsync(await readFile(join(root, 'duplicate.zip')))
const traversal = await JSZip.loadAsync(await readFile(join(root, 'traversal.zip')))
const traversed = traversal.file('document.json')

console.log(JSON.stringify({
  duplicateDocument: await duplicate.file('document.json').async('string'),
  traversedDocument: await traversed.async('string'),
  unsafeOriginalName: traversed.unsafeOriginalName
}, null, 2))

const expandedBytes = 4 * 1024 * 1024
const archive = new JSZip()
archive.file('payload.bin', new Uint8Array(expandedBytes))
const compressed = await archive.generateAsync({
  type: 'uint8array',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 }
})
const forged = compressed.slice()
const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength)

const patchField = (signature, offset) => {
  for (let index = 0; index <= forged.byteLength - 4; index += 1) {
    if (view.getUint32(index, true) === signature) {
      view.setUint32(index + offset, 1, true)
      return
    }
  }
  throw new Error(`signature not found: ${signature.toString(16)}`)
}

patchField(0x04034b50, 22)
patchField(0x02014b50, 24)

const forgedZip = await JSZip.loadAsync(forged)
const forgedFile = forgedZip.file('payload.bin')
let error = null

try {
  await forgedFile.async('uint8array')
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}

console.log(JSON.stringify({
  compressedInputBytes: forged.byteLength,
  declaredUncompressedSize: forgedFile._data.uncompressedSize,
  sourceExpandedBytes: expandedBytes,
  error
}, null, 2))
NODE
```

关键输出：

```json
{
  "duplicateDocument": "second",
  "traversedDocument": "unsafe",
  "unsafeOriginalName": "../document.json"
}
{
  "compressedInputBytes": 4200,
  "declaredUncompressedSize": 1,
  "sourceExpandedBytes": 4194304,
  "error": "Bug : uncompressed data size mismatch"
}
```

## 4. JSON、manifest 和 checksum 缺口

### 数字字段

`readNumber()` 只检查 `typeof value === 'number'`：

- `minimumReaderVersion: -1` 可直接通过当前版本判断。
- 负数或小数 `formatVersion` 最终映射为 unsupported，而不是 malformed。
- 负数、小数、超安全整数 `byteLength` 进入 checksum 比较，通常映射成 `HASH_MISMATCH`。
- 不检查 `Number.isSafeInteger()`。
- `NaN` / `Infinity` 字面量不是合法 JSON；但合法 number（如 `1e999`）经 JavaScript number 转换后可溢出为 `Infinity`，因此严格解析仍必须拒绝转换后的非有限值。

另有一个 diagnostic 映射问题：checksum 内字段类型错误时，通用 `readString/readNumber` 仍抛 `JWORD_NATIVE_MANIFEST_INVALID`，而不是 `JWORD_NATIVE_CHECKSUMS_INVALID`。

### 其它 checksum 缺口

- `sha256` 不验证为 64 位小写十六进制。
- MIME 可为空。
- checksum entry 名称不验证安全路径。
- 不要求 checksum key 与固定核心 entry/packed resource 精确对应。
- 可以声明任意隐藏 entry 并触发解压。
- manifest/checksum JSON 的重复 object key 都会被 `JSON.parse()` 静默覆盖。
- manifest `packageEntries` 和 resources 可重复。
- 非法 manifest resource 项目目前被静默过滤，而不是拒绝整个 manifest。

## 5. `document.json` 当前校验边界

当前只检查：

```ts
kind === 'document'
typeof id === 'string'
Array.isArray(sections)
```

随后直接：

```ts
return parsed as unknown as Document
```

缺少：

- section、paragraph、table、run、inline 的 discriminant，以及 row/cell 等无 `kind` 节点的严格结构校验。
- 必填字段和数组元素类型。
- page、list、border、range snapshot 等嵌套对象。
- Resource/source/status/error 结构。
- comments、messages、revisions、formatSnapshots。
- 有限数字、整数和取值范围。
- ID 非空、长度、唯一性。
- image/comment/revision/resource 等引用关系。
- 文档节点总数和嵌套深度。
- 未知字段策略。
- migration 后当前 schema 复验。

当前 `migrateSchema0To1()` 是显式空迁移，直接返回原对象。迁移前后的结构均没有重新验证。

Canonical 类型来源：[`packages/core/src/model/types.ts`](../../../../packages/core/src/model/types.ts)。

## 6. AbortSignal 的真实能力

当前直接调用链只在进入 `loadJWordDocument()` / `validateJWordPackage()` 前检查一次 signal。

之后：

- Blob/File 的 `arrayBuffer()` 不可由当前 signal 中断。
- `JSZip.loadAsync()` 不接受 AbortSignal。
- `file.async()` 不接受 AbortSignal。
- `inspectChecksums()` 当前甚至没有接收 signal。
- direct API 在解压期间发生 abort，可能完全看不到取消。
- Worker cancel 会设置 controller，并抑制 stale result 的发送；但 load/validate 仍可能继续消耗 CPU 和内存直至完成。
- 当前 Worker cancel 不是 `Worker.terminate()`。

JSZip 运行时存在未纳入 `JSZipObject` TypeScript interface 的 `internalStream()`，依赖它实现安全中止会绑定未正式声明的内部能力，不建议直接作为安全保证。

仅保留 JSZip 时，阶段 2A 最多只能提供步骤间 cooperative abort，不能中断当前 `loadAsync()` / `file.async()`。2A-B0 因此推荐把不可信读取切换到支持 `AbortSignal` 和 WritableStream 的 `@zip.js/zip.js` 路线；实施必须证明 signal 能拒绝当前读取，并通过固定输出预算限制同步 JSON/schema/hash 阶段的最坏成本。

如果选定 reader 的实际验证不能中断当前解压，必须停止并重新批准专用 Worker `terminate()` 等隔离路线，不能退回 JSZip 后宣称 FMT-04 已完成。

## 7. DOCX 模型可复用范围

[`packages/docx/src/package.ts`](../../../../packages/docx/src/package.ts) 当前提供：

- 2,000 entry。
- 256 MiB 总声明未压缩量。
- 64 MiB 单 part。
- 16 MiB 文本 part。
- load 后中央目录检查。
- 每次 part 读取前检查声明大小。

可复用的是模式，不建议直接抽取 DOCX 实现：

| 可复用模型 | Native 必须独立 |
| --- | --- |
| 输入、目录、读取前、读取后多级检查 | Native 限额数值 |
| entry 数、单项、总量累计 | manifest/document/checksum/resource 语义 |
| 单一读取上下文 | Native diagnostic code |
| 读取缓存，避免重复解压 | Native schema/migration |
| preflight 和实际读取双重校验 | Native AbortSignal 和 worker 语义 |
| 表驱动恶意 fixture 生成方式 | Native package entry allowlist |

DOCX 当前没有输入 bytes、压缩比、实际输出上限，也会受到伪造中央目录大小的问题。因此不应把 DOCX 代码原样抽成通用“安全 ZIP guard”。

## 8. 推荐 diagnostic 方案

建议只新增一个公开稳定 code，避免诊断面无必要膨胀：

| 场景 | Diagnostic |
| --- | --- |
| 输入、entry、单项、总量、比例、JSON、checksum 或文档节点预算超限 | `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` |
| ZIP 损坏、重复 entry、路径穿越、加密、ZIP64 策略不支持、目录元数据矛盾 | `JWORD_NATIVE_PACKAGE_INVALID` |
| manifest 字段类型、数字范围、resources 结构无效 | `JWORD_NATIVE_MANIFEST_INVALID` |
| checksum schema、hash 格式、byteLength 类型或范围无效 | `JWORD_NATIVE_CHECKSUMS_INVALID` |
| document 嵌套 schema、未知 kind、重复 ID 或其它结构/字段无效 | `JWORD_NATIVE_DOCUMENT_INVALID` |
| 有效 checksum 声明与实际 hash/长度不一致 | `JWORD_NATIVE_HASH_MISMATCH` |
| document 与 manifest 的 resource 声明不一致 | 保留 `JWORD_NATIVE_RESOURCE_REFERENCE_MISSING` |
| cooperative abort 被观察到 | `JWORD_NATIVE_USER_CANCELLED` / Worker 对应 code |

悬空 `image.resourceId` 已有唯一映射：结构正确但引用未在 `manifest.resources` 声明时使用 `JWORD_NATIVE_RESOURCE_REFERENCE_MISSING`；`resourceId` 本身类型错误或 image 结构错误才使用 `JWORD_NATIVE_DOCUMENT_INVALID`。

### 8.1 公开 load/validate 的错误 seam

当前 `readPackageParts()` 在捕获到任意 `JWordNativePackageError` 时重新抛出，导致新增预算错误若直接沿用该路径，`validateJWordPackage()` 会违背“返回 `valid: false` 与 diagnostics”的契约。

实施时必须增加共享的内部编排 seam，例如 `readAndValidatePackage()`，并按获批方案保持以下行为：

1. ZIP、预算、JSON、manifest、checksum、document schema、migration 和完整性错误全部转换为不可恢复 diagnostic，不从共享读取 seam 直接抛出。
2. 未知 ZIP runtime 异常收口成 `JWORD_NATIVE_PACKAGE_INVALID`，不得把依赖原始错误、entry 内容或输入片段放入公开 diagnostic。
3. 只有 `JWORD_NATIVE_USER_CANCELLED` 和 Worker 取消路径的 `JWORD_NATIVE_WORKER_CANCELLED` 继续抛出，取消不能降级成普通 invalid diagnostic。
4. `validateJWordPackage()` 消费共享结果；存在不可恢复 diagnostic 时返回 `valid: false`，并返回对应 diagnostics。
5. `loadJWordDocument()` 消费同一共享结果，先通过现有 `throwFirstUnrecoverableDiagnostic()` 抛出首个稳定 `JWordNativePackageError`，只有无错误时才返回 document。
6. 同一个恶意输入必须在 validate 和 load 两条公开 seam 上得到同一稳定 code；区别只在 validate 返回结果、load 抛错。

这要求修改 [`packages/native/src/package-readers.ts`](../../../../packages/native/src/package-readers.ts) 的 catch 边界，而不是只在 `validateJWordPackage()` 外层增加一个宽泛 catch。

### 8.2 公开 DTO、规范化 path 与 i18n 边界

FMT-06 的权威 finding 要求结构诊断携带 JSON path。2A-B0 已批准为 `JWordPackageDiagnostic`、`JWordNativePackageErrorInput`、`JWordNativePackageError`、`JWordNativePackageErrorShape` 和 Worker 序列化 shape 增加同一个可选 `path?: string`；该公开 DTO 加法已按本节约束实施，执行证据以 12 号文档为准。

公开 `path` 只能是 schema parser 根据已知字段名和数字数组索引构造的规范化 JSON Pointer，例如 `/sections/0/blocks/2/runs`。遇到未知对象 key 时只报告其已知父路径；不得把未知 key、原始输入值、正文、资源 ID、文件名或其它任意攻击者字符串复制进 `path`。`path` 只用于定位结构错误，不替代稳定 `code`，也不得包含 ZIP 依赖的原始异常。

Native 当前公开类型仍包含 `message`。本批不删除该字段以避免额外破坏性 API 变化，但新增或修改的 runtime/worker 错误不得把中文、英文或 ZIP 依赖原始错误作为跨层契约；兼容字段的值固定为稳定 code。用户可见说明由 UI、wrapper 或宿主按 locale 生成。若实施产生新的用户可见提示，必须同时补齐 `zh-CN` 和 `en-US`，不能把本地化文本写入 package、Worker、协议或日志 DTO。

## 9. 推荐实施路线

### 2A-B0：已批准的四项决策

#### 决策 1：读取侧采用 `@zip.js/zip.js@2.8.31`

Native 读取侧精确使用 `@zip.js/zip.js` `2.8.31`，许可证为 BSD-3-Clause。固定使用 `ZipReader` 的 `strictness: 'strict'` 和 `useWebWorkers: false`，避免在 Native Worker 内再创建嵌套解压 Worker。

原始 ZIP preflight 必须对全部中央目录记录计算区间，不以 zip.js 的 `FileEntry` / `DirectoryEntry` TypeScript 分类作为安全边界。每个区间从 local header offset 开始，覆盖本地文件头、名称、extra field、压缩数据和 data descriptor；任意 entry 之间或 entry 与 central directory/EOCD 之间 overlap 都拒绝。标记为目录的记录还必须满足 compressed/uncompressed size 均为 0，否则返回 `JWORD_NATIVE_PACKAGE_INVALID`，防止带内容的目录 entry 绕过后续文件读取检查。

原始区间检查通过后，在读取任何 entry 内容前，再依次对全部 zip.js 文件 entry 调用 `entry.getData(new WritableStream<Uint8Array>(), { signal, strictness: 'strict', checkOverlappingEntryOnly: true })`；该选项只检查本地记录区间，不会向占位 writer 写入解压内容。仅在实际内容读取时设置 `checkOverlappingEntry: true` 不足以覆盖从未读取的隐藏 entry。全部 overlap preflight 通过后，实际内容读取继续向 `FileEntry.getData()` 传入同一 `AbortSignal`、`strictness: 'strict'`、`checkOverlappingEntry: true` 和自定义有界 `WritableStream<Uint8Array>`。

zip.js 的 `entry.zip64` 只能作为辅助证据。进入 `ZipReader` 前还必须对原始 ZIP bytes 做只读 preflight，拒绝 ZIP64 EOCD、ZIP64 EOCD locator、ZIP32 EOCD 中的 `0xffff` entry count 或 `0xffffffff` central-directory size/offset sentinel，以及 local/central-directory entry 中表示 ZIP64 size/offset/disk 的 sentinel。该 preflight 同时验证记录范围与整数运算不会越过输入边界，不能只依赖解析后的 `entry.zip64`。

有界 writer 必须在闭包中保存首次命中的终止原因：

```ts
type ZipReadTerminalReason =
  | 'abort'
  | 'entry-limit'
  | 'total-limit'
  | 'ratio-limit'
```

必须使用一个“仅在当前值为 `undefined` 时写入”的内部方法记录 `terminalReason`，确保 abort 和预算竞争时首次原因优先。在调用 `getData()` 前注册 abort listener；注册后立即复查 `signal.aborted`，覆盖 signal 在注册前已经取消的情况。listener 只把首次原因设置为 `abort`，并必须在 `finally` 中移除。

writer 接收每个 chunk 时仍必须在缓存前依次检查 `signal.aborted`、单 entry 实际输出、全包累计实际输出和单项/全包实际压缩比，并通过同一个首次原因方法记录命中项。命中后立即使 stream 失败，不缓存越界 chunk，也不继续 hash、JSON decode 或后续 entry。这样即使 zip.js 上游先响应 signal、在 writer 写入次数为 0 时直接拒绝，仍会由 listener 保留 `abort`，不会错误收口成 package invalid。

实现必须先捕获而不是立即映射 zip.js 的拒绝，并在 `finally` 中移除 abort listener；`getData()` 无论 resolve 还是 reject，退出依赖调用后都先查看闭包中的 `terminalReason`。`abort` 映射为 `JWORD_NATIVE_USER_CANCELLED`；`entry-limit`、`total-limit` 和 `ratio-limit` 统一映射为 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`。只有 `terminalReason === undefined` 时才允许把捕获的 zip.js 失败收口为 `JWORD_NATIVE_PACKAGE_INVALID`。zip.js 可能用 `TypeError: Invalid state: WritableStream is closed` 覆盖 writer 原始失败，因此不得依赖第三方异常的 name 或 message 判断取消和预算原因。严禁使用 `BlobWriter`、`Uint8ArrayWriter`、`entry.arrayBuffer()` 或其它先完整物化再检查的 API 作为读取安全边界。

JSZip `3.10.1` 只保留在可信保存侧 `package-codec.ts`；读取侧不得继续调用 `JSZip.loadAsync()` / `file.async()`。这会让 Native 暂时存在两个 ZIP runtime，必须通过 fresh bundle gate 记录 lazy chunk 影响；不得为了减小 bundle 顺便改写保存器。

官方依据：

- [`ZipReader` API](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html)
- [`GetEntriesOptions.strictness/checkAmbiguity`](https://gildas-lormeau.github.io/zip.js/api/interfaces/GetEntriesOptions.html)
- [`FileEntry.getData()` 与 WritableStream](https://gildas-lormeau.github.io/zip.js/api/interfaces/FileEntry.html)
- [`EntryGetDataOptions.signal`](https://gildas-lormeau.github.io/zip.js/api/interfaces/EntryGetDataOptions.html)
- [npm package](https://www.npmjs.com/package/@zip.js/zip.js/v/2.8.31)

版本和许可证核验命令：

```bash
npm view @zip.js/zip.js@2.8.31 version license dist.unpackedSize engines --json
```

2026-07-17 记录结果为 `version=2.8.31`、`license=BSD-3-Clause`、npm unpacked size `4,729,624` bytes、Node engine `>=18.0.0`；unpacked size 不是浏览器 bundle size，实际 bundle 必须由 fresh Vite/Rollup 产物测量。

`@zip.js/zip.js` 是新增的直接浏览器运行时依赖。进入 B1 编码前必须先对精确 `2.8.31` 发布包及其实际进入 Vite ES2022 bundle 的依赖闭包做静态兼容审计，逐项记录其语法和 Web API 对 Chrome 100、Edge 100、Firefox 128、Safari 16.4 的支持情况。审计至少覆盖 Streams、`AbortSignal`、压缩相关 Web API、BigInt/typed array 和 worker 分支；Vite 语法转换不能当作运行时 API polyfill。若最低目标缺少某项 API，必须增加 feature detection 与明确 fallback/polyfill，或停止并重新批准依赖/最低版本，不能静默提高矩阵。

当前 Playwright Chromium、Firefox、WebKit 只作为最新版回归，结果必须记录 `currentVersionsOnly: true`、`minimumVersionsVerified: false` 和最低版本状态 `Deferred / not-run`。由于现有最低版本真实环境不可用，本项按既定风险接受不阻断内部阶段 2A，但不得宣称 Chrome 100、Edge 100、Firefox 128 或 Safari 16.4 已通过真实运行验证；最新版 Chromium 也不能替代 Edge 100 证据，不得据此关闭相应对外兼容或商业 GA 边界。

实施红灯必须先证明：伪造声明大小的 entry 在 writer 首个越界 chunk 处失败，累计缓存从未超过固定上限。如果 `2.8.31` 在实际实现中先完整物化 entry 再写入 stream，立即停止，不得把中央目录检查描述为 SEC-03 已关闭，也不得静默更换依赖。

#### 决策 2：固定内部预算

所有限额是不可由公开 options、环境变量或 Worker message 放宽的内部常量：

| 预算 | 固定值 | 计量规则 |
| --- | ---: | --- |
| 输入 ZIP | 64 MiB | Blob/File 先检查 `size`；ArrayBuffer/Uint8Array 检查 `byteLength` |
| ZIP entry 数 | 1,024 | 文件和目录 entry 全部计数 |
| entry 名称 | 512 UTF-8 bytes | 拒绝空名、绝对路径、反斜杠、`.`/`..` segment 和规范化冲突；文件不得含空 segment，目录只允许一个末尾 `/` |
| 单个 packed resource 实际输出 | 32 MiB | writer chunk 累计值 |
| 全包实际解压输出 | 128 MiB | 每个 entry 只计一次，JSON/checksum 复用缓存 |
| `manifest.json` | 256 KiB | 实际解压 bytes，decode/parse 前检查 |
| `metadata.json` | 1 MiB | 实际解压 bytes，decode/parse 前检查 |
| `checksums.json` | 2 MiB | 实际解压 bytes，decode/parse 前检查 |
| `document.json` | 16 MiB | 实际解压 bytes，decode/parse 前检查 |
| 四个 JSON 总量 | 20 MiB | 实际解压 bytes 累计 |
| checksum / resource / packageEntries 项数 | 各 1,024 | JSON schema 解析阶段计数 |
| 压缩比 | 100:1 | 单 entry 与全包都检查；实际输出超过 1 MiB 后开始执行，避免微小 entry 误判 |
| JSON 嵌套深度 | 64 | 四个 JSON 统一计算 |
| JSON value 总数 | 500,000 | object、array 和 primitive 都计数 |
| canonical document 结构节点 | 200,000 | section、block、table row/cell、run、inline、resource、comment、revision 等累计 |
| 标识符 | 1..256 UTF-8 bytes | document 及其嵌套实体 ID，按相应类型域检查唯一性 |

选择依据是：DOCX 当前 2,000 entry、256 MiB 总量、64 MiB 单项和 16 MiB 文本限额；Native 的 200 页纯文档 benchmark 约 523,800 bytes；仓库缺少真实客户图片型 `.jword` 分布。因此表中数值是本阶段已批准的首批保守默认值，但不是正式冻结的生产标准。批准决策 2 表示显式接受“缺少真实图片型客户样本”的初始风险，并先采用更适合浏览器/Worker 的 64 MiB 输入、128 MiB 实际输出和 32 MiB 单资源上限。后续若脱敏客户分布证明需要调高，必须结合内存峰值和浏览器实测重新批准，不能由调用方自行配置。

#### 决策 3：format v1 明确拒绝 ZIP64

当前固定预算远低于 ZIP32 边界，现有 JSZip 保存器也不需要 ZIP64。读取侧通过原始 ZIP preflight 拒绝 ZIP64 EOCD、locator 和 ZIP32 archive/entry sentinel，并把解析后的 `entry.zip64 === true` 作为第二道防线；命中时统一返回 `JWORD_NATIVE_PACKAGE_INVALID`。本阶段不修改 `formatVersion`；未来若要支持 ZIP64，必须升级格式能力说明并单独评审。

#### 决策 4：增加规范化、非原始输入的可选 `path`

为满足 FMT-06，已按第 8.2 节的约束给公开 diagnostic、error 和 Worker shape 增加可选 `path?: string`。结构错误仍固定使用相应稳定 code，`entry` 指向 `document.json`、`manifest.json` 或 `checksums.json`；`path` 只补充规范化结构位置，不允许传播原始输入。该 DTO 加法已获批准并完成实施，最终行为和验证证据以 12 号文档为准。

### 2A-B1：ZIP preflight 与预算 seam

建议新增：

- `packages/native/src/package-read-budget.ts`
- `packages/native/src/package-entry-name.ts`
- `packages/native/src/zip-preflight.ts`
- `packages/native/src/bounded-zip-reader.ts`
- `packages/native/test/native-package-security-fixtures.ts`
- `packages/native/test/public-api-security.test.ts`

职责：

- 输入分配前检查 Blob/File `size`，ArrayBuffer/Uint8Array 检查 `byteLength`。
- 在 `zip-preflight.ts` 中直接检查原始 ZIP 记录范围、全部中央目录记录区间、目录 entry 零大小约束、archive/entry ZIP64 标记和 sentinel；实际解析到的中央目录记录数必须同时匹配 EOCD 声明且不超过 entry 上限，不依赖 `entry.zip64` 或 TypeScript entry 分类作为唯一证据。
- 在 `package-entry-name.ts` 中集中实现读写两侧共用的 entry 名称校验与规范化冲突检测；文件 entry 不允许空 segment，目录 entry 只允许表示目录标记的单个末尾 `/`，其余 segment 仍必须非空。
- 使用 `ZipReader` strict 模式读取目录，保留原始文件名、flags、压缩方式、压缩/未压缩大小和 ZIP64/encryption 元数据。
- 对原始 ZIP 中全部 entry 先完成区间 overlap 检查，再对 zip.js 文件 entry 执行 `checkOverlappingEntryOnly`；同时拒绝重复名称、路径穿越、绝对路径、反斜杠、规范化冲突、加密 entry 和 ZIP64。
- 通过有界 `WritableStream` 建立一次读取、缓存、实际输出累计、实际压缩比和 signal 检查的内部 seam；abort listener 和 writer 共用闭包 `terminalReason`，并覆盖 zip.js 可能抛出的 stream close 错误。每个 chunk 成功接受并缓存后，才通过现有 `onProgress` 报告累计正数 `loaded`；取消后不得继续发送正数进度，使公开 load/validate seam 可以确定性触发并证明 mid-stream abort。
- 不新增公开 options，不允许调用方放宽安全上限。

需要修改：

- `packages/native/package.json`：增加精确 runtime dependency `"@zip.js/zip.js": "2.8.31"`，保留保存侧 `jszip`。
- `pnpm-lock.yaml`：只接受该精确依赖需要的 importer/解析变化。
- `packages/native/src/package-readers.ts`：切换到内部 bounded reader，并实现第 8.1 节的 diagnostic seam。
- `packages/native/src/package-validation.ts`：从读取缓存消费 bytes，不再二次调用 `file.async()`。
- `packages/native/src/package-codec.ts`：保存侧复用 `package-read-budget.ts` 的同一组内部常量和 `package-entry-name.ts` 的 entry 名称校验，禁止生成读取侧必然拒绝的 format v1 package。
- `docs/sdk/browser-support.md`：随 B1 静态兼容审计把浏览器 API 编写规则补全为 Chrome 100、Edge 100、Firefox 128、Safari 16.4；该同步只修正规则枚举，不改变最低版本矩阵或 `Deferred / not-run` 状态，并在 B5 再做文档一致性验收。
- `examples/vanilla/vite.config.ts`：增加最小 build-only module evidence，记录 `jszip` 保存器和 `@zip.js/zip.js` reader 各自进入的输出 chunk；证据只保存安全 package label 和 chunk 名，不写绝对路径。
- `tools/size/check-native-bundle.mjs`：从独立扫描器改为完整 gate runner；先删除 `examples/vanilla/dist`，再执行 `pnpm --filter @4xian/jword-example-vanilla build`，构建成功后分别校验旧 JSZip 保存器和新 zip.js reader 的 module evidence。两者都不得出现在首屏 chunk，且都必须命中 Native lazy chunk，缺少任一依赖证据都失败。
- `tests/architecture/gate45-native-bundle.test.ts`：锁定 runner 自行清理、构建、扫描的生命周期，以及 `jszip` / `@zip.js/zip.js` 两套独立 module evidence 契约；删除任一清理、构建或 evidence 分支时 focused architecture test 必须变红。

保存侧在 stringify 后、写 ZIP 前按 UTF-8 bytes 检查四个 JSON 的单项与总量；资源收集时检查单资源和累计实际 bytes；生成 manifest/checksum 时检查 resource、packageEntries、checksum 和最终 ZIP entry 数；所有待写 entry 计入总未压缩量。`generateZipBytes()` 完成后检查 64 MiB ZIP bytes 上限，并用同一 raw preflight/声明压缩比策略复核生成物。任何保存预算超限都稳定抛出 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`，不得返回无法被同版本 reader 重开的 bytes。

资源路径必须先对 ID 做既定编码，再把完整 `resources/<encoded-id>` 交给共用 entry 名称校验。由于 `encodeURIComponent('.') === '.'`、`encodeURIComponent('..') === '..'`，编码方法必须把这两个结果改为不会形成 dot segment 的字面百分号形式（例如 `%2E` / `%2E%2E`），并拒绝空 segment、反斜杠、绝对路径和规范化冲突；reader 不得对 entry 名称再做 URL decode。所有生成路径还要进入同一个 canonical name set，防止两个资源产生重复或冲突 entry；无法安全表示或发生冲突时在写 ZIP 前抛出 `JWORD_NATIVE_DOCUMENT_INVALID`，不得依赖 reader 在保存完成后才拒绝。

保存测试至少包含一个代表性 roundtrip：允许边界内的输出能保存并由公开 reader 重开，代表性的 JSON、资源或最终 ZIP 超限输入在保存阶段拒绝。每个生产预算的 exact / `+1` 算术由纯 helper 表驱动覆盖，不为每个上限都构造 32–128 MiB 的公开 seam fixture。所有边界输入动态生成，不提交巨大二进制文件。

Bundle gate 选择“runner 自己清理、构建、扫描”，不采用调用方先构建或仅核对旧 evidence 的可选路径。每次直接执行 `node tools/size/check-native-bundle.mjs` 时，runner 必须先递归删除 `examples/vanilla/dist`，再同步执行 `pnpm --filter @4xian/jword-example-vanilla build`；删除或构建失败时立即失败，不允许进入扫描，也不提供跳过 fresh build 的参数。扫描阶段只接受本次构建重新生成的 dist 和 module evidence，证据缺失时直接失败，因此不能复用已有 vanilla 产物获得假绿灯。Gate 不能继续把通用 `jszip` 字符串当作唯一证明，必须通过 module evidence 分别识别 `jszip` 与 `@zip.js/zip.js`，并把两个 package 的 module count、lazy chunk 命中和首屏零命中写入安全 JSON 结果。

强停止条件：如果选定 reader 无法在实际输出超过预算时停止，或必须改动 `.jword` formatVersion 才能拒绝歧义输入，不得关闭 SEC-03。

### 2A-B2：manifest/checksum 数字与结构

建议新增：

- `packages/native/src/strict-json.ts`

修改：

- `packages/native/src/package-readers.ts`
- `packages/native/src/package-validation.ts`

具体改动：

- 字段级 safe non-negative integer parser。
- format/schema/reader 版本先验证数字合法性，再判断 supported/future。
- `byteLength` 要求 `0..Number.MAX_SAFE_INTEGER`。
- checksum hash 固定为 SHA-256 hex。
- 修正 checksum 字段错误被映射成 MANIFEST_INVALID 的问题。
- checksum key 必须匹配允许的核心 entry 和 packed resources。
- checksum `byteLength` 在解压前与 preflight 元数据比较，读取后与实际结果比较。
- 复用缓存，禁止 document/metadata 被重复解压。
- manifest resource 任一项目类型或字段非法时整体返回 `JWORD_NATIVE_MANIFEST_INVALID`，不得继续静默过滤。
- `packageEntries` 必须按共用 entry 名称规则校验且无重复；manifest resource ID 必须唯一，所有 packed path 必须唯一且不得产生规范化冲突。
- `packed: true` 必须同时存在严格匹配 `resources/<单一安全非空文件名>` 的 `path`：不得等于 `resources/`、不得包含更深层 `/`、不得使用 dot segment，也不得指向或覆盖 `manifest.json`、`metadata.json`、`checksums.json`、`document.json` 等核心 entry；该 path 还必须精确出现在 `packageEntries`。`packed: false` 必须不含 `path`。manifest resource 和 checksum entry 的 MIME 都必须为去除首尾空白后非空字符串。
- `strict-json.ts` 在 `JSON.parse()` 前分别扫描 `manifest.json` 和 `checksums.json` 的每一层 object，按 JSON 解码后的 key 检测重复。manifest 中重复 `formatVersion`、`schemaVersion`、`resources` 或任意嵌套 key 统一返回 `JWORD_NATIVE_MANIFEST_INVALID`；checksums 中重复顶层字段、checksum entry 名或 entry 内字段统一返回 `JWORD_NATIVE_CHECKSUMS_INVALID`。扫描必须正确处理字符串 escape 和嵌套值，不得使用正则近似，也不把重复 key 或原始 JSON 放入 diagnostic。

### 2A-B3：严格版本化 document parser

建议新增：

- `packages/native/src/document-schema.ts`

需要修改：

- `packages/native/src/package-readers.ts`
- `packages/native/src/package-validation.ts`
- `packages/native/src/schema-migrations.ts`
- `packages/native/src/package-codec.ts`

内部编排必须保持版本边界，禁止在当前 schema 复验前把未知对象强制转换成 `Document`：

```ts
parseJWordDocumentVersion(
  input: unknown,
  schemaVersion: number,
  requestId?: string
): VersionedJWordDocument

migrateJWordDocument(
  document: VersionedJWordDocument,
  sourceVersion: number,
  requestId?: string
): VersionedJWordDocument

parseCurrentJWordDocument(
  input: unknown,
  requestId?: string
): Document
```

load 和 validate 必须调用同一个 pipeline：

```text
严格读取 manifest.schemaVersion
→ 用该版本的 parser 校验原始 document.json
→ 按版本链执行 migration
→ 用当前 schema parser 再次完整校验迁移结果
→ 执行 document/manifest/resource 引用完整性检查
→ 返回 canonical Document、migration report、warnings 和 diagnostics
```

`validateJWordPackage()` 也必须实际执行旧版本 parser、migration 和当前版本复验；不能只检查 migration path 是否存在。validate 不新增公开 `migrationReport` 字段，但必须把 migration warning 和任何 migration/schema failure 放入现有 warnings/diagnostics。`loadJWordDocument()` 复用同一 canonical 结果，不能在公开入口外再执行第二套迁移。

`saveJWordDocument()` 也必须复用 `parseCurrentJWordDocument()`：先为 Editor/projection/Document 建立 JSON-safe snapshot，再把 snapshot 作为 `unknown` 交给当前 schema parser；只有 parser 完成结构、节点、深度、ID 唯一性和引用完整性校验后，才能收集资源、创建 manifest 或写入 ZIP。保存后续步骤必须只使用 parser 返回的 canonical `Document`，不得继续使用调用方通过类型断言伪造的原对象。

实现覆盖：

- version-specific schema。
- section、paragraph、table、run、inline 的 discriminant，以及 row/cell 等无 `kind` 节点的严格结构。
- 必填字段、枚举和开放 record 字段。
- 有限数字和明确整数约束。
- 节点数和嵌套深度预算。
- 非空、长度受限的 ID。
- 类型域内唯一 ID。
- image/resource、comment、revision 等引用。
- migration 后再次调用当前 schema parser。
- 结构失败把 schema parser 生成的安全 JSON Pointer 写入可选 `path`；未知 key 只定位到已知父路径，不复制攻击者提供的 key 或 value。

`ModelProperties`、resource metadata 等开放 record 可以继续接受未知 key，但必须受 JSON 节点、深度和总字节预算约束。

### 2A-B4：AbortSignal 语义收口

修改：

- `packages/native/src/index.ts`
- `packages/native/src/package-readers.ts`
- `packages/native/src/package-validation.ts`
- 必要时 `packages/native/src/worker.ts`

在以下位置检查 signal：

- 输入规范化前后。
- 原始 ZIP preflight 前后检查 signal，并在 preflight 内先约束输入 bytes 和 entry 数。
- `ZipReader.getEntries()` 目录解析前后检查 signal；该 API 不接受本方案的 signal，不能宣称目录解析本身可中断。
- 每个 entry 解压前后。
- 每次 SHA-256 前后。
- schema migration 前后。
- 返回结果前。

文档明确：

- `@zip.js/zip.js` 的 `signal` 和有界 writer 是读取/解压阶段的取消边界；必须用大但预算内 fixture 证明 abort 会使当前读取拒绝且不返回部分数据。
- FMT-04 必须保留两个不同用例：上游在 writer 写入 0 次时响应取消；以及确定性的 mid-stream 取消。mid-stream 用例通过现有公开 `onProgress` seam 同步：bounded writer 成功接受并缓存第一个 chunk 后报告正数 `loaded`，测试在该次回调内调用 `AbortController.abort()`，并先断言 abort 快照中的 `acceptedChunkCount > 0`，防止退化成解压开始前取消。测试记录 `abortedAt`、abort 时已接受的 chunk 数和累计输出 bytes；abort 后 accepted chunk 数与输出累计不得继续增长。若依赖再次调用 writer，只允许首次调用立即观察 `terminalReason='abort'` 并拒绝，不得出现第二次 post-abort write。
- 取消测试从 abort 到 Promise 拒绝的固定上限为 5 秒，并在拒绝后继续观察固定 100 ms，确认 writer 调用次数、accepted chunk 数和累计输出 bytes 均不再变化。测试超时、abort 后输出继续增长或 writer 持续收到 chunk 时必须停止实施，不能把“最终返回取消”当作已中断解压。
- `ZipReader.getEntries()` 的目录解析只在调用前后观察取消；原始 preflight 的输入和 entry 数预算负责限制该不可中断区间的最坏工作量。
- 同步 JSON.parse、同步 schema 遍历或单次 WebCrypto SHA-256 仍只能在前后观察取消，不能宣称任意指令级即时中断。
- 当前 Worker cancel 通过 AbortController 取消读取，不等于 `Worker.terminate()`。
- 不返回部分 document。
- abort 后不再进入后续 entry 或 migration。

### 2A-B5：diagnostic 和文档同步

可能修改：

- `packages/native/src/types.ts`
- `packages/native/src/diagnostics.ts`
- `packages/native/src/messages.ts`
- `fixtures/collab/diagnostics-registry.json`
- 生成的 `docs/sdk/diagnostic-codes.md`
- 生成的 `packages/core/src/editor/diagnostics-registry.ts`
- `docs/sdk/browser-support.md`
- `docs/sdk/jword-format.md`
- `docs/current-implementation/sdk/jword-format.md`
- `docs/current-implementation/packages/native.md`
- `packages/native/README.md`
- 当前 full-review 的 README、02、05、08、09、10

i18n 验收固定为：runtime、Worker、协议和日志只把稳定 code 与必要结构化字段作为契约；不得新增本地化 message。若 UI、wrapper 或宿主新增资源超限、包无效或取消提示，必须同时提供 `zh-CN` 和 `en-US`，并测试展示层按 code 映射。

`path` 实施时必须由 `document-schema.ts` 生成，经 `diagnostics.ts`、`JWordNativePackageError` 和 Worker error shape 原样传递规范化值；任一层都不得重新拼接原始输入、依赖异常或本地化文本。

`packages/native/package.json` 和 `pnpm-lock.yaml` 已纳入 B1 必改范围；不得使用宽松版本范围或替换为未批准的 ZIP reader。

## 10. 最少红绿矩阵

恶意 ZIP、schema 和代表性资源边界必须穿过公开 `validateJWordPackage()` / `loadJWordDocument()`；保存行为必须穿过公开 `saveJWordDocument()`，roundtrip 再由公开 load seam 重开生成物。纯预算算术使用内部 helper 的小型表驱动测试，不要求穿过公开 seam。

| 红灯切片 | 预期 green |
| --- | --- |
| 重复 `document.json` 后项覆盖 | PACKAGE_INVALID |
| `../document.json` 覆盖正常 entry | PACKAGE_INVALID |
| 加密 entry | PACKAGE_INVALID |
| 任意两个 entry 的原始数据区间 overlap，包括隐藏 entry 和标记为目录的 entry | PACKAGE_INVALID；raw preflight 在内容读取前拒绝 |
| 标记为目录但 compressed/uncompressed size 非零 | PACKAGE_INVALID；不得依赖 DirectoryEntry 类型跳过 |
| archive-level ZIP64 EOCD/locator/sentinel | PACKAGE_INVALID；原始 ZIP preflight 拒绝 |
| entry-level ZIP64 extra field/size/offset/disk sentinel | PACKAGE_INVALID；原始 ZIP preflight 拒绝 |
| 每项生产预算的 exact / `+1` 算术 | 小型表驱动纯 helper 测试，不分配与生产上限等量的 bytes |
| 输入 ZIP、实际解压总量、JSON 和保存/重开的代表性高风险边界 | 对应公开 seam 上 exact 通过、`+1` 稳定拒绝 |
| 超大 document/checksums JSON | RESOURCE_LIMIT_EXCEEDED |
| 伪造声明 1 字节、实际解压超限 | 必须在实际输出达到预算时停止 |
| writer 已记录终止原因，但 zip.js 抛 `WritableStream is closed` | 优先按 terminalReason 映射取消或资源超限 |
| writer 接受首个 chunk 后由 `onProgress` 触发 abort | abort 快照 `acceptedChunkCount > 0`，随后 USER_CANCELLED 且输出停止增长 |
| zip.js 上游先响应 abort，writer 写入 0 次 | abort listener 保留首次原因，USER_CANCELLED |
| abort 后 writer 输出累计继续增长、持续收到 chunk 或超过拒绝时限 | 测试失败并触发停止，不得宣称真正中断解压 |
| checksum 指向任意隐藏 entry | CHECKSUMS_INVALID |
| checksum JSON 任意 object scope 出现重复 key | CHECKSUMS_INVALID；在 JSON.parse 前拒绝 |
| 负数/小数/超安全整数版本 | MANIFEST_INVALID |
| 负数/小数/超安全整数 byteLength | CHECKSUMS_INVALID |
| checksum 长度与实际 entry 不符 | HASH_MISMATCH |
| manifest resource 项字段非法 | MANIFEST_INVALID；不得静默过滤 |
| 重复 packageEntries、resource ID 或 packed path | MANIFEST_INVALID |
| manifest JSON 任意 object scope 出现重复 key | MANIFEST_INVALID；在 JSON.parse 前拒绝 |
| packed/path 组合错误或 manifest resource MIME 为空 | MANIFEST_INVALID |
| packed resource path 为 `document.json`、`resources/` 或 `resources/nested/file` | MANIFEST_INVALID；path 只能是 `resources/<单一安全非空文件名>` |
| checksum entry MIME 为空 | CHECKSUMS_INVALID |
| section.blocks 类型错误 | DOCUMENT_INVALID |
| 未知 block/inline kind | DOCUMENT_INVALID |
| 嵌套结构错误包含攻击者提供的未知 key/value | DOCUMENT_INVALID；可选 path 只含已知字段和数字索引 |
| 重复 block/run/resource ID | DOCUMENT_INVALID |
| 悬空 image resourceId | RESOURCE_REFERENCE_MISSING |
| 合法 schema 0 包 | migration 继续通过，并通过 schema 1 复验 |
| 保存伪造 Document 的错误嵌套类型或重复 ID | 保存前由当前 schema parser 拒绝，DOCUMENT_INVALID |
| 保存 Document 含悬空 resource 引用 | 保存前由当前 schema parser 拒绝，RESOURCE_REFERENCE_MISSING |
| packed resource ID 为 `.` 或 `..` | 编码为安全非 dot segment，保存并由 reader 重开 |
| 资源路径无法安全表示或生成规范化冲突 | 写 ZIP 前拒绝，DOCUMENT_INVALID |
| 输入规范化期间 abort | USER_CANCELLED |
| entry 间 abort | 不再读取后续 entry |
| Worker cancel | 当前读取被 signal 取消，不发送 stale success，不返回部分 document |
| 代表性保存输出恰好处于允许边界 | 保存成功，生成包可由同版本公开 reader 重开 |
| 代表性保存输入首次超过共享 reader 预算 | 保存阶段 RESOURCE_LIMIT_EXCEEDED，不产生不可重开的 package |
| 直接运行 gate 时已有旧 vanilla dist，或本批构建/module evidence 缺失 | runner 先删除 dist 并重建；删除或构建失败时不得进入扫描 |
| gate runner 缺少清理、vanilla build 或任一 ZIP module evidence 分支 | `gate45-native-bundle.test.ts` 变红 |
| `jszip` 保存器或 `@zip.js/zip.js` reader 缺少 Native lazy chunk 命中，或任一依赖进入首屏 chunk | bundle gate 失败 |
| 最新 Playwright 三浏览器通过 | 只记录当前版本回归和 `minimumVersionsVerified: false`，不得作为 Chrome 100、Edge 100、Firefox 128、Safari 16.4 的最低版本证据 |

恶意 ZIP 应由测试 helper 动态生成，不提交巨大二进制 fixture，也不放入 `packages/native/fixtures` 和正式 tarball。

每个 ZIP/schema 失败表项至少成对断言：`validateJWordPackage()` 返回 `valid: false` 和唯一 code，`loadJWordDocument()` 抛出同一 code。取消用例则断言两条公开 seam 都直接拒绝 `JWORD_NATIVE_USER_CANCELLED`，不返回普通 invalid diagnostic。

## 11. 验证命令

建议实施时按以下顺序：

```bash
pnpm exec vitest run packages/native/test/public-api-security.test.ts

pnpm --filter @4xian/jword-native test
pnpm --filter @4xian/jword-native typecheck

node tools/diagnostics/generate-diagnostics-artifacts.mjs
pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts

pnpm exec vitest run \
  tests/architecture/gate45-native-boundary.test.ts \
  tests/architecture/gate45-native-bundle.test.ts \
  tests/architecture/gate45-native-release.test.ts

pnpm build
# 该 runner 内部清理 dist、构建 vanilla，再扫描本批 module evidence。
node tools/size/check-native-bundle.mjs
node tools/release/check-native-pack.mjs

pnpm exec playwright test \
  examples/vanilla/tests/gate4_5-native.e2e.ts \
  --project=chromium \
  --project=firefox \
  --project=webkit

pnpm test:types
pnpm typecheck
pnpm lint
git diff --check
```

## 12. 停止和排除边界

阶段 2A 不应包含：

- 阶段 2B 的恢复原子性和 packed resource 重建。
- 阶段 2C 的远端纯删除 update。
- DOCX/PDF 兼容或 Worker 迁移。
- OEM Phase 2/4、JWL1 清理。
- Collaboration admission。
- LIC-107B2 浏览器最低版本矩阵。
- 公共 Native options 中的可放宽安全预算。

以下情况必须停止并重新批准：

- `@zip.js/zip.js@2.8.31` 的 WritableStream 路径不能在实际输出越界时停止。
- FMT-04 测试中 abort 后 writer 输出继续增长、持续收到 chunk，或未在固定上限内拒绝。
- `@zip.js/zip.js@2.8.31` 静态审计发现最低浏览器目标不支持的语法/API，且无法用最小 feature detection 与 fallback/polyfill 保持现有矩阵。
- Fresh vanilla build 的 module evidence 无法分别证明 `jszip` 保存器和 `@zip.js/zip.js` reader 只进入 Native lazy chunk。
- 必须使用不同 ZIP runtime dependency 或不同版本。
- 必须改变 `.jword` formatVersion/schemaVersion。
- 必须改变 core `Document` 公开类型。
- 必须通过新公开配置允许宿主放宽预算。
- 规范化公开 `path` 的 DTO 加法已获批准并实施；若后续决定取消公开 path，必须先同步修订 FMT-06 权威 finding 和验收标准，不能保持两套冲突契约后继续实现。

## 调查时工作区状态

- 状态哈希计算命令固定为 `git status --short | shasum -a 256`。
- 首轮只读调查开始和结束、尚未保存本草案时，哈希均为 `5fabe6cd419f4258e8aad1036ef51eb8e984c6e2ac7b3fc7ac5edd648842e795`。
- 本草案保存为 untracked 文件后，哈希为 `363aaca2a4fc96c4eb941bc86fa2bac9b86ec7f0a8845271793e33f9d168d18d`；该变化只反映新增本草案的 status 行，不表示覆盖既有 dirty 文件。
- 调查结束时 `git diff --check` 通过。
- 调查期间未修改 `packages/native`、DOCX 预算源码或 native fixture。
- “不得提前标记完成”是调查和实施期间的约束；当前 Phase 2A 状态及关闭证据统一以 12 号文档为准，本文件不单独作为关单依据。
