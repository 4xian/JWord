/**
 * @fileoverview 职责: 配置 JWord E2E、IME、视觉和双窗口协同浏览器项目。
 * 边界: 只启动 vanilla demo 测试服务，不写具体测试用例。
 * 协作: examples/vanilla 和后续协同示例添加测试后复用此矩阵。
 * 约束: Chromium、Firefox、WebKit 都保留，视觉测试单独项目运行。
 * Specs: docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md。
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.e2e.ts', '**/*.visual.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm --filter @4xian/jword-example-vanilla dev',
    url: 'http://127.0.0.1:5173',
    cwd: 'examples/vanilla',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      testMatch: '**/*.e2e.ts',
      testIgnore: ['**/*.perf.e2e.ts'],
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      testMatch: '**/*.e2e.ts',
      testIgnore: ['**/*.perf.e2e.ts'],
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      testMatch: '**/*.e2e.ts',
      testIgnore: ['**/*.perf.e2e.ts'],
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'perf-chromium',
      testMatch: '**/*.perf.e2e.ts',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'ime-chromium',
      testMatch: '**/*.ime.e2e.ts',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'visual-chromium',
      testMatch: '**/*.visual.ts',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'collab-chromium',
      testMatch: '**/*.collab.e2e.ts',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
