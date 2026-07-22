/**
 * 职责：执行 Gate 7 no-alias 第三方空项目消费 smoke。
 * 边界：只从当前 workspace 打包全部可发布包并安装本地 tarball，不读取 examples 源码 alias，不发布包。
 * 协作模块：核心包、界面包、原生格式包、商业格式包、授权包、持久化包、协作客户端和协作服务端。
 * 约束：smoke 必须覆盖 typecheck、Vite build 和 Chromium 浏览器路径，并同时触达免费基础路径与付费 PDF 授权路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN } from '../../fixtures/license/insecure-test-only-jwl1-fixture.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const workspacePackages = [
  {
    name: '@4xian/jword-core',
    dir: 'packages/core',
    forbiddenPackPrefixes: ['src/']
  },
  {
    name: '@4xian/jword-ui',
    dir: 'packages/ui',
    forbiddenPackPrefixes: ['src/'],
    requiredPackFiles: ['dist/styles/toolbar.css']
  },
  {
    name: '@4xian/jword-native',
    dir: 'packages/native'
  },
  {
    name: '@4xian/jword-license',
    dir: 'packages/license'
  },
  {
    name: '@4xian/jword-docx',
    dir: 'packages/docx'
  },
  {
    name: '@4xian/jword-pdf',
    dir: 'packages/pdf'
  },
  {
    name: '@4xian/jword-persistence',
    dir: 'packages/persistence'
  },
  {
    name: '@4xian/jword-collab',
    dir: 'packages/collab'
  },
  {
    name: '@4xian/jword-collab-server',
    dir: 'packages/collab-server'
  },
  {
    name: '@4xian/jword-react',
    dir: 'packages/react'
  },
  {
    name: '@4xian/jword-vue',
    dir: 'packages/vue'
  },
  {
    name: '@4xian/jword-devtools',
    dir: 'packages/devtools'
  }
]
const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const workspaceDir = mkdtempSync(join(tmpdir(), 'jword-gate7-third-party-smoke-'))
const packDir = join(workspaceDir, 'packs')
const projectDir = join(workspaceDir, 'empty-project')

/** 打包全部 Gate 7 已实现包，并校验 tarball 没有 workspace 协议和已知发布边界问题。 */
function packWorkspacePackages(packDir) {
  mkdirSync(packDir, { recursive: true })
  const packs = {}

  for (const workspacePackage of workspacePackages) {
    const before = new Set(readPackFiles(packDir))

    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: join(repoRoot, workspacePackage.dir),
      stdio: 'pipe'
    })

    const created = readPackFiles(packDir).find((file) => !before.has(file))

    if (created === undefined) {
      throw new Error(`Missing npm pack artifact for ${workspacePackage.name}.`)
    }

    const packPath = join(packDir, created)
    packs[workspacePackage.name] = packPath
    assertPackManifest(workspacePackage, packPath)
  }

  return packs
}

/** 读取 pack 目录下已有 tgz 文件。 */
function readPackFiles(packDir) {
  return readdirSync(packDir).filter((file) => file.endsWith('.tgz')).sort()
}

/** 校验 tarball manifest 和文件清单符合 no-alias 外部消费预期。 */
function assertPackManifest(workspacePackage, packPath) {
  const manifest = execFileSync('tar', ['-xOf', packPath, 'package/package.json'], {
    encoding: 'utf8'
  })
  const files = readTarballFiles(packPath)

  if (manifest.includes('workspace:*')) {
    throw new Error(`${workspacePackage.name} pack still contains workspace:* and cannot be installed from an empty project.`)
  }

  for (const requiredFile of workspacePackage.requiredPackFiles ?? []) {
    if (!files.includes(requiredFile)) {
      throw new Error(`${workspacePackage.name} pack is missing ${requiredFile}.`)
    }
  }

  for (const forbiddenPrefix of workspacePackage.forbiddenPackPrefixes ?? []) {
    const leaked = files.filter((file) => file.startsWith(forbiddenPrefix))

    if (leaked.length > 0) {
      throw new Error(`${workspacePackage.name} pack leaks forbidden files: ${leaked.join(', ')}`)
    }
  }
}

