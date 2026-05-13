/**
 * 职责：统一 Gate 2 纯文本 fixture 的“非空行即段落”解释。
 * 边界：只做文本归一化和段落拼接，不读取磁盘，不依赖 core、DOM 或 benchmark 逻辑。
 * 协作模块：benchmarks、visual baseline 校验、vanilla demo 和 Node 测试。
 * 约束：不做扩页、不注入额外文案、不改变段落顺序。
 */

export function splitGate2FixtureParagraphs(text) {
  const normalized = text.replace(/\r\n?/gu, '\n').trim()

  if (normalized.length === 0) {
    return []
  }

  return normalized
    .split('\n')
    .filter((line) => line.trim().length > 0)
}

export function createGate2FixtureEditorText(text) {
  return splitGate2FixtureParagraphs(text).join('\n\n')
}
