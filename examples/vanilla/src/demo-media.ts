/**
 * 职责：提供 vanilla demo 的 Gate 4 第一版 media adapter、core command 对接和浏览器测试钩子。
 * 边界：不实现上传协议或 editor DOM；这里只负责 demo 级资源上传模拟、core command 桥接与可观察契约。
 * 协作模块：main.ts 把这里的 media options 传给 `createJWordUi(...)`，浏览器测试通过 `window.__jwordDemo.media` 读取钩子。
 * 性能/安全约束：上传状态保持最小真实异步；对 blob URL 负责回收；失败必须显式暴露 retry token。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordMediaOptions,
  JWordMediaResource,
  JWordMediaSource,
  JWordMediaUploadFile,
  JWordMediaUploadOptions,
  JWordMediaUploadRequest
} from '@4xian/jword-ui'
import { cssPxToTwips } from '@4xian/jword-core'
import { createCoreMediaCommandAdapter } from '@4xian/jword-ui'

const DEMO_MEDIA_SCENARIO_PARAM = 'demo-media-scenario'
const DEMO_MEDIA_RETRY_TOKEN_PREFIX = 'demo-media-retry:'
const MEDIA_INLINE_FIXTURE_URL = new URL('../../../fixtures/gate4/media-inline.svg', import.meta.url).href

type DemoMediaScenario = 'success' | 'retry-once' | 'always-fail'

export interface DemoMediaUploadLogEntry {
  readonly resourceId: string
  readonly sourceKind: 'file' | 'url'
  readonly sourceLabel: string
  readonly outcome: 'success' | 'failed'
  readonly retryToken?: string
}

export interface DemoMediaHooks {
  getFixtureUrl(): string
  buildScenarioUrl(scenario: DemoMediaScenario): string
  readUploadLog(): readonly DemoMediaUploadLogEntry[]
}

interface DemoMediaSupport {
  readonly media: JWordMediaOptions
  readonly hooks: DemoMediaHooks
  destroy(): void
}

/** 创建 vanilla demo 的 Gate 4 媒体支持。 */
export function createDemoMediaSupport(): DemoMediaSupport {
  const uploadLog: DemoMediaUploadLogEntry[] = []
  const commands = createCoreMediaCommandAdapter()

  /** 组装 demo 级 media options。 */
  const media = Object.freeze({
    description: 'Gate 4 Iteration 1：验证官方 media panel、上传状态与 core 图片命令的最小闭环。',
    adapter: {
      async upload(request: JWordMediaUploadRequest, options?: JWordMediaUploadOptions) {
        return {
          resource: await uploadDemoResource(request, options, uploadLog)
        }
      },
      async delete(resource: JWordMediaResource) {
        void resource
      }
    },
    commands,
    urlPolicy: {
      allowExternalUrl: (url: URL) => url.origin === window.location.origin
    }
  } satisfies JWordMediaOptions)

  /** 暴露给浏览器测试的最小钩子。 */
  const hooks = Object.freeze({
    getFixtureUrl() {
      return buildScenarioUrl('success')
    },
    buildScenarioUrl,
    readUploadLog() {
      return [...uploadLog]
    }
  } satisfies DemoMediaHooks)

  return {
    media,
    hooks,
    destroy() {
      return
    }
  }
}

/** 构建同源 fixture URL，并用 query 标记 demo 场景。 */
function buildScenarioUrl(scenario: DemoMediaScenario): string {
  const url = new URL(MEDIA_INLINE_FIXTURE_URL, window.location.href)

  if (scenario === 'success') {
    url.searchParams.delete(DEMO_MEDIA_SCENARIO_PARAM)
    return url.toString()
  }

  url.searchParams.set(DEMO_MEDIA_SCENARIO_PARAM, scenario)

  return url.toString()
}

/** 执行一次 demo 级上传，并根据场景返回成功或失败。 */
async function uploadDemoResource(
  request: JWordMediaUploadRequest,
  options: JWordMediaUploadOptions | undefined,
  uploadLog: DemoMediaUploadLogEntry[]
): Promise<JWordMediaResource> {
  await emitUploadProgress(options)

  if (request.source.kind === 'file') {
    const source = await createFileDataUrlMediaSource(request.source.file)
    const sizeMetadata = await loadIntrinsicSizeMetadata(source.url)
    const resource = createDemoResource(
      request,
      source,
      request.source.file.type || 'image/svg+xml',
      sizeMetadata
    )

    uploadLog.push(createUploadLogEntry(request, 'success'))

    return resource
  }

  const scenario = readDemoScenario(request.source.url)

  if (scenario === 'always-fail') {
    const retryToken = `${DEMO_MEDIA_RETRY_TOKEN_PREFIX}${request.resourceId}`

    uploadLog.push(createUploadLogEntry(request, 'failed', retryToken))
    throw createDemoUploadError('DEMO_MEDIA_ALWAYS_FAIL', '当前 demo URL 被配置为持续失败，请检查地址或继续重试。', retryToken)
  }

  if (scenario === 'retry-once' && request.retryToken === undefined) {
    const retryToken = `${DEMO_MEDIA_RETRY_TOKEN_PREFIX}${request.resourceId}`

    uploadLog.push(createUploadLogEntry(request, 'failed', retryToken))
    throw createDemoUploadError('DEMO_MEDIA_TEMP_FAILURE', '当前 demo URL 首次上传临时失败，请点击重试。', retryToken)
  }

  const resourceUrl = stripDemoScenarioFromUrl(request.source.url)
  const source = createUrlMediaSource(resourceUrl)
  const sizeMetadata = await loadIntrinsicSizeMetadata(source.url)
  const resource = createDemoResource(
    request,
    source,
    inferMimeTypeFromUrl(resourceUrl),
    sizeMetadata
  )

  uploadLog.push(createUploadLogEntry(request, 'success'))

  return resource
}

