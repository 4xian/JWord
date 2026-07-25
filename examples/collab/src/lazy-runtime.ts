/**
 * 职责：作为 collab demo 的懒加载边界，按需加载 provider、offline、history 和内存 runtime。
 * 边界：只负责动态 import 与 runtime 装配，不接 DOM、不注册事件、不声明真实 provider/offline 完成。
 * 协作：main.ts、runtime/provider-runtime、runtime/offline-runtime、runtime/history-runtime 和 runtime.ts。
 * 约束：provider/offline/history 分片必须通过动态 import 进入 demo，避免首屏静态拉入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { CollabDemoRuntime } from './runtime'
import type { HocuspocusDemoRuntimeOptions } from './runtime/hocuspocus-runtime'

/** 动态加载 Gate 6 collab demo runtime 及其重分片。 */
export async function loadCollabDemoRuntime(): Promise<CollabDemoRuntime> {
  const [
    providerModule,
    offlineModule,
    historyModule,
    runtimeModule
  ] = await Promise.all([
    import('./runtime/provider-runtime'),
    import('./runtime/offline-runtime'),
    import('./runtime/history-runtime'),
    import('./runtime')
  ])
  const provider = providerModule.createCollabDemoProviderRuntimeSeed()
  const initialText = provider.clients[0]?.text ?? ''

  return runtimeModule.createCollabDemoRuntime({
    provider,
    offline: offlineModule.createCollabDemoOfflineRuntimeSeed(),
    versionHistory: historyModule.createCollabDemoHistoryRuntimeSeed(initialText)
  })
}

/** 动态加载真实 Hocuspocus provider demo runtime。 */
export async function loadHocuspocusDemoRuntime(
  options: HocuspocusDemoRuntimeOptions
): Promise<CollabDemoRuntime> {
  const runtimeModule = await import('./runtime/hocuspocus-runtime')

  return runtimeModule.createHocuspocusDemoRuntime(options)
}
