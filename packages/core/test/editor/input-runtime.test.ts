/**
 * @vitest-environment jsdom
 *
 * 职责：保留 input runtime 拆分后的历史入口说明。
 * 边界：真实行为断言已按输入路径迁移到 input-runtime-*.test.ts，本文件不再承载测试用例。
 * 协作模块：input-runtime-keyboard/composition/errors/image/pointer/clipboard 测试共同覆盖原文件行为。
 * 性能/安全约束：只作为 Phase 5 T1 拆分入口说明，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md §3.10 T1。
 */
export {}
