/**
 * 职责：把 PDF export 入口包装成 Gate 7 Plugin adapter descriptor。
 * 边界：只创建 descriptor，不注册插件、不访问 core 内部 store、不触发浏览器下载。
 * 协作模块：@4xian/jword-core 的 Plugin adapter registry、PDF export 入口和 license feature key。
 * 性能/安全约束：helper 无顶层副作用，只有显式执行 descriptor 回调时才导出 PDF。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocumentLayout,
  PluginAdapterExecuteOptions,
  PluginExportAdapterDescriptor
} from '@4xian/jword-core'
import type { JWordLicenseEntitlement } from '@4xian/jword-license'

import type { ExportPdfOptions, ExportPdfResult } from './types.js'

/** 创建 PDF 导出 plugin adapter descriptor。 */
export function createPdfExportPluginAdapter(): PluginExportAdapterDescriptor<DocumentLayout, ExportPdfResult> {
  return {
    kind: 'export',
    name: 'pdf.export',
    format: 'pdf',
    featureKey: 'pdf.export',
    diagnosticsSource: 'pdf',
    exportDocument(input, options) {
      return import('./index.js').then(({ exportPdfFromLayout }) =>
        exportPdfFromLayout(input, readPdfExportOptions(options))
      )
    }
  }
}

/** 读取 PDF export options。 */
function readPdfExportOptions(options: PluginAdapterExecuteOptions | undefined): ExportPdfOptions {
  const signal = readAbortSignal(options?.signal)

  return {
    ...(options?.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(signal === undefined ? {} : { signal }),
    ...(options?.license === undefined ? {} : { license: readLicense(options.license) }),
    ...(options?.onProgress === undefined ? {} : { onProgress: options.onProgress })
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
