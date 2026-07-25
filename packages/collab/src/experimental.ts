/**
 * 职责：导出 Gate 6 协作包的 experimental provider adapter 入口。
 * 边界：只暴露可替换 provider adapter，不承诺为 stable 第三方集成 API。
 * 协作模块：packages/collab/src/index.ts 提供 stable 类型，hocuspocus-adapter.ts 提供当前 provider 实现。
 * 性能/安全约束：入口无副作用；调用方必须显式选择 experimental 子路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export {
  createHocuspocusCollabProviderAdapter
} from './hocuspocus-adapter.js'
export type {
  CreateHocuspocusCollabProviderAdapterOptions
} from './hocuspocus-adapter.js'
