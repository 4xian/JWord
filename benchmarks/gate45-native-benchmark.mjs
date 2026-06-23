/**
 * 职责：输出 Gate 4.5 `.jword` 原生保存、打开和校验的确定性 benchmark 指标。
 * 边界：只运行本地合成 canonical 文档，不读取真实 `.jword` fixture，也不依赖浏览器环境。
 * 协作模块：packages/native、packages/core 和 tools/bench/run-bench.mjs。
 * 约束：输出必须是可机器读取 JSON，指标字段保持稳定，用于计划回写和后续趋势比较。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-6---benchmarkbundle-和文档计划。
 */
import { performance } from 'node:perf_hooks'

import {
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage
} from '../packages/native/dist/index.js'

const fixtures = [
  {
    id: 'gate45-1-page',
    pageCount: 1,
    document: createBenchmarkDocument('gate45-1-page', 8, false, false)
  },
  {
    id: 'gate45-50-pages',
    pageCount: 50,
    document: createBenchmarkDocument('gate45-50-pages', 300, false, false)
  },
  {
    id: 'gate45-200-pages',
    pageCount: 200,
    document: createBenchmarkDocument('gate45-200-pages', 1200, false, false)
  },
  {
    id: 'gate45-image',
    pageCount: 2,
    document: createBenchmarkDocument('gate45-image', 12, true, false)
  },
  {
    id: 'gate45-table',
    pageCount: 3,
    document: createBenchmarkDocument('gate45-table', 16, false, true)
  }
]

const heapSamples = [readHeapUsed()]
const results = []

for (const fixture of fixtures) {
  results.push(await runFixtureBenchmark(fixture, heapSamples))
}

const totals = results.reduce(
  (metrics, result) => ({
    saveDurationMs: roundMetric(metrics.saveDurationMs + result.saveDurationMs),
    loadDurationMs: roundMetric(metrics.loadDurationMs + result.loadDurationMs),
    validateDurationMs: roundMetric(metrics.validateDurationMs + result.validateDurationMs),
    fileSizeBytes: metrics.fileSizeBytes + result.fileSizeBytes,
    pageCount: metrics.pageCount + result.pageCount,
    resourceCount: metrics.resourceCount + result.resourceCount,
    warningCount: metrics.warningCount + result.warningCount
  }),
  {
    saveDurationMs: 0,
    loadDurationMs: 0,
    validateDurationMs: 0,
    fileSizeBytes: 0,
    pageCount: 0,
    resourceCount: 0,
    warningCount: 0
  }
)

validateBenchmarkResults(results)

console.log(
  JSON.stringify(
    {
      status: 'ok',
      benchmark: 'gate45-native',
      fixtures: results,
      totals,
      heapPeakBytes: Math.max(...heapSamples),
      note: 'Gate 4.5 native benchmark records save/load/validate timing for synthetic one-page, 50-page, 200-page, image, and table documents.'
    },
    null,
    2
  )
)

/** 运行单个 native fixture benchmark。 */
async function runFixtureBenchmark(fixture, heapSamples) {
  const saveStart = performance.now()
  const saveResult = await saveJWordDocument(fixture.document, {
    requestId: `${fixture.id}-save`
  })
  const saveDurationMs = roundMetric(performance.now() - saveStart)
  recordHeapSample(heapSamples)

  const loadStart = performance.now()
  const loadResult = await loadJWordDocument(saveResult.bytes, {
    requestId: `${fixture.id}-load`
  })
  const loadDurationMs = roundMetric(performance.now() - loadStart)
  recordHeapSample(heapSamples)

  const validateStart = performance.now()
  const validateResult = await validateJWordPackage(saveResult.bytes, {
    requestId: `${fixture.id}-validate`
  })
  const validateDurationMs = roundMetric(performance.now() - validateStart)
  recordHeapSample(heapSamples)

  return {
    id: fixture.id,
    pageCount: fixture.pageCount,
    saveDurationMs,
    loadDurationMs,
    validateDurationMs,
    fileSizeBytes: saveResult.bytes.byteLength,
    resourceCount: saveResult.resources.length,
    warningCount: saveResult.warnings.length + loadResult.warnings.length + validateResult.warnings.length
  }
}

/** 创建 Gate 4.5 benchmark 用的合成 canonical document。 */
function createBenchmarkDocument(id, paragraphCount, includeImage, includeTable) {
  const resources = includeImage ? [createPngResource(id)] : []

  return {
    kind: 'document',
    id,
    resourceIds: resources.map((resource) => resource.id),
    resources,
    sections: [
      {
        kind: 'section',
        id: `section-${id}`,
        blocks: [
          ...Array.from({ length: paragraphCount }, (_, index) => createParagraph(id, index)),
          ...(includeImage ? [createImageParagraph(id)] : []),
          ...(includeTable ? [createBenchmarkTable(id)] : [])
        ]
      }
    ]
  }
}

/** 创建普通段落。 */
function createParagraph(documentId, index) {
  return {
    kind: 'paragraph',
    id: `paragraph-${documentId}-${index}`,
    runs: [
      {
        kind: 'run',
        id: `run-${documentId}-${index}`,
        inlines: [
          {
            kind: 'text',
            text: `Gate 4.5 benchmark paragraph ${index + 1} for ${documentId}.`
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
            alt: 'Gate 4.5 benchmark image',
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

/** 读取 base64 编码的一像素 PNG。 */
function readOnePixelPngDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
}

/** 校验 benchmark 结果。 */
function validateBenchmarkResults(records) {
  if (records.length !== fixtures.length) {
    throw new Error(`Gate 4.5 benchmark expected ${fixtures.length} records, got ${records.length}.`)
  }

  for (const record of records) {
    for (const metric of [
      record.saveDurationMs,
      record.loadDurationMs,
      record.validateDurationMs,
      record.fileSizeBytes,
      record.pageCount,
      record.resourceCount,
      record.warningCount
    ]) {
      if (!Number.isFinite(metric) || metric < 0) {
        throw new Error(`Gate 4.5 benchmark produced invalid metric for ${record.id}.`)
      }
    }
  }
}

/** 记录 heap 峰值。 */
function recordHeapSample(heapSamples) {
  heapSamples.push(readHeapUsed())
}

/** 读取当前进程 heap 使用量。 */
function readHeapUsed() {
  return process.memoryUsage().heapUsed
}

/** 保留两位小数。 */
function roundMetric(value) {
  return Math.round(value * 100) / 100
}
