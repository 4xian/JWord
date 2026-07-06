/**
 * 职责：解析 createJWordUi 的图片工具配置和默认命令适配器。
 * 边界：不创建 media controller DOM，不执行上传或 editor 命令。
 * 协作模块：ui-lifecycle 读取默认配置后交给 media/controller。
 * 性能/安全约束：默认适配器只保留禁用上传兜底，不引入额外异步副作用。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import { createCoreMediaCommandAdapter } from './media/core-command-adapter'
import type { JWordMediaOptions } from './types'

/** 解析图片工具配置；宿主未提供上传适配器时保留禁用入口。 */
export function resolveMediaOptions(media: JWordMediaOptions | undefined): JWordMediaOptions {
  if (media !== undefined) {
    return media
  }

  return Object.freeze({
    title: '图片',
    description: '图片工具需要宿主提供上传适配器；未配置时入口保持禁用。',
    adapter: {
      /** 未配置上传适配器时兜底阻断上传。 */
      async upload() {
        throw new Error('图片上传适配器未配置。')
      },
      /** 未配置上传适配器时删除动作无外部资源可清理。 */
      async delete() {
        return
      }
    },
    commands: createCoreMediaCommandAdapter()
  } satisfies JWordMediaOptions)
}
