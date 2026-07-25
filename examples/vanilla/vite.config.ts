/**
 * 职责：定义 vanilla demo 的模块解析策略，并生成 native ZIP runtime 构建期证据。
 * 边界：只处理 demo alias 与安全 module/chunk 摘要，不改变包本身的导出配置。
 * 协作：examples/vanilla package scripts、packages/native 和 tools/size/check-native-bundle.mjs。
 * 约束：evidence 只记录 package label、module count 和输出 chunk 名，不写绝对模块路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

export function createVanillaDemoViteConfig() {
  return {
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          'test-fixture': fileURLToPath(new URL('./test-fixture.html', import.meta.url))
        }
      }
    },
    plugins: [createNativeModuleEvidencePlugin('native-module-evidence.json')],
    resolve: {
      alias: [
        {
          find: '@4xian/jword-core',
          replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-ui/styles.css',
          replacement: fileURLToPath(new URL('../../packages/ui/src/styles/toolbar.css', import.meta.url))
        },
        {
          find: '@4xian/jword-native/worker',
          replacement: fileURLToPath(new URL('../../packages/native/src/worker.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-native',
          replacement: fileURLToPath(new URL('../../packages/native/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-devtools',
          replacement: fileURLToPath(new URL('../../packages/devtools/src/index.ts', import.meta.url))
        },
        {
          find: '@4xian/jword-ui',
          replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
        }
      ]
    },
    worker: {
      plugins: () => [createNativeModuleEvidencePlugin('native-worker-module-evidence.json')]
    }
  }
}

const nativeModulePackages = [
  {
    label: 'jszip',
    markers: ['/node_modules/jszip/', '/node_modules/.pnpm/jszip@']
  },
  {
    label: '@zip.js/zip.js',
    markers: ['/node_modules/@zip.js/zip.js/', '/node_modules/.pnpm/@zip.js+zip.js@']
  }
] as const

/** 创建仅在 build 阶段输出安全 native module evidence 的 Vite 插件。 */
function createNativeModuleEvidencePlugin(fileName: string): Plugin {
  return {
    name: 'native-module-evidence',
    apply: 'build' as const,
    /** 汇总两套 ZIP runtime 的模块数量和输出 chunk 名。 */
    generateBundle(_options, bundle) {
      const packages = Object.fromEntries(nativeModulePackages.map(({ label, markers }) => {
        const modules = new Set<string>()
        const chunks = new Set<string>()

        for (const output of Object.values(bundle)) {
          if (!isOutputChunk(output)) {
            continue
          }

          for (const moduleId of Object.keys(output.modules)) {
            const normalizedId = moduleId.replaceAll('\\', '/')

            if (markers.some((marker) => normalizedId.includes(marker))) {
              modules.add(normalizedId)
              chunks.add(output.fileName)
            }
          }
        }

        return [label, {
          moduleCount: modules.size,
          chunks: [...chunks].sort()
        }]
      }))

      this.emitFile({
        type: 'asset',
        fileName,
        source: `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`
      })
    }
  }
}

/** 判断 Rollup 输出是否为包含 module map 的 chunk。 */
function isOutputChunk(output: unknown): output is { readonly fileName: string, readonly modules: Record<string, unknown> } {
  if (typeof output !== 'object' || output === null) {
    return false
  }

  const record = output as Record<string, unknown>

  return record.type === 'chunk' &&
    typeof record.fileName === 'string' &&
    typeof record.modules === 'object' &&
    record.modules !== null
}

export default defineConfig(() => createVanillaDemoViteConfig())
