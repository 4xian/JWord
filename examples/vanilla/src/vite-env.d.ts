/**
 * 职责：声明 vanilla 最小示例使用的 Vite 客户端类型。
 * 边界：不声明测试全局对象或编辑器运行时桥接。
 * 协作模块：examples/vanilla/src/main.ts 与 Vite client 类型。
 * 性能/安全约束：仅提供类型信息，没有运行时副作用。
 * 实现说明：默认示例只消费 @4xian/jword-ui 公开接口。
 */
/// <reference types="vite/client" />
