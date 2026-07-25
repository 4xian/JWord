/**
 * @fileoverview 职责：用 axe-core 锁定 Gate 6 协作 demo 的远端光标和状态面板 a11y 验收。
 * 边界：只覆盖内存 runtime 的可见协作 UI，不启动真实 Hocuspocus 双端同步。
 * 协作：examples/collab/src/main.ts、tests/e2e/a11y-axe.ts 和 collab demo Vite 服务。
 * 约束：测试自启独立端口，避免依赖根 Playwright vanilla webServer。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { expectNoSeriousAxeViolations } from '../../../tests/e2e/a11y-axe'

const collabA11yDemoUrl = 'http://127.0.0.1:4195'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null

test.beforeAll(async () => {
  test.setTimeout(120000)
  serverProcess = spawn(viteExecutablePath, [
    '--host',
    '127.0.0.1',
    '--port',
    '4195',
    '--strictPort'
  ], {
    cwd: collabDemoDirectory,
    env: {
      ...process.env,
      VITE_CJS_TRACE: 'false'
    },
    stdio: 'ignore'
  })

  await waitForCollabA11yDemoServer()
})

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
})

test('Gate 6 协作光标和状态面板没有 serious/critical axe violation', async ({ page }) => {
  await page.goto(collabA11yDemoUrl)
  await waitForCollabA11yDemoReady(page)

  await expect(page.locator('[data-jword-remote-cursor]')).toHaveCount(2)
  await expectNoSeriousAxeViolations(page, {
    label: 'Gate 6 协作光标和状态面板',
    context: '[data-jword-collab-demo]'
  })
})

/** 等待 collab demo Vite 服务启动。 */
async function waitForCollabA11yDemoServer(): Promise<void> {
  const deadline = Date.now() + 120000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 1000)

    try {
      const response = await fetch(collabA11yDemoUrl, { signal: controller.signal })

      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
  }

  throw new Error(`collab a11y demo server did not start: ${String(lastError)}`)
}

/** 等待内存协作 runtime、远端光标和基础 editor 完成挂载。 */
async function waitForCollabA11yDemoReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-collab-demo]')).toBeVisible()
  await expect(page.locator('[data-jword-collab-status]')).toContainText('connected')
  await page.waitForFunction(() => window.__jwordCollabDemo !== undefined)
  await expect(page.locator('[data-jword-collab-editor] [data-jword-hidden-textarea]')).toHaveCount(1)
}
