/**
 * 职责：输出 Gate 5 DOCX import/export 与 PDF export 的确定性 benchmark 指标。
 * 边界：只运行本地合成文档样本，不读取真实 DOCX/PDF 二进制 fixture，不声明输入响应指标。
 * 协作模块：packages/docx、packages/pdf、packages/core 和 tools/bench/run-bench.mjs。
 * 约束：输出必须是可机器读取 JSON，指标字段保持稳定用于计划回写和后续趋势比较。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-26---建立-benchmarkbundle-和回归门禁。
 */
import { performance } from 'node:perf_hooks'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

import {
  convertDocxImportDocumentToCoreDocument,
  exportDocx,
  importDocx
} from '../packages/docx/dist/index.js'
import { createEditor } from '../packages/core/dist/index.js'
import { exportPdfFromLayout } from '../packages/pdf/dist/index.js'

// 这里用脚本级 fixture 保持 benchmark 可重复，不依赖外部二进制样本。
const fixtures = [
  {
    id: 'gate5-small-text',
    group: {
      fileSizeBucket: 'small',
      pageCountBucket: 'single-page',
      imageCount: 0
    },
    document: createBenchmarkDocument({
      id: 'small-text',
      paragraphCount: 4,
      includeTable: false,
      includeImage: false
    })
  },
  {
    id: 'gate5-medium-table-image',
    group: {
      fileSizeBucket: 'medium',
      pageCountBucket: 'single-page',
      imageCount: 1
    },
    document: createBenchmarkDocument({
      id: 'medium-table-image',
      paragraphCount: 12,
      includeTable: true,
      includeImage: true
    })
  },
  {
    id: 'gate5-multi-page-text',
    group: {
      fileSizeBucket: 'medium',
      pageCountBucket: 'multi-page',
      imageCount: 0
    },
    document: createBenchmarkDocument({
      id: 'multi-page-text',
      paragraphCount: 72,
      includeTable: false,
      includeImage: false
    })
  }
]

if (isMainThread) {
  await runBenchmark()
} else {
  await postWorkerMemoryBenchmark()
}

/** 运行主 benchmark 并输出机器可读 JSON。 */
async function runBenchmark() {
  const heapSamples = [readHeapUsed()]
  const workerMetrics = await runWorkerMemoryBenchmark(fixtures)
  const workerMetricsById = new Map(workerMetrics.records.map((record) => [record.id, record]))
  const results = []

  // 顺序执行可以让 heap 峰值和输出顺序保持稳定，方便后续比较。
  for (const fixture of fixtures) {
    results.push(await runFixtureBenchmark(fixture, heapSamples, workerMetricsById.get(fixture.id)))
  }

  const totals = results.reduce(
    (metrics, result) => ({
      docxImportDurationMs: roundMetric(metrics.docxImportDurationMs + result.docxImportDurationMs),
      docxExportDurationMs: roundMetric(metrics.docxExportDurationMs + result.docxExportDurationMs),
      pdfExportDurationMs: roundMetric(metrics.pdfExportDurationMs + result.pdfExportDurationMs),
      fileSizeBytes: metrics.fileSizeBytes + result.fileSizeBytes,
      pageCount: metrics.pageCount + result.pageCount,
      imageCount: metrics.imageCount + result.imageCount
    }),
    {
      docxImportDurationMs: 0,
      docxExportDurationMs: 0,
      pdfExportDurationMs: 0,
      fileSizeBytes: 0,
      pageCount: 0,
      imageCount: 0
    }
  )

  validateBenchmarkResults(results)

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        benchmark: 'gate5-interop',
        fixtures: results,
        totals,
        heapPeakBytes: Math.max(...heapSamples),
        workerHeapPeakBytes: workerMetrics.workerHeapPeakBytes,
        note: '确定性 Gate 5 DOCX import/export 和 PDF export benchmark；workerHeapPeakBytes 来自真实 Node worker thread 内的 process.memoryUsage().heapUsed 峰值；取消不阻塞输入和导入导出期间编辑器交互响应由浏览器门禁验证。'
      },
      null,
      2
    )
  )
}

