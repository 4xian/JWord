/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 Step 7.9 Theme/i18n 的公开类型、CSS token 和无 grid/gap 样式约束。
 * 边界：只做源码与样式静态检查，不执行 UI runtime 或截图生成。
 * 协作模块：packages/ui 公开入口、主题/i18n contract、toolbar CSS 与 Gate 7 执行计划。
 * 约束：Theme/i18n 必须留在 UI 包轻量 contract，不引入 CSS-in-JS 或外部 i18n runtime。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const uiTypes = readFileSync('packages/ui/src/types.ts', 'utf8')
const uiIndex = readFileSync('packages/ui/src/index.ts', 'utf8')
const uiTheme = readFileSync('packages/ui/src/theme.ts', 'utf8')
const uiI18n = readFileSync('packages/ui/src/i18n.ts', 'utf8')
const toolbarCss = readFileSync('packages/ui/src/styles/toolbar.css', 'utf8')
const vanillaDemoMedia = readFileSync('examples/vanilla/tests/fixtures/test-media.ts', 'utf8')
const vanillaDemoTable = readFileSync('examples/vanilla/tests/fixtures/test-table.ts', 'utf8')

describe('Gate 7 theme and i18n contract', () => {
  it('exposes theme and i18n options from the public UI package entry', () => {
    for (const token of [
      'JWordUiThemeName',
      'JWordUiThemeToken',
      'JWordUiThemeOptions',
      'JWordUiI18nDictionary',
      'JWordUiI18nOptions',
      'JWordUiI18nKey'
    ]) {
      expect(uiTypes, token).toContain(token)
      expect(uiIndex, token).toContain(token)
    }

    expect(uiTypes).toContain('readonly theme?: JWordUiThemeOptions')
    expect(uiTypes).toContain('readonly i18n?: JWordUiI18nOptions')
    expect(uiIndex).toContain('DEFAULT_JWORD_UI_I18N_DICTIONARY')
    expect(uiIndex).toContain('DEFAULT_JWORD_UI_THEME_TOKENS')
  })

  it('defines first-party tokens and keeps theme application lightweight', () => {
    for (const token of [
      'colorSurface',
      'colorSurfaceMuted',
      'colorText',
      'colorTextMuted',
      'colorBorder',
      'colorAccent',
      'colorDanger',
      'radiusControl',
      'shadowOverlay',
      'focusRing'
    ]) {
      expect(uiTheme, token).toContain(token)
    }

    expect(uiTheme).toContain('data-theme')
    expect(uiTheme).not.toMatch(/i18next|styled-components|emotion/u)
  })

  it('defines default dictionary keys across toolbar, menu, dialog, a11y and diagnostics text', () => {
    for (const token of [
      'toolbar.format.bold.label',
      'toolbar.format.bold.tooltip',
      'menu.findReplace.title',
      'dialog.link.urlLabel',
      'a11y.blockedReadonly',
      'diagnostics.pluginAdapterFailed'
    ]) {
      expect(uiI18n, token).toContain(token)
    }
  })

  it('uses jw BEM classes, CSS custom properties and no grid/gap layout in the UI stylesheet', () => {
    expect(toolbarCss).toContain('.jw-root')
    expect(toolbarCss).toContain('--jw-color-surface')
    expect(toolbarCss).toContain('--jw-color-surface-muted')
    expect(toolbarCss).toContain('--jw-color-text')
    expect(toolbarCss).toContain('--jw-color-border')
    expect(toolbarCss).toContain('--jw-color-accent')
    expect(toolbarCss).toContain('--jw-focus-ring')
    expect(toolbarCss).toContain('[data-theme="dark"]')
    expect(toolbarCss).not.toContain('[data-theme="high-contrast"]')
    expect(toolbarCss).toMatch(/\.jw-[a-z0-9-]+(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?/u)
    expect(toolbarCss).not.toMatch(/\bdisplay\s*:\s*grid\b/u)
    expect(toolbarCss).not.toMatch(/\bgap\s*:/u)
  })

  it('keeps dark theme coverage and demo extension labels localizable', () => {
    for (const selector of [
      '.jw-toolbar__tooltip',
      '.jw-toolbar__color-wrap',
      '.jw-find-replace',
      '.jw-header-footer',
      ".jw-table-toolbar__preview-cell[data-jword-active='true']"
    ]) {
      expect(toolbarCss, selector).toContain(selector)
    }

    expect(toolbarCss).toMatch(/\[data-theme='dark'\]\s+\.jw-table-toolbar__preview-cell\[data-jword-active='true'\]\s*\{[^}]*border-color:\s*var\(--jw-color-accent\)[^}]*background:\s*var\(--jw-color-border-strong\)/u)

    expect(vanillaDemoMedia).not.toContain("title: '图片'")
    expect(vanillaDemoTable).not.toContain("title: '表格'")
  })
})
