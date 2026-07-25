/**
 * 职责：提供 Phase 4 性能专项使用的 10 万字 / 200 页确定性纯文本 fixture。
 * 边界：只生成稳定段落文本，不读取磁盘，不依赖 core、DOM 或 benchmark 逻辑。
 * 协作模块：benchmarks/phase4-input-hotpath-benchmark.mjs、tests/gate2-fixture.test.ts 与后续 perf e2e。
 * 约束：段落数量和文本模板共同锁定当前 A4 200 页基线；调整时必须同步更新 benchmark 与测试。
 */

export const GATE2_LARGE_PARAGRAPH_COUNT = 4600
export const GATE2_LARGE_EXPECTED_PAGE_COUNT = 200
export const GATE2_LARGE_MIN_CHARACTER_COUNT = 100_000

/**
 * 创建 Phase 4 大文档 fixture 段落列表。
 */
export function createGate2LargeFixtureParagraphs() {
  return Array.from({ length: GATE2_LARGE_PARAGRAPH_COUNT }, (_item, index) => createLargeFixtureParagraph(index))
}

/**
 * 创建可直接传入 Editor createDocument 的大文档文本。
 */
export function createGate2LargeFixtureEditorText() {
  return createGate2LargeFixtureParagraphs().join('\n\n')
}

/**
 * 创建单个稳定段落，保持每行宽度一致以固定分页结果。
 */
function createLargeFixtureParagraph(index) {
  return `Gate 3 input paragraph ${String(index + 1).padStart(4, '0')}: deterministic large plain text fixture paragraph for 200-page input performance benchmark.`
}
