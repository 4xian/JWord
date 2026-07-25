/**
 * 职责：导出 Gate 5 DOCX 导入导出包的第一版公开契约。
 * 边界：只暴露 import/export/inspect 入口和结构化结果类型，不访问 core 内部 store 或 Y.Doc。
 * 协作模块：core 投影、压缩包读取、文档格式映射、任务线程和夹具差异通过此入口协作。
 * 性能/安全约束：入口无副作用，不把 JSZip 或 worker 代码强制拉入 core 或 vanilla 首屏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export { createDocxCompatibilityReport } from './compatibility.js'
export {
  DOCX_ERROR_CODE_METADATA,
  DOCX_WARNING_CODE_METADATA,
  isDocxErrorCode
} from './diagnostics.js'
export { buildExportDocxPackage as exportDocx } from './export.js'
export { importDocx } from './import.js'
export {
  createDocxExportPluginAdapter,
  createDocxImportPluginAdapter
} from './plugin-adapter.js'
export {
  createCancelDocxRequest,
  createDocxErrorEvent,
  createDocxProgressEvent,
  createDocxTransferables
} from './messages.js'
export {
  DOCX_WORKER_CSP_DIRECTIVES,
  detectDocxWorkerCapability
} from './worker-capability.js'
export { convertDocxImportDocumentToCoreDocument } from './model.js'
export {
  createDocxIndexes,
  inspectDocxPackage
} from './package.js'
export { diffDocxRoundtrip } from './roundtrip.js'
export type {
  CreateDocxCompatibilityReportOptions,
  DocxCompatibilityAppName,
  DocxCompatibilityAppResult,
  DocxCompatibilityAutomatedCheck,
  DocxCompatibilityAutomatedCheckKind,
  DocxCompatibilityDiagnostics,
  DocxCompatibilityReport,
  DocxCompatibilityResult,
  DocxOpenXmlValidationDiagnostic,
  DocxOpenXmlValidationResult,
  DocxOpenXmlValidationSeverity
} from './compatibility.js'
export type {
  DocxDiagnosticCodeMetadata,
  DocxDiagnosticSeverity,
  DocxErrorCode,
  DocxWarningCode
} from './diagnostics.js'
export type {
  DocxRoundtripDiffOptions,
  DocxRoundtripDiffResult,
  DocxRoundtripDifference,
  DocxRoundtripBookmarkSnapshot,
  DocxRoundtripImageSnapshot,
  DocxRoundtripParagraphSnapshot,
  DocxRoundtripRunLinkSnapshot,
  DocxRoundtripSnapshot,
  DocxRoundtripTableCellSnapshot,
  DocxRoundtripTableRowSnapshot,
  DocxRoundtripTableSnapshot
} from './roundtrip.js'
export type {
  DetectDocxWorkerCapabilityOptions,
  DocxWorkerCapability,
  DocxWorkerCapabilityRequirement,
  DocxWorkerCapabilityStatus
} from './worker-capability.js'
export type * from './types.js'
