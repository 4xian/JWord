/**
 * 职责：通过稳定的 node:module.register API 注册兼容 runner 测试 loader。
 * 边界：只由架构测试子进程的 NODE_OPTIONS 预加载，不改变普通 Node 运行时。
 * 协作模块：gate5-compatibility-runner-helpers.ts 引用本文件。
 * 性能/安全约束：只注册同目录 test-only loader，不加载生产 trust 或签名材料。
 */

import { register } from 'node:module'

register('./test-only-license-loader.mjs', import.meta.url)
