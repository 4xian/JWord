/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 7 插件错误隔离不会破坏 demo runtime。
 * 边界: 只覆盖 command 与 adapter 两条最小 smoke，不验证完整插件矩阵。
 * 协作: vanilla demo、core PluginHost、官方 toolbar 插件菜单和共享 toolbar 测试辅助函数。
 * 约束: 断言必须来自公开 editor facade 与真实 DOM，不读取 core 私有状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { expect, test } from '@playwright/test'

import {
  readOfficialToolbar,
  readPagePresetProbe,
  waitForDemoReady
} from './gate3-toolbar-helpers'

test('Gate 7 plugin command error is isolated in real browser runtime', async ({ page }) => {
  await page.goto('/test-fixture.html?pluginError=throwing-command')
  await waitForDemoReady(page)

  await page.evaluate(() => {
    window.__jwordTestFixture?.editor.executePluginCommand('demo.throwingPlugin.throw')
  })

  const diagnostics = await page.evaluate(() =>
    window.__jwordTestFixture?.editor.getPluginDiagnostics().map((diagnostic) => ({
      code: diagnostic.code,
      commandName: diagnostic.commandName,
      recoverable: diagnostic.recoverable
    })) ?? []
  )

  expect(diagnostics).toContainEqual({
    code: 'PLUGIN_CALLBACK_FAILED',
    commandName: 'demo.throwingPlugin.throw',
    recoverable: true
  })

  await chooseA5PagePreset(page)
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a5'
  })
})

test('Gate 7 plugin adapter error is isolated in real browser runtime', async ({ page }) => {
  await page.goto('/test-fixture.html?pluginError=throwing-adapter')
  await waitForDemoReady(page)

  await page.evaluate(() => {
    window.__jwordTestFixture?.editor.executePluginCommand('demo.throwingPlugin.adapter')
  })

  const diagnostics = await page.evaluate(() =>
    window.__jwordTestFixture?.editor.getPluginDiagnostics().map((diagnostic) => ({
      code: diagnostic.code,
      commandName: diagnostic.commandName,
      recoverable: diagnostic.recoverable
    })) ?? []
  )

  expect(diagnostics).toContainEqual({
    code: 'PLUGIN_IMPORT_REJECTED',
    commandName: 'demo.throwingPlugin.import',
    recoverable: true
  })

  await chooseA5PagePreset(page)
  await expect.poll(() => readPagePresetProbe(page)).toMatchObject({
    preset: 'a5'
  })
})

/** 通过官方插件菜单切换 A5 页面尺寸，证明错误后 UI 仍可操作。 */
async function chooseA5PagePreset(page: Parameters<typeof readOfficialToolbar>[0]): Promise<void> {
  const toolbar = readOfficialToolbar(page)
  const pluginMenu = toolbar.locator('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')
  const trigger = pluginMenu.locator('.jw-toolbar__select-trigger')
  const a5 = pluginMenu.locator('[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:a5"]')

  await trigger.click()
  await a5.click()
}
