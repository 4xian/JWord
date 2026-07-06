/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 超大文件拆分专项的机器验收条件。
 * 边界：只检查已进入拆分执行的文件，不替代 package 级行为测试。
 * 协作模块：remediation plan Phase 5 清单、packages/ui/src/create-ui.ts、packages/core/src/operations/command-builders.ts、packages/core/src/editor/text-editing-runtime.ts、packages/core/src/operations/operation-adapter.ts、packages/ui/src/toolbar/controller.ts、packages/core/src/model/document-store.ts、packages/native/src/index.ts、packages/core/src/layout/engine.ts、packages/ui/src/media/image-selection-controller.ts、packages/ui/src/selection-actions/controller.ts、packages/ui/src/table/controller.ts、packages/core/test/editor/input-runtime.test.ts、packages/core/test/layout/runtime.test.ts、packages/core/test/editor/facade-runtime.test.ts、examples/vanilla/tests/gate3-toolbar.e2e.ts、examples/vanilla/tests/gate3-input.e2e.ts 与拆分后的内部模块。
 * 约束：拆分批次只允许收敛文件体量和目标结构，公开导出面保持不变。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const createUiTargetFiles = [
  'packages/ui/src/toolbar-setup.ts',
  'packages/ui/src/media-setup.ts',
  'packages/ui/src/table-setup.ts',
  'packages/ui/src/comments-rail.ts',
  'packages/ui/src/link-overlay.ts',
  'packages/ui/src/heading-outline-setup.ts',
  'packages/ui/src/ui-lifecycle.ts'
] as const