/** 以最小异步方式发出进度事件，确保 pending 状态在真实浏览器里可见。 */
async function emitUploadProgress(options: JWordMediaUploadOptions | undefined): Promise<void> {
  options?.onProgress?.({
    loaded: 25,
    total: 100
  })
  await delay(40)
  options?.onProgress?.({
    loaded: 70,
    total: 100
  })
  await delay(40)
}

/** 从当前上传请求生成可观察日志项。 */
function createUploadLogEntry(
  request: JWordMediaUploadRequest,
  outcome: 'success' | 'failed',
  retryToken?: string
): DemoMediaUploadLogEntry {
  return {
    resourceId: request.resourceId,
    sourceKind: request.source.kind,
    sourceLabel: request.source.kind === 'file' ? request.source.file.name : request.source.url,
    outcome,
    ...(retryToken === undefined ? {} : { retryToken })
  }
}

/** 创建文件上传成功后的可持久化 dataUrl source。 */
async function createFileDataUrlMediaSource(file: JWordMediaUploadFile): Promise<JWordMediaSource> {
  return {
    kind: 'dataUrl',
    url: await readFileAsDataUrl(file)
  }
}

/** 根据 URL 协议归一化资源 source。 */
function createUrlMediaSource(url: string): JWordMediaSource {
  if (url.startsWith('data:')) {
    return {
      kind: 'dataUrl',
      url
    }
  }

  if (url.startsWith('blob:')) {
    return {
      kind: 'blobUrl',
      url
    }
  }

  return {
    kind: 'externalUrl',
    url
  }
}

/** 生成 demo 资源快照。 */
function createDemoResource(
  request: JWordMediaUploadRequest,
  source: JWordMediaSource,
  mime: string,
  metadata: Readonly<{
    widthTwips: number
    heightTwips: number
    naturalWidth: number
    naturalHeight: number
  }>
): JWordMediaResource {
  return {
    kind: 'resource',
    id: request.resourceId,
    mime,
    source,
    status: 'success',
    metadata
  }
}

/** 从 URL 查询参数读取当前 demo 场景。 */
function readDemoScenario(url: string): DemoMediaScenario {
  const parsedUrl = new URL(url, window.location.href)
  const scenario = parsedUrl.searchParams.get(DEMO_MEDIA_SCENARIO_PARAM)

  return scenario === 'retry-once' || scenario === 'always-fail'
    ? scenario
    : 'success'
}

/** 移除 demo 场景 query，避免 data URL fixture 被 query 破坏解码。 */
function stripDemoScenarioFromUrl(url: string): string {
  const parsedUrl = new URL(url, window.location.href)

  parsedUrl.searchParams.delete(DEMO_MEDIA_SCENARIO_PARAM)

  return parsedUrl.toString()
}

/** 根据资源 URL 推断最小 mime。 */
function inferMimeTypeFromUrl(url: string): string {
  return new URL(url, window.location.href).pathname.toLowerCase().endsWith('.svg')
    ? 'image/svg+xml'
    : 'image/*'
}

/** 构造 demo 上传失败对象，保留 retry token。 */
function createDemoUploadError(code: string, message: string, retryToken: string): Error & { readonly code: string, readonly retryToken: string } {
  const error = new Error(message) as Error & { readonly code: string, readonly retryToken: string }

  Reflect.set(error, 'code', code)
  Reflect.set(error, 'retryToken', retryToken)

  return error
}

/** 最小延时 helper，用于稳定观察 pending 状态。 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** 读取图片天然尺寸，并把像素尺寸转成插图命令需要的 twips。 */
async function loadIntrinsicSizeMetadata(url: string): Promise<Readonly<{
  widthTwips: number
  heightTwips: number
  naturalWidth: number
  naturalHeight: number
}>> {
  const size = await loadImageIntrinsicSize(url)

  return Object.freeze({
    widthTwips: cssPxToTwips(size.naturalWidth),
    heightTwips: cssPxToTwips(size.naturalHeight),
    naturalWidth: size.naturalWidth,
    naturalHeight: size.naturalHeight
  })
}

/** 通过浏览器图片解码读取天然宽高。 */
function loadImageIntrinsicSize(url: string): Promise<Readonly<{
  naturalWidth: number
  naturalHeight: number
}>> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error(`无法读取图片天然尺寸: ${url}`))
        return
      }

      resolve(Object.freeze({
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      }))
    }
    image.onerror = () => {
      reject(new Error(`图片解码失败: ${url}`))
    }
    image.src = url
  })
}

/** 把上传文件转换成 canonical snapshot 可持久化的 dataUrl。 */
async function readFileAsDataUrl(file: JWordMediaUploadFile): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return `data:${file.type || 'application/octet-stream'};base64,${window.btoa(binary)}`
}
