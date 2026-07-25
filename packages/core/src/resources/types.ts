/**
 * 职责：定义 Gate 4 资源表、上传适配器和 URL allowlist 的最小公开类型边界。
 * 边界：只描述资源快照、上传输入和校验策略，不访问 DOM、不执行网络请求、不依赖具体宿主。
 * 协作模块：model/types、projection、图片 operation、UI media panel 和未来的 docx/media adapter 通过这里对齐资源语义。
 * 性能/安全约束：类型保持 JSON 兼容；默认策略不信任任意外部 URL。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export type ResourceStatus = 'pending' | 'success' | 'failed'

export type ResourceSource =
  | {
      readonly kind: 'dataUrl'
      readonly url: string
    }
  | {
      readonly kind: 'blobUrl'
      readonly url: string
    }
  | {
      readonly kind: 'externalUrl'
      readonly url: string
    }
  | {
      readonly kind: 'packedResource'
      readonly url: string
    }

export interface ResourceErrorState {
  readonly code: string
  readonly message: string
}

export type ResourceMetadata = Readonly<Record<string, unknown>>

export interface Resource {
  readonly kind: 'resource'
  readonly id: string
  readonly mime: string
  readonly source: ResourceSource
  readonly status: ResourceStatus
  readonly error?: ResourceErrorState
  readonly retryToken?: string
  readonly metadata?: ResourceMetadata
}

export interface ResourceUploadProgressEvent {
  readonly loaded: number
  readonly total?: number
}

export interface AbortSignalLike {
  readonly aborted: boolean
}

export interface ResourceUploadFile {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type ResourceUploadSource =
  | {
      readonly kind: 'file'
      readonly file: ResourceUploadFile
    }
  | {
      readonly kind: 'url'
      readonly url: string
    }

export interface ResourceAdapterUploadRequest {
  readonly resourceId: string
  readonly source: ResourceUploadSource
  readonly previousResource?: Resource
  readonly retryToken?: string
}

export interface ResourceAdapterUploadOptions {
  readonly signal?: AbortSignalLike
  readonly onProgress?: (event: ResourceUploadProgressEvent) => void
}

export interface ResourceAdapterUploadResult {
  readonly resource: Resource
}

/** 宿主侧资源上传与删除适配器，供图片和附件命令通过公开契约接入。 */
export interface ResourceAdapter {
  upload(
    request: ResourceAdapterUploadRequest,
    options?: ResourceAdapterUploadOptions
  ): Promise<ResourceAdapterUploadResult>
  delete?(resource: Resource): Promise<void>
}

export interface ResourceUrlPolicy {
  readonly allowDataUrl?: boolean
  readonly allowBlobUrl?: boolean
  readonly allowExternalUrl?: (url: URL) => boolean
}

export const DEFAULT_RESOURCE_URL_POLICY: Readonly<Required<Omit<ResourceUrlPolicy, 'allowExternalUrl'>>> = Object.freeze({
  allowDataUrl: true,
  allowBlobUrl: true
})

/**
 * 职责：按默认安全策略判断资源 URL 是否可被接纳到图片纵线里。
 */
export function isAllowedResourceUrl(url: string, policy: ResourceUrlPolicy = {}): boolean {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch {
    return false
  }

  if (parsedUrl.protocol === 'data:') {
    return policy.allowDataUrl ?? DEFAULT_RESOURCE_URL_POLICY.allowDataUrl
  }

  if (parsedUrl.protocol === 'blob:') {
    return policy.allowBlobUrl ?? DEFAULT_RESOURCE_URL_POLICY.allowBlobUrl
  }

  if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
    return policy.allowExternalUrl?.(parsedUrl) ?? false
  }

  return false
}