/** 读取 tarball 内 package/ 前缀后的文件清单。 */
function readTarballFiles(packPath) {
  return execFileSync('tar', ['-tf', packPath], {
    encoding: 'utf8'
  })
    .split('\n')
    .map((entry) => entry.replace(/^package\//u, ''))
    .filter(Boolean)
    .sort()
}

/** 写入空项目 package.json，并用 overrides 让 workspace 传递依赖也解析到本地 tarball。 */
function writeEmptyProject(projectDir, packs) {
  mkdirSync(projectDir, { recursive: true })
  const dependencies = Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    `file:../packs/${basename(packPath)}`
  ]))
  const packageJson = {
    private: true,
    type: 'module',
    name: 'gate7-third-party-smoke',
    scripts: {
      typecheck: 'tsc -p tsconfig.json --noEmit',
      build: 'vite build',
      e2e: 'playwright test --project=chromium'
    },
    dependencies,
    devDependencies: {
      '@playwright/test': readRootDevDependencyVersion('@playwright/test'),
      '@types/node': readRootDevDependencyVersion('@types/node'),
      '@types/react': readRootDevDependencyVersion('@types/react'),
      '@types/react-dom': readRootDevDependencyVersion('@types/react-dom'),
      react: readRootDevDependencyVersion('react'),
      'react-dom': readRootDevDependencyVersion('react-dom'),
      typescript: readRootDevDependencyVersion('typescript'),
      vite: readRootDevDependencyVersion('vite'),
      vue: readRootDevDependencyVersion('vue')
    }
  }

  writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), createPnpmWorkspaceYaml(dependencies))
}

/** 读取根项目中已锁定的开发依赖精确版本。 */
function readRootDevDependencyVersion(name) {
  const version = rootPackageJson.devDependencies?.[name]

  if (typeof version !== 'string' || version.startsWith('^') || version.startsWith('~')) {
    throw new Error(`Root devDependency ${name} must use an exact version.`)
  }

  return version
}

/** 写入 pnpm v10+ 仍会读取的本地 tarball override 配置。 */
function createPnpmWorkspaceYaml(dependencies) {
  const overrides = Object.entries(dependencies)
    .map(([name, specifier]) => `  '${name}': '${specifier}'`)
    .join('\n')

  return `packages: []\noverrides:\n${overrides}\n`
}

/** 写入只通过 package export map 消费 SDK 的第三方测试项目。 */
function writeSmokeProject(projectDir) {
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'tsconfig.json'), tsconfigSource)
  writeFileSync(join(projectDir, 'index.html'), indexHtmlSource)
  writeFileSync(join(projectDir, 'src', 'vite-env.d.ts'), viteEnvSource)
  writeFileSync(join(projectDir, 'src', 'main.ts'), browserEntrySource)
  writeFileSync(join(projectDir, 'src', 'type-smoke.ts'), typeSmokeSource)
  writeFileSync(join(projectDir, 'playwright.config.ts'), playwrightConfigSource)
  writeFileSync(join(projectDir, 'browser-smoke.spec.ts'), browserSmokeSpecSource)
}