const createUiEntryPath = 'packages/ui/src/create-ui.ts'
const createUiMaxLines = 400
const commandBuildersTargetFiles = [
  'packages/core/src/operations/text-commands.ts',
  'packages/core/src/operations/paragraph-commands.ts',
  'packages/core/src/operations/resource-commands.ts',
  'packages/core/src/operations/comment-commands.ts',
  'packages/core/src/operations/link-commands.ts',
  'packages/core/src/operations/image-commands.ts',
  'packages/core/src/operations/table-commands.ts'
] as const
const commandBuildersEntryPath = 'packages/core/src/operations/command-builders.ts'
const commandBuildersMaxLines = 400
const textEditingRuntimeTargetFiles = [
  'packages/core/src/editor/keyboard-editing.ts',
  'packages/core/src/editor/delete-plan.ts',
  'packages/core/src/editor/paragraph-split.ts',
  'packages/core/src/editor/paste-plan.ts',
  'packages/core/src/editor/rich-text-fragment.ts',
  'packages/core/src/editor/runtime-selection.ts'
] as const
const textEditingRuntimeEntryPath = 'packages/core/src/editor/text-editing-runtime.ts'
const textEditingRuntimeMaxLines = 400
const operationAdapterTargetFiles = [
  'packages/core/src/operations/resource-adapter.ts',
  'packages/core/src/operations/comment-adapter.ts',
  'packages/core/src/operations/revision-adapter.ts',
  'packages/core/src/operations/text-adapter.ts',
  'packages/core/src/operations/block-adapter.ts',
  'packages/core/src/operations/image-adapter.ts',
  'packages/core/src/operations/table-adapter.ts',
  'packages/core/src/operations/adapter-location.ts'
] as const
const operationAdapterEntryPath = 'packages/core/src/operations/operation-adapter.ts'
const operationAdapterMaxLines = 400
const toolbarControllerTargetFiles = [
  'packages/ui/src/toolbar/format-controls.ts',
  'packages/ui/src/toolbar/paragraph-controls.ts',
  'packages/ui/src/toolbar/insert-controls.ts',
  'packages/ui/src/toolbar/panel-lifecycle.ts',
  'packages/ui/src/toolbar/toolbar-state-sync.ts'
] as const
const toolbarControllerEntryPath = 'packages/ui/src/toolbar/controller.ts'
const toolbarControllerMaxLines = 400
const documentStoreTargetFiles = [
  'packages/core/src/model/store-types.ts',
  'packages/core/src/model/store-schema.ts',
  'packages/core/src/model/store-record-factories.ts',
  'packages/core/src/model/store-json.ts',
  'packages/core/src/model/store-comments.ts',
  'packages/core/src/model/store-revisions.ts'
] as const
const documentStoreEntryPath = 'packages/core/src/model/document-store.ts'
const documentStoreMaxLines = 400
const nativeIndexTargetFiles = [
  'packages/native/src/package-codec.ts',
  'packages/native/src/package-readers.ts',
  'packages/native/src/package-validation.ts',
  'packages/native/src/schema-migrations.ts',
  'packages/native/src/diagnostics.ts',
  'packages/native/src/progress.ts'
] as const
const nativeIndexEntryPath = 'packages/native/src/index.ts'
const nativeIndexMaxLines = 400
const layoutEngineTargetFiles = [
  'packages/core/src/layout/inline-layout.ts',
  'packages/core/src/layout/table-layout.ts',
  'packages/core/src/layout/pagination-flow.ts',
  'packages/core/src/layout/layout-anchors.ts'
] as const
const layoutEngineEntryPath = 'packages/core/src/layout/engine.ts'
const layoutEngineMaxLines = 400
const imageSelectionControllerTargetFiles = [
  'packages/ui/src/media/image-selection-dom.ts',
  'packages/ui/src/media/image-overlay-geometry.ts',
  'packages/ui/src/media/image-resize-session.ts',
  'packages/ui/src/media/image-drag-drop.ts'
] as const
const imageSelectionControllerEntryPath = 'packages/ui/src/media/image-selection-controller.ts'
const imageSelectionControllerMaxLines = 400
const selectionActionsControllerTargetFiles = [
  'packages/ui/src/selection-actions/commands.ts',
  'packages/ui/src/selection-actions/clipboard.ts',
  'packages/ui/src/selection-actions/geometry.ts',
  'packages/ui/src/selection-actions/native-clipboard.ts'
] as const
const selectionActionsControllerEntryPath = 'packages/ui/src/selection-actions/controller.ts'
const selectionActionsControllerMaxLines = 400
const tableControllerTargetFiles = [
  'packages/ui/src/table/table-selection.ts',
  'packages/ui/src/table/table-actions.ts',
  'packages/ui/src/table/table-resize.ts',
  'packages/ui/src/table/table-state-sync.ts'
] as const
const tableControllerEntryPath = 'packages/ui/src/table/controller.ts'
const tableControllerMaxLines = 400
const inputRuntimeTestTargetFiles = [
  'packages/core/test/editor/input-runtime-keyboard.test.ts',
  'packages/core/test/editor/input-runtime-clipboard.test.ts',
  'packages/core/test/editor/input-runtime-composition.test.ts',
  'packages/core/test/editor/input-runtime-pointer.test.ts',
  'packages/core/test/editor/input-runtime-image.test.ts',
  'packages/core/test/editor/input-runtime-errors.test.ts',
  'packages/core/test/editor/editor-test-helpers.ts'
] as const
const inputRuntimeTestEntryPath = 'packages/core/test/editor/input-runtime.test.ts'
const inputRuntimeTestMaxLines = 400
const layoutRuntimeTestTargetFiles = [
  'packages/core/test/layout/runtime-pagination.test.ts',
  'packages/core/test/layout/runtime-wrapping.test.ts',
  'packages/core/test/layout/runtime-table.test.ts',
  'packages/core/test/layout/runtime-debug.test.ts',
  'packages/core/test/layout/runtime-test-helpers.ts'
] as const
const layoutRuntimeTestEntryPath = 'packages/core/test/layout/runtime.test.ts'
const layoutRuntimeTestMaxLines = 400
const facadeRuntimeTestTargetFiles = [
  'packages/core/test/editor/facade-document.test.ts',
  'packages/core/test/editor/facade-command.test.ts',
  'packages/core/test/editor/facade-history.test.ts',
  'packages/core/test/editor/facade-load-replace.test.ts',
  'packages/core/test/editor/facade-test-helpers.ts'
] as const
const facadeRuntimeTestEntryPath = 'packages/core/test/editor/facade-runtime.test.ts'
const facadeRuntimeTestMaxLines = 400
const gate3ToolbarE2eTargetFiles = [
  'examples/vanilla/tests/gate3-toolbar-format.e2e.ts',
  'examples/vanilla/tests/gate3-toolbar-paragraph.e2e.ts',
  'examples/vanilla/tests/gate3-toolbar-insert.e2e.ts',
  'examples/vanilla/tests/gate3-toolbar-panels.e2e.ts',
  'examples/vanilla/tests/gate3-toolbar-helpers.ts'
] as const
const gate3ToolbarE2eEntryPath = 'examples/vanilla/tests/gate3-toolbar.e2e.ts'
const gate3ToolbarE2eMaxLines = 400
const gate3InputE2eTargetFiles = [
  'examples/vanilla/tests/gate3-input-keyboard.e2e.ts',
  'examples/vanilla/tests/gate3-input-selection.e2e.ts',
  'examples/vanilla/tests/gate3-input-clipboard.e2e.ts',
  'examples/vanilla/tests/gate3-input-composition.e2e.ts',
  'examples/vanilla/tests/gate3-input-large-fixture.e2e.ts',
  'examples/vanilla/tests/gate3-input-helpers.ts'
] as const
const gate3InputE2eEntryPath = 'examples/vanilla/tests/gate3-input.e2e.ts'
const gate3InputE2eMaxLines = 400

