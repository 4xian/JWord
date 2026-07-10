/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 T1 真实 DOCX fixture 能通过 import -> core -> export -> reimport roundtrip。
 * 边界：只读取 fixtures/docx/registry.json 中已可用的 T1 输入，不声明外部办公套件兼容性。
 * 协作模块：fixtures/docx、diffDocxRoundtrip 和 canonical Gate 5 Step 5.18-5.21 复用这里的真实证据。
 * 约束：roundtrip 必须保留 T1 核心结构和样式，不能只靠内存构造样例。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { diffDocxRoundtrip } from '../src/index'
import { createDocxPublicApiLicense } from './public-api-fixtures'

const t1RoundtripFixtureIds = [
  'docx-t1-run-styles',
  'docx-t1-paragraph-formatting',
  'docx-t1-headings',
  'docx-t1-lists',
  'docx-t1-table-basic',
  'docx-t1-inline-image',
  'docx-t1-page-setup'
] as const
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

describe('Gate 5 T1 DOCX roundtrip fixtures', () => {
  it.each(t1RoundtripFixtureIds)('roundtrips %s without warnings or T1 diffs', async (fixtureId) => {
    const fixture = readDocxFixture(fixtureId)
    const result = await diffDocxRoundtrip(readFileSync(join(repoRoot, fixture.input.path)), {
      requestId: `${fixtureId}-roundtrip-fixture`,
      license: createDocxPublicApiLicense(['docx.import', 'docx.export'])
    })

    expect(fixture.status).toBe('fixture-input-ready')
    expect(fixture.input.state).toBe('available')
    expect(result.importWarnings).toEqual([])
    expect(result.exportWarnings).toEqual([])
    expect(result.reimportWarnings).toEqual([])
    expect(result.differences).toEqual([])
    expect(result.matches).toBe(true)
  })
})

interface Gate5DocxRegistry {
  readonly fixtures: readonly Gate5DocxFixture[]
}

interface Gate5DocxFixture {
  readonly id: string
  readonly tier: string
  readonly status?: string
  readonly input: {
    readonly path: string
    readonly state?: string
  }
}

/** 读取指定 T1 DOCX fixture 的 registry 记录。 */
function readDocxFixture(fixtureId: string): Gate5DocxFixture {
  const registryPath = join(repoRoot, 'fixtures/docx/registry.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Gate5DocxRegistry
  const fixture = registry.fixtures.find((item) => item.id === fixtureId)

  if (fixture === undefined) {
    throw new Error(`Missing DOCX fixture registry entry: ${fixtureId}`)
  }

  expect(fixture.tier).toBe('T1')

  return fixture
}