/** 安装空项目依赖，确保 tarball 能脱离 monorepo alias 解析。 */
function installEmptyProject(projectDir) {
  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

/** 执行 TypeScript 类型检查。 */
function runTypecheck(projectDir) {
  execFileSync('pnpm', ['run', 'typecheck'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

/** 执行 Vite production build，验证 export map、CSS 产物和依赖打包路径。 */
function runViteBuild(projectDir) {
  execFileSync('pnpm', ['run', 'build'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

/** 获取当前 smoke 进程使用的动态空闲端口。 */
async function findAvailablePort() {
  const server = createServer()

  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a TCP port for the Gate 7 smoke.'))
        return
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

/** 执行 Chromium 浏览器 smoke。 */
async function runChromiumSmoke(projectDir) {
  const port = await findAvailablePort()

  execFileSync('pnpm', ['run', 'e2e'], {
    cwd: projectDir,
    env: {
      ...process.env,
      JWORD_GATE7_SMOKE_PORT: String(port)
    },
    stdio: 'inherit'
  })
}

/** 断言包解析位置来自临时项目安装产物，而非当前 monorepo 源码。 */
function assertNoRepoAlias(projectDir) {
  const resolved = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "console.log(await import.meta.resolve('@4xian/jword-core'))"
  ], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()

  if (resolved.includes(repoRoot)) {
    throw new Error(`External project resolved @4xian/jword-core through repo alias: ${resolved}`)
  }
}

const tsconfigSource = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    skipLibCheck: true,
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    types: ['@playwright/test', 'node']
  },
  include: ['src/**/*.ts', 'browser-smoke.spec.ts', 'playwright.config.ts']
}, null, 2)}\n`

const indexHtmlSource = String.raw`<html>
  <head>
    <title>Gate 7 no-alias smoke</title>
  </head>
  <body>
    <div id="root" data-status="booting">Gate 7 smoke booting</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`

const viteEnvSource = String.raw`declare module '*.css'
`

const browserEntrySource = String.raw`import '@4xian/jword-ui/styles.css'

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import {
  GATE5_FORMAT_FEATURES
} from '@4xian/jword-license'
import {
  exportPdfFromLayout
} from '@4xian/jword-pdf'

const INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN = ${JSON.stringify(INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN)}

const projection = {
  document: {
    kind: 'document' as const,
    id: 'gate7-third-party-document',
    sections: [
      {
        kind: 'section' as const,
        id: 'section-1',
        blocks: [
          {
            kind: 'paragraph' as const,
            id: 'paragraph-1',
            runs: [
              {
                kind: 'run' as const,
                id: 'run-1',
                inlines: [
                  {
                    kind: 'text' as const,
                    text: 'Gate 7 browser smoke'
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
const layout = layoutDocument({
  projection,
  pageConfig: createPageConfig(),
  fontManager: createFontManager()
})
const exportedPdf = await exportPdfFromLayout(layout, {
  requestId: 'gate7-third-party-browser-pdf',
  license: createGate5License([GATE5_FORMAT_FEATURES.pdfExport])
})
const root = document.querySelector<HTMLDivElement>('#root')

if (root === null) {
  throw new Error('Missing smoke root element.')
}

root.dataset.status = 'ok'
root.dataset.freePath = String(layout.pages.length >= 0)
root.dataset.paidPath = String(exportedPdf.bytes.byteLength > 0)
root.textContent = JSON.stringify({
  status: 'ok',
  freePath: 'layout',
  paidPath: 'pdf.export',
  pdfBytes: exportedPdf.bytes.byteLength
})

/** 创建覆盖 Gate 7 browser smoke 付费 PDF 路径的授权对象。 */
function createGate5License(features: readonly string[]) {
  const entitlement = {
    customerId: 'customer-gate7-third-party-smoke',
    licenseToken: 'license-gate7-third-party-smoke',
    issuer: 'jword-third-party-smoke',
    issuedAt: '2026-07-03T00:00:00Z',
    features,
    expiresAt: '2099-01-01T00:00:00Z',
    status: 'valid' as const
  }

  return {
    ...entitlement,
    signature: INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN
  }
}
`

const typeSmokeSource = String.raw`import {
  createEditor,
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import {
  createJWordUi
} from '@4xian/jword-ui'
import {
  JWordReactEditor
} from '@4xian/jword-react'
import {
  JWordVueEditor
} from '@4xian/jword-vue'
import {
  attachJWordDevtools
} from '@4xian/jword-devtools'
import {
  saveJWordDocument
} from '@4xian/jword-native'
import {
  exportDocx
} from '@4xian/jword-docx'
import {
  exportPdfFromLayout
} from '@4xian/jword-pdf'
import {
  createCancelPdfWorkerRequest
} from '@4xian/jword-pdf/worker'
import {
  GATE5_FORMAT_FEATURES,
  GATE6_COLLAB_FEATURES,
  assertJWordFeatureEntitled,
  createJWordLicenseError
} from '@4xian/jword-license'
import {
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
import {
  createJWordCollabServer,
  createJWordCollabHocuspocusServer
} from '@4xian/jword-collab-server'
import {
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'

const missingLicense = createJWordLicenseError('JWORD_LICENSE_MISSING', GATE5_FORMAT_FEATURES.pdfExport)

export const consumedApis = {
  createEditor,
  createFontManager,
  createPageConfig,
  layoutDocument,
  createJWordUi,
  JWordReactEditor,
  JWordVueEditor,
  attachJWordDevtools,
  saveJWordDocument,
  exportDocx,
  exportPdfFromLayout,
  createCancelPdfWorkerRequest,
  GATE5_FORMAT_FEATURES,
  GATE6_COLLAB_FEATURES,
  assertJWordFeatureEntitled,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  createJWordCollabServer,
  createJWordCollabHocuspocusServer,
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage,
  missingLicense
}
`

const playwrightConfigSource = String.raw`import { defineConfig, devices } from '@playwright/test'

/** 读取 smoke 主进程分配给全部 Playwright 进程的端口。 */
function readSmokePort(): number {
  const port = Number.parseInt(process.env.JWORD_GATE7_SMOKE_PORT ?? '', 10)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('JWORD_GATE7_SMOKE_PORT must be a valid TCP port.')
  }

  return port
}

const port = readSmokePort()
const baseURL = 'http://127.0.0.1:' + String(port)

export default defineConfig({
  testDir: '.',
  testMatch: ['browser-smoke.spec.ts'],
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port ' + String(port) + ' --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL
      }
    }
  ]
})
`

const browserSmokeSpecSource = String.raw`import { expect, test } from '@playwright/test'

test('loads JWord from tarball packages without monorepo alias', async ({ page }) => {
  await page.goto('/')
  const root = page.locator('#root')

  await expect(root).toHaveAttribute('data-status', 'ok')
  await expect(root).toHaveAttribute('data-free-path', 'true')
  await expect(root).toHaveAttribute('data-paid-path', 'true')
})
`

const packs = packWorkspacePackages(packDir)
writeEmptyProject(projectDir, packs)
writeSmokeProject(projectDir)
installEmptyProject(projectDir)
assertNoRepoAlias(projectDir)
runTypecheck(projectDir)
runViteBuild(projectDir)
await runChromiumSmoke(projectDir)

console.log(JSON.stringify({
  status: 'ok',
  name: 'gate7-third-party-smoke',
  installStatus: 'installed-from-local-packs',
  projectDir,
  packages: Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    relative(repoRoot, packPath)
  ]))
}, null, 2))
