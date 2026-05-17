/**
 * 职责：提供 mounted 浏览器 runtime 可用的图片解码缓存与解析器。
 * 边界：只在调用方显式传入 ownerDocument 后创建图片对象，不访问编辑器状态、不修改文档模型。
 * 协作模块：canvas renderer 读取解析状态，mounted runtime 负责创建实例并在状态变化后触发重绘。
 * 性能/安全约束：按 resourceId 复用解码任务，顶层不访问 DOM，释放后禁止继续触发失效回调。
 */

export interface CanvasDecodedImageResource {
  readonly source: unknown
  readonly width: number
  readonly height: number
}

export type CanvasImageResourceResolution =
  | {
      readonly status: 'pending'
    }
  | {
      readonly status: 'ready'
      readonly image: CanvasDecodedImageResource
    }
  | {
      readonly status: 'failed'
    }

export interface CanvasImageResourceResolver {
  resolve(resourceId: string, sourceUrl: string): CanvasImageResourceResolution
  dispose(): void
}

interface MountedCanvasImageResourceResolverOptions {
  readonly ownerDocument: Document
  readonly onInvalidate: () => void
}

interface MountedImageCacheEntry {
  readonly sourceUrl: string
  status: CanvasImageResourceResolution['status']
  image: CanvasDecodedImageResource | undefined
}

/**
 * 职责：创建只在 mounted 浏览器环境里可用的图片解析器。
 */
export function createMountedCanvasImageResourceResolver(
  options: MountedCanvasImageResourceResolverOptions
): CanvasImageResourceResolver {
  const cache = new Map<string, MountedImageCacheEntry>()
  let disposed = false

  /**
   * 职责：返回当前资源解码状态，并在首次访问或 URL 变化时启动异步解码。
   */
  function resolve(resourceId: string, sourceUrl: string): CanvasImageResourceResolution {
    let entry = cache.get(resourceId)

    if (entry === undefined || entry.sourceUrl !== sourceUrl) {
      entry = {
        sourceUrl,
        status: 'pending',
        image: undefined
      }
      cache.set(resourceId, entry)
      startDecode(resourceId, entry)
    }

    if (entry.status === 'ready' && entry.image !== undefined) {
      return {
        status: 'ready',
        image: entry.image
      }
    }

    return entry.status === 'failed'
      ? { status: 'failed' }
      : { status: 'pending' }
  }

  /**
   * 职责：释放缓存并阻止已在途的图片解码继续触发重绘。
   */
  function dispose(): void {
    disposed = true
    cache.clear()
  }

  /**
   * 职责：启动单个资源的浏览器态图片解码，并在状态切换后通知调用方重绘。
   */
  function startDecode(resourceId: string, entry: MountedImageCacheEntry): void {
    void decodeImageResource(options.ownerDocument, entry.sourceUrl)
      .then((image) => {
        if (disposed || cache.get(resourceId) !== entry) {
          return
        }

        entry.status = 'ready'
        entry.image = image
        options.onInvalidate()
      })
      .catch(() => {
        if (disposed || cache.get(resourceId) !== entry) {
          return
        }

        entry.status = 'failed'
        entry.image = undefined
        options.onInvalidate()
      })
  }

  return {
    resolve,
    dispose
  }
}

/**
 * 职责：在浏览器环境里创建图片元素并等待其进入可绘制状态。
 */
function decodeImageResource(ownerDocument: Document, sourceUrl: string): Promise<CanvasDecodedImageResource> {
  const image = ownerDocument.createElement('img')

  image.decoding = 'async'
  image.src = sourceUrl

  if (typeof image.decode === 'function') {
    return image.decode().then(() => createDecodedImageResource(image))
  }

  return new Promise((resolve, reject) => {
    /**
     * 职责：移除本次解码注册的临时事件监听。
     */
    function cleanup(): void {
      image.onload = null
      image.onerror = null
    }

    image.onload = () => {
      cleanup()
      resolve(createDecodedImageResource(image))
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('图片解码失败'))
    }
  })
}

/**
 * 职责：把可绘制图片元素包装成 renderer 可消费的最小资源对象。
 */
function createDecodedImageResource(image: HTMLImageElement): CanvasDecodedImageResource {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height

  if (width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效')
  }

  return {
    source: image,
    width,
    height
  }
}
