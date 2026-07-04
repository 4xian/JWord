/**
 * 职责：执行 Gate 5 商业格式包的第三方空项目安装 smoke。
 * 边界：只从当前 workspace 打包并安装公开包，再通过包名 import 运行最小 DOCX/PDF 授权路径。
 * 协作模块：packages/core、packages/license、packages/docx 和 packages/pdf。
 * 约束：smoke 项目必须从空目录安装 tarball，不读取 monorepo 源码路径、不发布包。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-538建立商业包发布检查。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const workspacePackages = [
  {
    name: '@4xian/jword-core',
    dir: 'packages/core'
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
  }
]

const workspaceDir = mkdtempSync(join(tmpdir(), 'jword-gate5-third-party-smoke-'))
const packDir = join(workspaceDir, 'packs')
const projectDir = join(workspaceDir, 'empty-project')

/** 打包 Gate 5 smoke 需要的 workspace 包。 */
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

    packs[workspacePackage.name] = join(packDir, created)
    assertPackManifest(workspacePackage.name, packs[workspacePackage.name])
  }

  return packs
}

/** 读取 pack 目录下已有 tgz 文件。 */
function readPackFiles(packDir) {
  return readdirSync(packDir).filter((file) => file.endsWith('.tgz')).sort()
}

/** 校验 pnpm pack 已把 workspace 协议改写为可安装版本。 */
function assertPackManifest(packageName, packPath) {
  const manifest = execFileSync('tar', ['-xOf', packPath, 'package/package.json'], {
    encoding: 'utf8'
  })

  if (manifest.includes('workspace:*')) {
    throw new Error(`${packageName} pack still contains workspace:* and cannot be installed from an empty project.`)
  }
}

/** 写入空项目 package.json，并用 overrides 让传递依赖也解析到本地 tarball。 */
function writeEmptyProject(projectDir, packs) {
  mkdirSync(projectDir, { recursive: true })
  const dependencies = Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    `file:../packs/${basename(packPath)}`
  ]))
  const packageJson = {
    private: true,
    type: 'module',
    name: 'gate5-third-party-smoke',
    scripts: {
      smoke: 'node smoke.mjs'
    },
    dependencies,
    pnpm: {
      overrides: dependencies
    }
  }

  writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

/** 在空项目内安装基础包和 Gate 5 商业包。 */
function installEmptyProject(projectDir) {
  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: projectDir,
    stdio: 'pipe'
  })
}

/** 写入只通过公开 API 运行的 Gate 5 smoke 程序。 */
function writeSmokeProgram(projectDir) {
  writeFileSync(join(projectDir, 'smoke.mjs'), smokeProgramSource)
}

/** 执行第三方 smoke 程序。 */
function runSmokeProgram(projectDir) {
  execFileSync('node', ['smoke.mjs'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

const smokeProgramSource = String.raw`
import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '@4xian/jword-core'
import {
  createInsecureTestOnlyJWordLicenseSignature,
  GATE5_FORMAT_FEATURES
} from '@4xian/jword-license'
import {
  exportDocx,
  importDocx
} from '@4xian/jword-docx'
import {
  exportPdfFromLayout
} from '@4xian/jword-pdf'

const INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED = 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A'

const projection = {
  document: {
    kind: 'document',
    id: 'gate5-third-party-document',
    sections: [
      {
        kind: 'section',
        id: 'section-1',
        blocks: [
          {
            kind: 'paragraph',
            id: 'paragraph-1',
            runs: [
              {
                kind: 'run',
                id: 'run-1',
                inlines: [
                  {
                    kind: 'text',
                    text: 'Gate 5 third-party smoke'
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
const docxExportLicense = createGate5License([GATE5_FORMAT_FEATURES.docxExport])
const docxImportLicense = createGate5License([GATE5_FORMAT_FEATURES.docxImport])
const pdfLicense = createGate5License([GATE5_FORMAT_FEATURES.pdfExport])

const exportedDocx = await exportDocx(projection, {
  requestId: 'gate5-third-party-docx-export',
  license: docxExportLicense
})

assert(exportedDocx.bytes.byteLength > 0, 'exportDocx should produce bytes.')

const importedDocx = await importDocx(exportedDocx.bytes, {
  requestId: 'gate5-third-party-docx-import',
  license: docxImportLicense
})

assert(importedDocx.document.sections.length === 1, 'importDocx should read the exported package.')

const layout = layoutDocument({
  projection,
  pageConfig: createPageConfig(),
  fontManager: createFontManager()
})
const exportedPdf = await exportPdfFromLayout(layout, {
  requestId: 'gate5-third-party-pdf-export',
  license: pdfLicense
})

assert(exportedPdf.bytes.byteLength > 0, 'exportPdfFromLayout should produce bytes.')

console.log(JSON.stringify({
  status: 'ok',
  docx: 'import-export',
  pdf: 'export',
  publicApiOnly: true
}))

/** 创建覆盖 Gate 5 smoke 路径的授权对象。 */
function createGate5License(features) {
  const entitlement = {
    customerId: 'customer-gate5-third-party-smoke',
    licenseToken: 'license-gate5-third-party-smoke',
    issuer: 'jword-third-party-smoke',
    issuedAt: '2026-05-01T00:00:00Z',
    features,
    expiresAt: '2099-01-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 断言 smoke 条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
`

const packs = packWorkspacePackages(packDir)
writeEmptyProject(projectDir, packs)
installEmptyProject(projectDir)
writeSmokeProgram(projectDir)
runSmokeProgram(projectDir)

console.log(JSON.stringify({
  status: 'ok',
  name: 'gate5-third-party-smoke',
  installStatus: 'installed-from-local-packs',
  projectDir,
  packages: Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    relative(repoRoot, packPath)
  ]))
}, null, 2))
