import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const packagesRoot = 'packages'
const externalPrefixes = ['@4xian/', 'react', 'vue', 'yjs']

function readPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return null
  }
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
}

function discoverPackages() {
  if (!existsSync(packagesRoot)) {
    return []
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .map((packageDir) => {
      const packageJson = readPackageJson(packageDir)
      const input = join(packageDir, 'src', 'index.ts')
      if (!packageJson || !existsSync(input)) {
        return null
      }
      return {
        dir: packageDir,
        input,
        name: packageJson.name ?? relative('.', packageDir)
      }
    })
    .filter(Boolean)
}

function isExternal(id) {
  return externalPrefixes.some((prefix) => id === prefix || id.startsWith(prefix))
}

function createPackageConfig(pkg) {
  return {
    input: pkg.input,
    external: isExternal,
    plugins: [
      typescript({
        tsconfig: join(pkg.dir, 'tsconfig.json'),
        outDir: join(pkg.dir, 'dist'),
        declaration: true,
        declarationMap: true,
        declarationDir: join(pkg.dir, 'dist')
      }),
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs()
    ],
    output: {
      file: join(pkg.dir, 'dist', 'index.js'),
      format: 'es',
      sourcemap: true
    },
    treeshake: {
      moduleSideEffects: false
    }
  }
}

function createWorkerConfigs(pkg) {
  const workerEntry = join(pkg.dir, 'src', 'worker.ts')
  if (!existsSync(workerEntry)) {
    return []
  }
  return [
    {
      ...createPackageConfig({ ...pkg, input: workerEntry }),
      output: {
        file: join(pkg.dir, 'dist', 'worker.js'),
        format: 'es',
        sourcemap: true
      }
    }
  ]
}

const packages = discoverPackages()
const configs = packages.flatMap((pkg) => [createPackageConfig(pkg), ...createWorkerConfigs(pkg)])

export default configs
