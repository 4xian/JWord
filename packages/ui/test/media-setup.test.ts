/**
 * @vitest-environment jsdom
 *
 * 职责：验证 UI 默认图片配置不要求宿主额外传入上传适配器。
 * 边界：只覆盖 media-setup 默认适配器，不验证 editor 插图命令。
 * 协作：packages/ui/src/media-setup.ts 与公开 JWordMediaOptions。
 * 约束：用最小文件对象验证 data URL 封装，避免依赖真实文件系统。
 */

import { describe, expect, test, vi } from 'vitest'

import { resolveMediaOptions } from '../src/media-setup'

describe('resolveMediaOptions', () => {
  test('未传 media 配置时内建适配器会把本地图片封装成 data URL 资源', async () => {
    const media = resolveMediaOptions(undefined)
    const onProgress = vi.fn()

    const result = await media.adapter.upload({
      resourceId: 'resource-1',
      source: {
        kind: 'file',
        file: {
          name: 'sample.svg',
          type: 'image/svg+xml',
          size: 4,
          async arrayBuffer() {
            return new Uint8Array([60, 115, 118, 103]).buffer
          }
        }
      }
    }, { onProgress })

    expect(result.resource.id).toBe('resource-1')
    expect(result.resource.mime).toBe('image/svg+xml')
    expect(result.resource.status).toBe('success')
    expect(result.resource.source.kind).toBe('dataUrl')
    expect(result.resource.source.url).toContain('data:image/svg+xml;base64,')
    expect(result.resource.metadata?.alt).toBe('sample.svg')
    expect(onProgress).toHaveBeenCalledWith({ loaded: 0, total: 100 })
    expect(onProgress).toHaveBeenCalledWith({ loaded: 100, total: 100 })
  })
})
