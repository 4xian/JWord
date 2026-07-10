/**
 * 职责：解析 createJWordUi 的图片工具配置和默认命令适配器。
 * 边界：不创建 media controller DOM，不执行上传或 editor 命令。
 * 协作模块：ui-lifecycle 读取默认配置后交给 media/controller。
 * 性能/安全约束：默认适配器只做本地文件 data URL 与已放行 URL 的轻量资源封装。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { createCoreMediaCommandAdapter } from './media/core-command-adapter'
import type {
  JWordMediaOptions,
  JWordMediaUploadRequest,
  JWordMediaUploadResult
} from './types'

/** 解析图片工具配置；未传配置时使用内建轻量图片适配器。 */
export function resolveMediaOptions(media: JWordMediaOptions | undefined): JWordMediaOptions {
  if (media !== undefined) {
    return media
  }

  return Object.freeze({
    description: '默认图片工具支持本地文件 data URL 和已放行 URL 插入。',
    adapter: createDefaultMediaAdapter(),
    commands: createCoreMediaCommandAdapter()
  } satisfies JWordMediaOptions)
}

/** 创建默认图片适配器，避免基础插图能力依赖宿主额外传入。 */
function createDefaultMediaAdapter(): JWordMediaOptions['adapter'] {
  return {
    async upload(request, options): Promise<JWordMediaUploadResult> {
      options?.onProgress?.({ loaded: 0, total: 100 })
      const resource = request.source.kind === 'file'
        ? await createFileResource(request)
        : createUrlResource(request)

      options?.onProgress?.({ loaded: 100, total: 100 })

      return { resource }
    },
    async delete(): Promise<void> {}
  }
}

/** 把本地文件转成 data URL 资源。 */
async function createFileResource(request: JWordMediaUploadRequest): Promise<JWordMediaUploadResult['resource']> {
  if (request.source.kind !== 'file') {
    throw new Error('当前上传来源不是本地文件。')
  }

  const file = request.source.file
  const mime = normalizeImageMime(file.type, file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())

  return {
    kind: 'resource',
    id: request.resourceId,
    mime,
    status: 'success',
    source: {
      kind: 'dataUrl',
      url: `data:${mime};base64,${encodeBase64(bytes)}`
    },
    metadata: {
      alt: file.name
    }
  }
}

/** 把已通过 URL policy 的地址封装成外部图片资源。 */
function createUrlResource(request: JWordMediaUploadRequest): JWordMediaUploadResult['resource'] {
  if (request.source.kind !== 'url') {
    throw new Error('当前上传来源不是 URL。')
  }

  const url = request.source.url

  return {
    kind: 'resource',
    id: request.resourceId,
    mime: readImageMimeFromUrl(url),
    status: 'success',
    source: {
      kind: readUrlSourceKind(url),
      url
    },
    metadata: {
      alt: url
    }
  }
}

/** 读取 URL 对应的资源来源类型。 */
function readUrlSourceKind(url: string): 'dataUrl' | 'blobUrl' | 'externalUrl' {
  if (url.startsWith('data:')) {
    return 'dataUrl'
  }

  if (url.startsWith('blob:')) {
    return 'blobUrl'
  }

  return 'externalUrl'
}

/** 按文件类型或文件名推断图片 MIME。 */
function normalizeImageMime(type: string, name: string): string {
  if (type.startsWith('image/')) {
    return type
  }

  return readImageMimeFromName(name)
}

/** 从 URL 或 data URL 读取图片 MIME。 */
function readImageMimeFromUrl(url: string): string {
  const dataUrlMatch = /^data:([^;,]+)/.exec(url)

  if (dataUrlMatch?.[1]?.startsWith('image/') === true) {
    return dataUrlMatch[1]
  }

  return readImageMimeFromName(url)
}

/** 从文件名或路径扩展名推断图片 MIME。 */
function readImageMimeFromName(name: string): string {
  const lowerName = name.toLowerCase()

  if (lowerName.endsWith('.svg')) {
    return 'image/svg+xml'
  }

  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (lowerName.endsWith('.gif')) {
    return 'image/gif'
  }

  if (lowerName.endsWith('.webp')) {
    return 'image/webp'
  }

  return 'image/png'
}

/** 把二进制内容编码成 data URL 可用的 base64。 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let index = 0; index < bytes.length; index += 8192) {
    const chunk = bytes.subarray(index, index + 8192)

    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
