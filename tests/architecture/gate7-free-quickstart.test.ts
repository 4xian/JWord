/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 7 Step 7.4 免费基础版 quickstart 文档和可编译示例。
 * 边界：只读取 SDK 文档、类型 fixture 和类型测试配置，不运行浏览器或 SDK 运行时。
 * 协作模块：公开 API 清单、quickstart 文档、类型测试和原生保存打开 API 共同提供免费基础版接入证据。
 * 约束：quickstart 只能演示 core、ui、native 的 package 入口，不依赖 monorepo 内部路径、demo runtime 或高级付费包。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const publicApiCatalogPath = 'docs/sdk/public-api.md'
const quickstartPath = 'docs/sdk/quickstart.md'
const typeQuickstartPath = 'tests/types/gate7-free-quickstart.ts'
const typeTestTsconfigPath = 'tests/types/tsconfig.gate7-public-api.json'

const requiredQuickstartText = [
  'pnpm add @4xian/jword-core @4xian/jword-ui @4xian/jword-native',
  "from '@4xian/jword-core'",
  "from '@4xian/jword-ui'",
  "from '@4xian/jword-native'",
  'createJWord',
  'host',
  'jword.destroy()',
  'saveJWordDocument',
  'loadJWordDocument',
  '继续编辑',
  '基础错误处理',
  'requestId',
  'try',
  'catch'
]

const forbiddenQuickstartText = [
  'packages/',
  '/src/',
  "from '@4xian/jword-docx'",
  "from '@4xian/jword-pdf'",
  "from '@4xian/jword-collab'",
  "from '@4xian/jword-license'",
  "from 'yjs'",
  "from '@hocuspocus/server'",
  'editor.mount(',
  'createJWordUi({'
]

describe('Gate 7 free quickstart', () => {
  it('publishes a free base quickstart from package entrypoints only', () => {
    expect(existsSync(quickstartPath)).toBe(true)

    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const quickstart = readFileSync(quickstartPath, 'utf8')

    expect(catalog).toContain(quickstartPath)

    for (const requiredText of requiredQuickstartText) {
      expect(quickstart, requiredText).toContain(requiredText)
    }

    for (const forbiddenText of forbiddenQuickstartText) {
      expect(quickstart, forbiddenText).not.toContain(forbiddenText)
    }
  })

  it('keeps the quickstart backed by a compile-only type fixture', () => {
    expect(existsSync(typeQuickstartPath)).toBe(true)

    const fixture = readFileSync(typeQuickstartPath, 'utf8')
    const typeConfig = readFileSync(typeTestTsconfigPath, 'utf8')

    expect(typeConfig).toContain('./gate7-free-quickstart.ts')

    for (const requiredText of [
      "from '@4xian/jword-core'",
      "from '@4xian/jword-ui'",
      "from '@4xian/jword-native'",
      'createJWord',
      'JWordEditorShell',
      'saveJWordDocument',
      'loadJWordDocument',
      'continueEditingAfterOpen',
      'handleBasicError'
    ]) {
      expect(fixture, requiredText).toContain(requiredText)
    }

    for (const forbiddenText of forbiddenQuickstartText) {
      expect(fixture, forbiddenText).not.toContain(forbiddenText)
    }
  })
})