/** 在 Node worker thread 内运行同一批互通任务并回传 heap 峰值。 */
async function postWorkerMemoryBenchmark() {
  try {
    parentPort?.postMessage(await sampleWorkerMemoryBenchmark(workerData.fixtures))
  } catch (error) {
    parentPort?.postMessage({
      kind: 'gate5-worker-memory-error',
      message: readErrorMessage(error)
    })
  }
}

/** 启动真实 Node worker thread 收集 worker heap 指标。 */
function runWorkerMemoryBenchmark(inputFixtures) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      type: 'module',
      workerData: {
        fixtures: inputFixtures.map((fixture) => ({
          id: fixture.id,
          document: fixture.document
        }))
      }
    })
    let settled = false

    /** 只处理 worker 的首个最终结果，避免 exit 事件重复结算 Promise。 */
    function settle(callback) {
      if (settled) {
        return
      }
      settled = true
      callback()
    }

    worker.once('message', (message) => {
      settle(() => {
        if (isWorkerMemoryResult(message)) {
          resolve(message)
          return
        }

        reject(new Error(readWorkerMemoryErrorMessage(message)))
      })
    })
    worker.once('error', (error) => {
      settle(() => {
        reject(error)
      })
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(() => {
          reject(new Error(`Gate 5 worker memory benchmark exited with ${code}.`))
        })
      }
    })
  })
}

/** 判断 worker 回传值是否是内存 benchmark 结果。 */
function isWorkerMemoryResult(value) {
  return value !== null &&
    typeof value === 'object' &&
    value.kind === 'gate5-worker-memory' &&
    Number.isFinite(value.workerHeapPeakBytes) &&
    Array.isArray(value.records)
}

/** 读取 worker 内存 benchmark 失败消息。 */
function readWorkerMemoryErrorMessage(value) {
  if (value !== null && typeof value === 'object' && typeof value.message === 'string') {
    return value.message
  }

  return 'Gate 5 worker memory benchmark returned an invalid message.'
}

/** 在线程内顺序采样 DOCX/PDF 互通任务的 heap 使用。 */
async function sampleWorkerMemoryBenchmark(inputFixtures) {
  const heapSamples = [readHeapUsed()]
  const records = []

  for (const fixture of inputFixtures) {
    records.push(await runWorkerMemoryFixture(fixture, heapSamples))
  }

  return {
    kind: 'gate5-worker-memory',
    workerHeapPeakBytes: Math.max(...heapSamples),
    records
  }
}

/** 在线程内运行单个 fixture 并返回该时刻 worker heap 峰值。 */
async function runWorkerMemoryFixture(fixture, heapSamples) {
  const editor = createEditor()

  try {
    const projection = editor.loadDocumentModel({
      document: fixture.document
    })
    const imageInputs = collectPdfImageInputs(fixture.document)

    recordHeapSample(heapSamples)

    const exportResult = await exportDocx(projection, {
      requestId: `${fixture.id}-worker-export`
    })

    recordHeapSample(heapSamples)

    const importResult = await importDocx(exportResult.bytes, {
      requestId: `${fixture.id}-worker-import`
    })
    const importedDocument = convertDocxImportDocumentToCoreDocument(importResult.document)
    const importedEditor = createEditor()

    recordHeapSample(heapSamples)

    try {
      importedEditor.loadDocumentModel({
        document: importedDocument
      })
      const pdfResult = await exportPdfFromLayout(importedEditor.getLayout(), {
        requestId: `${fixture.id}-worker-pdf`,
        images: imageInputs
      })

      recordHeapSample(heapSamples)

      return {
        id: fixture.id,
        workerHeapPeakBytes: Math.max(...heapSamples),
        warningCount: importResult.warnings.length + exportResult.warnings.length + pdfResult.warnings.length
      }
    } finally {
      importedEditor.destroy()
    }
  } finally {
    editor.destroy()
  }
}

