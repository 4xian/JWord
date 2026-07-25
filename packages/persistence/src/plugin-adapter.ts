/**
 * 职责：把 persistence snapshot adapter 包装成 Gate 7 Plugin adapter descriptor。
 * 边界：只创建 descriptor，不注册插件、不读取 Yjs store、不改变版本历史路线。
 * 协作模块：@4xian/jword-core 的 Plugin adapter registry 和 persistence snapshot adapter contract。
 * 性能/安全约束：helper 无顶层副作用，preview/restore 仍由传入的 persistence adapter 自身负责。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { PluginPersistenceAdapterDescriptor } from '@4xian/jword-core'

import type { JWordPersistenceSnapshotAdapter } from './index.js'

export interface CreateJWordPersistencePluginAdapterOptions {
  /** 当前 plugin registry 内的 adapter 名称。 */
  readonly name?: string
  /** persistence 能力对应的 feature key。 */
  readonly featureKey?: string
}

/** 创建 persistence plugin adapter descriptor。 */
export function createJWordPersistencePluginAdapter(
  adapter: JWordPersistenceSnapshotAdapter,
  options: CreateJWordPersistencePluginAdapterOptions = {}
): PluginPersistenceAdapterDescriptor<void, JWordPersistenceSnapshotAdapter> {
  return {
    kind: 'persistence',
    name: options.name ?? 'jword.persistence',
    ...(options.featureKey === undefined ? {} : { featureKey: options.featureKey }),
    diagnosticsSource: 'persistence',
    execute() {
      return adapter
    }
  }
}
