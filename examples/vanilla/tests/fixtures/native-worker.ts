/**
 * 职责：作为 vanilla demo 的 Gate 4.5 原生保存/打开 Web Worker 入口。
 * 边界：只导入 `@4xian/jword-native/worker` 公开子路径，不读取 native 包源码或 core 内部状态。
 * 协作模块：examples/vanilla/tests/fixtures/test-native.ts 和 @4xian/jword-native worker runtime。
 * 性能/安全约束：保存、打开和校验任务在 worker 内执行，主线程只负责传递 document/input 和接收事件。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { bindJWordNativeWorkerRuntime } from '@4xian/jword-native/worker'

const workerScope = self as unknown as {
  readonly addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void
  readonly postMessage: (event: unknown, transferables: Transferable[]) => void
}

bindJWordNativeWorkerRuntime({
  /** 绑定 worker message 监听。 */
  addEventListener(type, listener) {
    workerScope.addEventListener(type, listener)
  },
  /** 发送 worker runtime 事件回主线程。 */
  postMessage(event, transferables) {
    workerScope.postMessage(event, [...transferables])
  }
})
