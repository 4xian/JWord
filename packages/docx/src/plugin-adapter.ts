/**
 * 职责：把 DOCX import/export 入口包装成 Gate 7 Plugin adapter descriptor。
 * 边界：只创建 descriptor，不注册插件、不访问 core 内部 store、不执行 worker runtime。
 * 协作模块：@4xian/jword-core 的 Plugin adapter registry、DOCX import/export 入口和 license feature key。
 * 性能/安全约束：helper 无顶层副作用，只有显式执行 descriptor 回调时才读取 DOCX 二进制或导出文档。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocumentProjection,
  PluginAdapterExecuteOptions,
  PluginExportAdapterDescriptor,
  PluginImportAdapterDescriptor
} from '@4xian/jword-core'
import type { JWordLicenseEntitlement } from '@4xian/jword-license'

import { buildExportDocxPackage } from './export.js'
import { importDocx } from './import.js'
import type {
  DocxBinaryInput,
  ExportDocxOptions,
  ExportDocxResult,
  ImportDocxOptions,
  ImportDocxResult
} from './types.js'

/** 创建 DOCX 导入 plugin adapter descriptor。 */
export function createDocxImportPluginAdapter(): PluginImportAdapterDescriptor<DocxBinaryInput, ImportDocxResult> {
  return {
    kind: 'import',
    name: 'docx.import',
    format: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    fileExtensions: ['.docx'],
    featureKey: 'docx.import',
    diagnosticsSource: 'docx',
    importDocument(input, options) {
      return importDocx(input, readDocxImportOptions(options))
    }
  }
}

/** 创建 DOCX 导出 plugin adapter descriptor。 */
export function createDocxExportPluginAdapter(): PluginExportAdapterDescriptor<DocumentProjection, ExportDocxResult> {
  return {
    kind: 'export',
    name: 'docx.export',
    format: 'docx',
    featureKey: 'docx.export',
    diagnosticsSource: 'docx',
    exportDocument(input, options) {
      return buildExportDocxPackage(input, readDocxExportOptions(options))
    }
  }
}

/** 读取 DOCX import options。 */
function readDocxImportOptions(options: PluginAdapterExecuteOptions | undefined): ImportDocxOptions {
  const signal = readAbortSignal(options?.signal)

  return {
    ...(options?.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(signal === undefined ? {} : { signal }),
    ...(options?.license === undefined ? {} : { license: readLicense(options.license) })
  }
}

/** 读取 DOCX export options。 */
function readDocxExportOptions(options: PluginAdapterExecuteOptions | undefined): ExportDocxOptions {
  const signal = readAbortSignal(options?.signal)

  return {
    ...(options?.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(signal === undefined ? {} : { signal }),
    ...(options?.license === undefined ? {} : { license: readLicense(options.license) })
  }
}

/** 读取 AbortSignal，忽略只暴露 aborted 的轻量信号。 */
function readAbortSignal(signal: PluginAdapterExecuteOptions['signal'] | undefined): AbortSignal | undefined {
  if (typeof signal !== 'object' || signal === null || !('addEventListener' in signal)) {
    return undefined
  }

  return signal as AbortSignal
}

/** 读取授权载荷，具体结构由 license package 负责验证。 */
function readLicense(license: unknown): JWordLicenseEntitlement | null {
  return license === null ? null : license as JWordLicenseEntitlement
}
