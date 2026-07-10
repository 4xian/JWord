/** 由 tools/diagnostics/generate-diagnostics-artifacts.mjs 生成，请勿直接编辑。 */

/**
 * 职责：暴露由统一诊断 registry 生成的 diagnostics export 摘要。
 * 边界：只包含 registry 元信息，不把完整错误码表打入 core runtime。
 * 协作模块：editor/observability.ts 在 exportDiagnostics() 中声明快照所依据的错误码 registry。
 * 性能/安全约束：常量无副作用，不包含用户文档内容或插件 details。
 * Specs：docs/sdk/diagnostic-codes.md。
 */

export const JWORD_DIAGNOSTICS_REGISTRY_SUMMARY = {
  source: 'fixtures/collab/diagnostics-registry.json',
  schemaVersion: 1,
  codeCount: 190
} as const
