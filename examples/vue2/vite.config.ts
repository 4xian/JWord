/**
 * 职责：配置 Vue 2 示例的 Vite 开发与构建入口。
 * 边界：只声明示例 alias、Vue 2 SFC 插件与 ES2022 target，不改 SDK 包构建。
 * 协作：@vitejs/plugin-vue2、Vue 2、@4xian/jword-core、@4xian/jword-ui、@4xian/jword-native 与 Vite。
 * 约束：示例只消费 package 入口，不依赖 packages 内部源码深路径。
 */
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import vue2 from '@vitejs/plugin-vue2'

export default defineConfig({
  plugins: [vue2()],
  build: {
    target: 'es2022'
  },
  resolve: {
    alias: [
      {
        find: '@4xian/jword-ui/styles.css',
        replacement: fileURLToPath(new URL('../../packages/ui/src/styles/toolbar.css', import.meta.url))
      },
      {
        find: '@4xian/jword-core',
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))
      },
      {
        find: '@4xian/jword-ui',
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url))
      },
      {
        find: '@4xian/jword-native',
        replacement: fileURLToPath(new URL('../../packages/native/src/index.ts', import.meta.url))
      }
    ]
  }
})
