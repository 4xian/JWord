import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const looseVersionPattern = /^[~^]/u
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const failures = []

function readPackageJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function listWorkspacePackageJsonFiles() {
  const files = ['package.json']

  for (const root of listWorkspaceRoots()) {
    const packageJsonFile = join(root, 'package.json')
    if (existsSync(packageJsonFile)) {
      files.push(packageJsonFile)
    }
  }

  return [...new Set(files)]
}

function listWorkspaceRoots() {
  const workspaceFile = 'pnpm-workspace.yaml'

  if (!existsSync(workspaceFile)) {
    return ['packages', 'examples', 'tools'].flatMap((root) => expandWorkspacePattern(`${root}/${'*'}`))
  }

  const workspaceSource = readFileSync(workspaceFile, 'utf8')
  const patterns = [...workspaceSource.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gmu)]
    .map((match) => match[1] ?? '')
    .filter((pattern) => pattern.length > 0)

  return [...new Set(patterns.flatMap((pattern) => expandWorkspacePattern(pattern)))]
}

function expandWorkspacePattern(pattern) {
  if (!pattern.includes('*')) {
    return existsSync(pattern) ? [pattern] : []
  }

  const [parent = '', rest = ''] = pattern.split('*')
  const normalizedParent = parent.endsWith('/') || parent.endsWith('\\')
    ? parent.slice(0, -1)
    : parent

  if (rest !== '' || !existsSync(normalizedParent)) {
    return []
  }

  return readdirSync(normalizedParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(normalizedParent, entry.name))
}

function readInternalPackageNames(packageFiles) {
  return new Set(packageFiles.flatMap((file) => {
    const packageJson = readPackageJson(file)

    return typeof packageJson.name === 'string' ? [packageJson.name] : []
  }))
}

function validateVersion(file, section, name, version, internalPackageNames) {
  const label = `${file} ${section}.${name}`

  if (typeof version !== 'string') {
    failures.push(`${label} 必须是字符串版本。`)
    return
  }

  if (internalPackageNames.has(name)) {
    if (!version.startsWith('workspace:')) {
      failures.push(`${label} 内部依赖必须使用 workspace: 协议：${version}`)
    }
    return
  }

  if (looseVersionPattern.test(version)) {
    failures.push(`${label} 使用宽松版本：${version}`)
    return
  }

  if (!semverPattern.test(version)) {
    failures.push(`${label} 必须使用精确 semver 版本：${version}`)
  }
}

function validateDependencySections(file, packageJson, internalPackageNames) {
  for (const section of dependencySections) {
    const dependencies = packageJson[section] ?? {}
    for (const [name, version] of Object.entries(dependencies)) {
      validateVersion(file, section, name, version, internalPackageNames)
    }
  }
}

function validatePnpmOverrides(file, packageJson) {
  const overrides = packageJson.pnpm?.overrides ?? {}

  for (const [name, version] of Object.entries(overrides)) {
    const label = `${file} pnpm.overrides.${name}`

    if (typeof version !== 'string') {
      failures.push(`${label} 必须是字符串版本。`)
      continue
    }

    if (looseVersionPattern.test(version)) {
      failures.push(`${label} 使用宽松版本：${version}`)
      continue
    }

    if (!semverPattern.test(version)) {
      failures.push(`${label} 必须使用精确 semver 版本：${version}`)
    }
  }
}

const packageFiles = listWorkspacePackageJsonFiles()
const internalPackageNames = readInternalPackageNames(packageFiles)

for (const file of packageFiles) {
  const packageJson = readPackageJson(file)

  if (file === 'package.json' && packageJson.packageManager !== 'pnpm@9.14.2') {
    failures.push('packageManager 必须保持 pnpm@9.14.2。')
  }

  validateDependencySections(file, packageJson, internalPackageNames)
  validatePnpmOverrides(file, packageJson)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('package 依赖版本检查通过。')