describe('Phase 5 file split targets', () => {
  it('keeps create-ui as a small assembly entry and materializes S1 modules', () => {
    const missingFiles = createUiTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(createUiEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(createUiMaxLines)
  })

  it('keeps command-builders as a small re-export entry and materializes S2 modules', () => {
    const missingFiles = commandBuildersTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(commandBuildersEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(commandBuildersMaxLines)
  })

  it('keeps text-editing-runtime as a small facade and materializes S3 modules', () => {
    const missingFiles = textEditingRuntimeTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(textEditingRuntimeEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(textEditingRuntimeMaxLines)
  })

  it('keeps operation-adapter as a small dispatcher and materializes S4 modules', () => {
    const missingFiles = operationAdapterTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(operationAdapterEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(operationAdapterMaxLines)
  })

  it('keeps toolbar controller as a lifecycle entry and materializes S5 modules', () => {
    const missingFiles = toolbarControllerTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(toolbarControllerEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(toolbarControllerMaxLines)
  })

  it('keeps document-store as a public export entry and materializes S6 modules', () => {
    const missingFiles = documentStoreTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(documentStoreEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(documentStoreMaxLines)
  })

  it('keeps native index as a public API entry and materializes S7 modules', () => {
    const missingFiles = nativeIndexTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(nativeIndexEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(nativeIndexMaxLines)
  })

  it('keeps layout engine as a small orchestration entry and materializes S8 modules', () => {
    const missingFiles = layoutEngineTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(layoutEngineEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(layoutEngineMaxLines)
  })

  it('keeps image selection controller as a small assembly entry and materializes S9 modules', () => {
    const missingFiles = imageSelectionControllerTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(imageSelectionControllerEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(imageSelectionControllerMaxLines)
  })

  it('keeps selection actions controller as an event entry and materializes S10 modules', () => {
    const missingFiles = selectionActionsControllerTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(selectionActionsControllerEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(selectionActionsControllerMaxLines)
  })

  it('keeps table controller as a lifecycle entry and materializes S11 modules', () => {
    const missingFiles = tableControllerTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(tableControllerEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(tableControllerMaxLines)
  })

  it('splits input-runtime tests by input path and materializes T1 modules', () => {
    const missingFiles = inputRuntimeTestTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(inputRuntimeTestEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(inputRuntimeTestMaxLines)
  })

  it('splits layout runtime tests by layout concern and materializes T2 modules', () => {
    const missingFiles = layoutRuntimeTestTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(layoutRuntimeTestEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(layoutRuntimeTestMaxLines)
  })

  it('splits facade runtime tests by facade concern and materializes T3 modules', () => {
    const missingFiles = facadeRuntimeTestTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(facadeRuntimeTestEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(facadeRuntimeTestMaxLines)
  })

  it('splits gate3 toolbar e2e tests by user path and materializes T4 modules', () => {
    const missingFiles = gate3ToolbarE2eTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(gate3ToolbarE2eEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(gate3ToolbarE2eMaxLines)
  })

  it('splits gate3 input e2e tests by input path and materializes T5 modules', () => {
    const missingFiles = gate3InputE2eTargetFiles.filter((path) => !existsSync(path))
    const lineCount = readLineCount(gate3InputE2eEntryPath)

    expect(missingFiles).toEqual([])
    expect(lineCount).toBeLessThanOrEqual(gate3InputE2eMaxLines)
  })
})

/** 读取文件行数，空文件稳定计为 0 行。 */
function readLineCount(path: string): number {
  const source = readFileSync(path, 'utf8')

  return source.length === 0 ? 0 : source.split('\n').length
}
