/**
 * @vitest-environment node
 *
 * 职责：防止表格、媒体、粘贴和页眉页脚 controller 新增未经过 i18n 的用户播报文案。
 * 边界：只检查稳定的 announce/message 入口，不扫描注释、测试、debug 日志或 sanitizer 诊断文本。
 * 协作模块：packages/ui/src/i18n.ts 与第 4 批功能域 controller 共同满足本门禁。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { JWORD_UI_BUILTIN_I18N_DICTIONARIES } from '../../packages/ui/src/i18n'

const userMessageSources = [
  'packages/ui/src/table/controller.ts',
  'packages/ui/src/table/table-actions.ts',
  'packages/ui/src/table/core-command-adapter.ts',
  'packages/ui/src/media/controller.ts',
  'packages/ui/src/media/core-command-adapter.ts',
  'packages/ui/src/paste/controller.ts',
  'packages/ui/src/header-footer/controller.ts'
] as const

describe('UI i18n user-message guard', () => {
  it('does not add direct Chinese literals to user announcement entry points', () => {
    const violations = userMessageSources.flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n')

      return lines.flatMap((line, index) => {
        if (!/announce\(\s*['"`][^'"`]*[\u4e00-\u9fff]/u.test(line)
          && !/message:\s*['"`][^'"`]*[\u4e00-\u9fff]/u.test(line)) {
          return []
        }

        return [`${path}:${index + 1}`]
      })
    })

    expect(violations).toEqual([])
  })

  it('keeps the migrated feature-domain keys aligned in Chinese and English', () => {
    const prefixes = [
      'a11y.table.',
      'a11y.media.',
      'a11y.paste.',
      'a11y.headerFooter.'
    ] as const
    const zhKeys = Object.keys(JWORD_UI_BUILTIN_I18N_DICTIONARIES['zh-CN'])
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .sort()
    const enKeys = Object.keys(JWORD_UI_BUILTIN_I18N_DICTIONARIES['en-US'])
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .sort()

    expect(enKeys).toEqual(zhKeys)
  })
})