/** 运行单个 Gate 5 fixture 的 DOCX 导出、导入和 PDF 导出 benchmark。 */
async function runFixtureBenchmark(fixture, heapSamples, workerMetric) {
  const editor = createEditor()

  try {
    const projection = editor.loadDocumentModel({
      document: fixture.document
    })
    const imageInputs = collectPdfImageInputs(fixture.document)
    const docxExportStart = performance.now()
    const exportResult = await exportDocx(projection, {
      requestId: `${fixture.id}-export`
    })
    const docxExportDurationMs = roundMetric(performance.now() - docxExportStart)

    recordHeapSample(heapSamples)

    const docxImportStart = performance.now()
    const importResult = await importDocx(exportResult.bytes, {
      requestId: `${fixture.id}-import`
    })
    const importedDocument = convertDocxImportDocumentToCoreDocument(importResult.document)
    const docxImportDurationMs = roundMetric(performance.now() - docxImportStart)

    recordHeapSample(heapSamples)

    const importedEditor = createEditor()
    try {
      importedEditor.loadDocumentModel({
        document: importedDocument
      })
      const pdfExportStart = performance.now()
      const pdfResult = await exportPdfFromLayout(importedEditor.getLayout(), {
        requestId: `${fixture.id}-pdf`,
        images: imageInputs
      })
      const pdfExportDurationMs = roundMetric(performance.now() - pdfExportStart)

      recordHeapSample(heapSamples)

      return {
        id: fixture.id,
        group: fixture.group,
        docxImportDurationMs,
        docxExportDurationMs,
        pdfExportDurationMs,
        heapPeakBytes: Math.max(...heapSamples),
        workerHeapPeakBytes: workerMetric?.workerHeapPeakBytes ?? -1,
        fileSizeBytes: exportResult.bytes.byteLength,
        pdfSizeBytes: pdfResult.bytes.byteLength,
        pageCount: importedEditor.getLayout().pages.length,
        imageCount: countDocumentImages(importedDocument),
        warningCount: importResult.warnings.length + exportResult.warnings.length + pdfResult.warnings.length
      }
    } finally {
      importedEditor.destroy()
    }
  } finally {
    editor.destroy()
  }
}

/** 创建 benchmark 使用的 core 文档模型。 */
function createBenchmarkDocument(input) {
  const resources = input.includeImage ? [createPngResource(input.id)] : []
  const blocks = []

  for (let index = 0; index < input.paragraphCount; index += 1) {
    blocks.push(createParagraph(input.id, index))
  }

  if (input.includeImage) {
    blocks.push(createImageParagraph(input.id))
  }

  if (input.includeTable) {
    blocks.push(createBenchmarkTable(input.id))
  }

  return {
    kind: 'document',
    id: `document-${input.id}`,
    resourceIds: resources.map((resource) => resource.id),
    resources,
    sections: [
      {
        kind: 'section',
        id: `section-${input.id}`,
        blocks
      }
    ]
  }
}

/** 创建 benchmark 正文段落。 */
function createParagraph(documentId, index) {
  return {
    kind: 'paragraph',
    id: `paragraph-${documentId}-${index}`,
    runs: [
      {
        kind: 'run',
        id: `run-${documentId}-${index}`,
        properties: {
          fontSizePx: 14
        },
        inlines: [
          {
            kind: 'text',
            text: `Gate 5 benchmark paragraph ${index + 1} for ${documentId}.`
          }
        ]
      }
    ]
  }
}

/** 创建包含 inline 图片的段落。 */
function createImageParagraph(documentId) {
  return {
    kind: 'paragraph',
    id: `paragraph-${documentId}-image`,
    runs: [
      {
        kind: 'run',
        id: `run-${documentId}-image`,
        inlines: [
          {
            kind: 'image',
            resourceId: `resource-${documentId}-png`,
            display: 'inline',
            alt: 'Gate 5 benchmark image',
            widthTwips: 720,
            heightTwips: 720
          }
        ]
      }
    ]
  }
}

