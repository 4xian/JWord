/**
 * 职责：补齐 Gate 5 PDF 字体嵌入当前使用的 fontkit 最小类型声明。
 * 边界：只声明 packages/pdf/src/index.ts 需要的 create、字体集合和 glyph 覆盖检测，不暴露 fontkit 完整 API。
 * 协作模块：PDF 字体覆盖检测、pdf-lib registerFontkit 和 Step 5.27 自定义字体嵌入路径。
 * 性能/安全约束：声明文件无运行时代码，不改变 fontkit 打包行为。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */

declare module 'fontkit' {
  export interface FontkitFont {
    hasGlyphForCodePoint(codePoint: number): boolean
  }

  export interface FontkitCollection {
    readonly fonts: readonly FontkitFont[]
  }

  export function create(input: Uint8Array): FontkitFont | FontkitCollection
}
