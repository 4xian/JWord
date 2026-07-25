/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 页面配置、纸张预设、方向、边距、缩放和 twip/CSS px 换算。
 * 边界：只测试纯数据页面配置，不覆盖布局、渲染、输入或 DOM。
 * 协作模块：layout 后续消费 页面配置，渲染器后续只使用换算后的页面尺寸。
 * 约束：测试不访问浏览器环境，不写磁盘，不依赖外部字体。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  CSS_PX_PER_INCH,
  TWIPS_PER_INCH,
  createPageConfig,
  cssPxToTwips,
  twipsToCssPx
} from '../../src/layout/page-config'

describe('Gate 2 page config', () => {
  it('creates A4 portrait config with margins and scaled CSS size', () => {
    const config = createPageConfig({
      preset: 'a4',
      orientation: 'portrait',
      marginTwips: {
        top: 1440,
        right: 720,
        bottom: 1440,
        left: 720
      },
      scale: 1.5
    })

    expect(config.widthTwips).toBe(11906)
    expect(config.heightTwips).toBe(16838)
    expect(config.contentWidthTwips).toBe(10466)
    expect(config.contentHeightTwips).toBe(13958)
    expect(config.widthCssPx).toBeCloseTo(twipsToCssPx(11906, 1.5), 5)
    expect(config.marginCssPx.left).toBeCloseTo(72, 5)
  })

  it('swaps Letter dimensions in landscape orientation', () => {
    const config = createPageConfig({
      preset: 'letter',
      orientation: 'landscape',
      marginTwips: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      }
    })

    expect(config.widthTwips).toBe(15840)
    expect(config.heightTwips).toBe(12240)
    expect(config.contentWidthTwips).toBe(15840)
    expect(config.contentHeightTwips).toBe(12240)
  })

  it('supports A3 and A5 Word-compatible presets', () => {
    const a3 = createPageConfig({
      preset: 'a3'
    })
    const a5 = createPageConfig({
      preset: 'a5'
    })

    expect(a3.widthTwips).toBe(16838)
    expect(a3.heightTwips).toBe(23811)
    expect(a5.widthTwips).toBe(8391)
    expect(a5.heightTwips).toBe(11906)
  })

  it('supports B5, Legal and common envelope presets', () => {
    expect(createPageConfig({ preset: 'b5' }).widthTwips).toBe(9978)
    expect(createPageConfig({ preset: 'b5' }).heightTwips).toBe(14173)
    expect(createPageConfig({ preset: 'legal' }).widthTwips).toBe(12240)
    expect(createPageConfig({ preset: 'legal' }).heightTwips).toBe(20160)
    expect(createPageConfig({ preset: 'envelope5' }).widthTwips).toBe(6236)
    expect(createPageConfig({ preset: 'envelope5' }).heightTwips).toBe(12472)
    expect(createPageConfig({ preset: 'envelope9' }).widthTwips).toBe(12983)
    expect(createPageConfig({ preset: 'envelope9' }).heightTwips).toBe(18369)
  })

  it('converts twip and CSS px with stable Word units', () => {
    expect(TWIPS_PER_INCH).toBe(1440)
    expect(CSS_PX_PER_INCH).toBe(96)
    expect(twipsToCssPx(1440)).toBe(96)
    expect(cssPxToTwips(96)).toBe(1440)
  })
})