/** 创建基础 2 列表格。 */
function createBenchmarkTable(documentId) {
  return {
    kind: 'table',
    id: `table-${documentId}`,
    grid: [2400, 2400],
    rows: [
      {
        id: `table-${documentId}-row-1`,
        cells: [
          {
            id: `table-${documentId}-cell-1`,
            blocks: [createTableParagraph(documentId, 'A')]
          },
          {
            id: `table-${documentId}-cell-2`,
            blocks: [createTableParagraph(documentId, 'B')]
          }
        ]
      }
    ]
  }
}

/** 创建表格单元格里的段落。 */
function createTableParagraph(documentId, suffix) {
  return {
    kind: 'paragraph',
    id: `paragraph-${documentId}-cell-${suffix}`,
    runs: [
      {
        kind: 'run',
        id: `run-${documentId}-cell-${suffix}`,
        inlines: [
          {
            kind: 'text',
            text: `Cell ${suffix}`
          }
        ]
      }
    ]
  }
}

/** 创建一张内联 1x1 PNG 资源。 */
function createPngResource(documentId) {
  return {
    kind: 'resource',
    id: `resource-${documentId}-png`,
    mime: 'image/png',
    source: {
      kind: 'dataUrl',
      url: readOnePixelPngDataUrl()
    },
    status: 'success'
  }
}

/** 把 core 文档资源转换成 PDF 导出图片输入。 */
function collectPdfImageInputs(document) {
  return (document.resources ?? [])
    .filter((resource) => resource.status === 'success' && resource.source.kind === 'dataUrl')
    .map((resource) => ({
      kind: 'dataUrl',
      id: resource.id,
      dataUrl: resource.source.url
    }))
}

/** 统计文档中的图片数量。 */
function countDocumentImages(document) {
  return document.sections.reduce(
    (total, section) => total + section.blocks.reduce((blockTotal, block) => blockTotal + countBlockImages(block), 0),
    0
  )
}

/** 递归统计 block 内的图片数量。 */
function countBlockImages(block) {
  if (block.kind === 'table') {
    return block.rows.reduce(
      (total, row) => total + row.cells.reduce(
        (cellTotal, cell) => cellTotal + cell.blocks.reduce((blockTotal, child) => blockTotal + countBlockImages(child), 0),
        0
      ),
      0
    )
  }

  return block.runs.reduce(
    (total, run) => total + run.inlines.filter((inline) => inline.kind === 'image').length,
    0
  )
}

/** 校验 benchmark 产物和指标完整性。 */
function validateBenchmarkResults(records) {
  if (records.length !== fixtures.length) {
    throw new Error(`Gate 5 benchmark expected ${fixtures.length} records, got ${records.length}.`)
  }

  for (const record of records) {
    for (const metric of [
      record.docxImportDurationMs,
      record.docxExportDurationMs,
      record.pdfExportDurationMs,
      record.heapPeakBytes,
      record.workerHeapPeakBytes,
      record.fileSizeBytes,
      record.pdfSizeBytes,
      record.pageCount
    ]) {
      if (!Number.isFinite(metric) || metric < 0) {
        throw new Error(`Gate 5 benchmark produced invalid metric for ${record.id}.`)
      }
    }

    if (record.fileSizeBytes <= 0 || record.pdfSizeBytes <= 0 || record.pageCount <= 0) {
      throw new Error(`Gate 5 benchmark produced empty artifact for ${record.id}.`)
    }
  }
}

/** 记录当前 Node heap 使用量。 */
function recordHeapSample(heapSamples) {
  heapSamples.push(readHeapUsed())
}

/** 读取当前 Node heap 使用量。 */
function readHeapUsed() {
  return process.memoryUsage().heapUsed
}

/** 读取未知错误的消息。 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/** 统一 benchmark 数字精度。 */
function roundMetric(value) {
  return Math.round(value * 100) / 100
}

/** 返回固定 1x1 PNG data URL。 */
function readOnePixelPngDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
}
