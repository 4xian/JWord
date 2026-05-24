/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 页眉页脚与页码 UI 的最小官方入口。
 * 边界：只覆盖 UI controller 到 core transaction 的接线，不测试分页渲染或复杂页眉编辑器。
 * 协作模块：页眉页脚控制器、核心分节命令构造器与编辑器门面。
 * 约束：通过稳定 data selector 交互，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.13。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createHeaderFooterController } from '../src/header-footer/controller'

describe('header footer controller', () => {
  test('点击下一页分节会通过 transaction pipeline 写入页眉页脚与重启页码配置', () => {
    const editor = createEditor({ initialText: '正文' })
    const host = document.createElement('div')
    const controller = createHeaderFooterController({
      editor,
      host
    })

    try {
      const headerInput = host.querySelector<HTMLInputElement>('[data-jword-header-id-input]')
      const footerInput = host.querySelector<HTMLInputElement>('[data-jword-footer-id-input]')
      const pageStartInput = host.querySelector<HTMLInputElement>('[data-jword-page-start-input]')
      const nextPageButton = host.querySelector<HTMLButtonElement>('[data-jword-section-break-next-page]')

      expect(headerInput).not.toBeNull()
      expect(footerInput).not.toBeNull()
      expect(pageStartInput).not.toBeNull()
      expect(nextPageButton).not.toBeNull()

      headerInput!.value = 'header-main'
      footerInput!.value = 'footer-main'
      pageStartInput!.value = '5'
      nextPageButton!.click()

      expect(editor.getProjection().document.sections[0]).toMatchObject({
        breakType: 'next-page',
        headerIds: ['header-main'],
        footerIds: ['footer-main'],
        pageNumbering: {
          mode: 'restart',
          start: 5
        }
      })
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('页眉、页脚与页码入口是独立紧凑下拉，并支持删除页码', () => {
    const editor = createEditor({ initialText: '正文' })
    const host = document.createElement('div')
    const controller = createHeaderFooterController({
      editor,
      host
    })

    try {
      expect(controller.elements.headerMenu.hidden).toBe(true)
      expect(controller.elements.footerMenu.hidden).toBe(true)
      expect(controller.elements.pageNumberMenu.hidden).toBe(true)

      expect(controller.elements.headerMenu.firstElementChild).toBe(controller.elements.headerInput)
      expect(controller.elements.footerMenu.firstElementChild).toBe(controller.elements.footerInput)
      expect(controller.elements.pageNumberMenu.firstElementChild).toBe(controller.elements.pageStartInput)
      expect(controller.elements.footerMenu.contains(controller.elements.footerNextPageButton)).toBe(true)
      expect(controller.elements.footerMenu.contains(controller.elements.footerContinuousButton)).toBe(true)

      controller.elements.headerTriggerButton.click()
      expect(controller.elements.headerMenu.hidden).toBe(false)
      expect(controller.elements.footerMenu.hidden).toBe(true)
      expect(controller.elements.pageNumberMenu.hidden).toBe(true)

      controller.elements.headerInput.value = 'header-main'
      controller.elements.addHeaderButton.click()
      expect(editor.getProjection().document.sections[0]?.headerIds).toEqual(['header-main'])

      controller.elements.footerTriggerButton.click()
      expect(controller.elements.headerMenu.hidden).toBe(true)
      expect(controller.elements.footerMenu.hidden).toBe(false)
      expect(controller.elements.pageNumberMenu.hidden).toBe(true)

      controller.elements.footerInput.value = 'footer-main'
      controller.elements.addFooterButton.click()
      expect(editor.getProjection().document.sections[0]?.footerIds).toEqual(['footer-main'])

      controller.elements.pageNumberTriggerButton.click()
      expect(controller.elements.headerMenu.hidden).toBe(true)
      expect(controller.elements.footerMenu.hidden).toBe(true)
      expect(controller.elements.pageNumberMenu.hidden).toBe(false)

      controller.elements.pageNumberTopLeftButton.click()
      expect(editor.getProjection().document.sections[0]?.pageNumbering).toMatchObject({
        mode: 'restart',
        start: 1
      })

      controller.elements.deletePageNumberButton.click()
      expect(editor.getProjection().document.sections[0]?.pageNumbering).toBeUndefined()
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('应用页码不会把页码 source id 回填到页眉页脚输入框', () => {
    const editor = createEditor({ initialText: '正文' })
    const host = document.createElement('div')
    const controller = createHeaderFooterController({
      editor,
      host
    })

    try {
      controller.elements.headerInput.value = '公司页眉'
      controller.elements.addHeaderButton.click()
      controller.elements.footerInput.value = '保密页脚'
      controller.elements.addFooterButton.click()

      controller.elements.pageNumberTopRightButton.click()

      expect(controller.elements.headerInput.value).toBe('公司页眉')
      expect(controller.elements.footerInput.value).toBe('保密页脚')
      expect(editor.getProjection().document.sections[0]?.headerIds).toEqual([
        '公司页眉',
        'page-number-top-right'
      ])
      expect(editor.getProjection().document.sections[0]?.footerIds).toEqual(['保密页脚'])

      controller.elements.deletePageNumberButton.click()

      expect(controller.elements.headerInput.value).toBe('公司页眉')
      expect(controller.elements.footerInput.value).toBe('保密页脚')
      expect(editor.getProjection().document.sections[0]?.headerIds).toEqual(['公司页眉'])
      expect(editor.getProjection().document.sections[0]?.footerIds).toEqual(['保密页脚'])
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })
})
