/**
 * 职责：为根 pnpm bench 提供确定性的 Gate 0 benchmark 入口。
 * 边界：只测 fixture IO 和文本指标，不声称 layout 或 render 性能。
 * 协作模块：fixtures/plain-text/long-placeholder.txt 和后续 package benchmarks。
 * 性能/安全约束：只读取本地 fixture，并输出机器可读 JSON。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(currentDir, '../fixtures/plain-text/long-placeholder.txt')

const startedAt = performance.now()
const text = await readFile(fixturePath, 'utf8')
const elapsedMs = performance.now() - startedAt

const lines = text.split(/\r?\n/)
const words = text.trim().split(/\s+/).filter(Boolean)

const result = {
  benchmark: 'gate-0-fixture-smoke',
  fixture: 'fixtures/plain-text/long-placeholder.txt',
  bytes: Buffer.byteLength(text, 'utf8'),
  characters: text.length,
  lines: lines.length,
  words: words.length,
  readMs: Number(elapsedMs.toFixed(3))
}

console.log(JSON.stringify(result, null, 2))
