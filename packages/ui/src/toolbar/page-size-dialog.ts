/**
 * 职责：提供 toolbar 页面尺寸菜单的自定义宽高与页边距弹窗。
 * 边界：只创建 UI 包内部弹窗并调用 editor.setPageConfig，不扩展文档模型或插件协议。
 * 协作模块：plugin-extensions 在内部页面尺寸菜单中触发本弹窗，i18n 提供双语文案。
 * 性能/安全约束：弹窗只在用户点击自定义时创建，提交时做最小数值校验。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { TWIPS_PER_INCH, type Editor, type PageConfig } from '@4xian/jword-core'

import { readJWordUiText, type ResolvedJWordUiI18n } from '../i18n'

export const CUSTOM_PAGE_SIZE_COMMAND = 'jword.ui.openCustomPageSizeDialog'

interface OpenCustomPageSizeDialogOptions {
  readonly ownerDocument: Document
  readonly host: HTMLElement
  readonly editor: Editor
  readonly i18n: ResolvedJWordUiI18n
  announce(message: string, refreshMirror?: boolean): void
  markToolbarTransaction(): void
  refresh(): void
  restoreEditorFocusSoon(): void
}

interface PageSizeDialogField {
  readonly row: HTMLElement
  readonly input: HTMLInputElement
}

interface PageSizeDialogFields {
  readonly width: PageSizeDialogField
  readonly height: PageSizeDialogField
  readonly marginTop: PageSizeDialogField
  readonly marginRight: PageSizeDialogField
  readonly marginBottom: PageSizeDialogField
  readonly marginLeft: PageSizeDialogField
}

interface PageSizeDialogValues {
  readonly width: number
  readonly height: number
  readonly marginTop: number
  readonly marginRight: number
  readonly marginBottom: number
  readonly marginLeft: number
}

const CENTIMETERS_PER_INCH = 2.54

/** 打开自定义页面大小弹窗。 */
export function openCustomPageSizeDialog(options: OpenCustomPageSizeDialogOptions): void {
  const ownerDocument = options.ownerDocument
  const existingDialog = ownerDocument.querySelector('[data-jword-page-size-dialog="true"]')

  existingDialog?.remove()

  const signalController = new (ownerDocument.defaultView?.AbortController ?? AbortController)()
  const overlay = ownerDocument.createElement('div')
  const card = ownerDocument.createElement('form')
  const title = ownerDocument.createElement('h2')
  const description = ownerDocument.createElement('p')
  const fields = createDialogFields(ownerDocument, options)
  const fieldList = ownerDocument.createElement('div')
  const error = ownerDocument.createElement('p')
  const actions = ownerDocument.createElement('div')
  const cancel = ownerDocument.createElement('button')
  const apply = ownerDocument.createElement('button')

  overlay.className = 'jw-page-size-dialog'
  overlay.setAttribute('data-jword-page-size-dialog', 'true')
  overlay.setAttribute('role', 'presentation')
  card.className = 'jw-page-size-dialog__card'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  title.className = 'jw-page-size-dialog__title'
  title.setAttribute('data-jword-page-size-title', 'true')
  title.textContent = readJWordUiText(options.i18n, 'dialog.pageSize.title')
  description.className = 'jw-page-size-dialog__description'
  description.setAttribute('data-jword-page-size-description', 'true')
  description.textContent = readJWordUiText(
    options.i18n,
    'dialog.pageSize.description'
  )
  fieldList.className = 'jw-page-size-dialog__fields'
  fieldList.append(
    fields.width.row,
    fields.height.row,
    fields.marginTop.row,
    fields.marginRight.row,
    fields.marginBottom.row,
    fields.marginLeft.row
  )
  error.className = 'jw-page-size-dialog__error'
  error.setAttribute('data-jword-page-size-error', 'true')
  error.setAttribute('aria-live', 'polite')
  actions.className = 'jw-page-size-dialog__actions'
  cancel.type = 'button'
  cancel.className = 'jw-page-size-dialog__button'
  cancel.setAttribute('data-jword-page-size-cancel', 'true')
  cancel.textContent = readJWordUiText(options.i18n, 'dialog.pageSize.cancel')
  apply.type = 'submit'
  apply.className = 'jw-page-size-dialog__button jw-page-size-dialog__button--primary'
  apply.setAttribute('data-jword-page-size-apply', 'true')
  apply.textContent = readJWordUiText(options.i18n, 'dialog.pageSize.apply')
  actions.append(cancel, apply)
  card.append(title, description, fieldList, error, actions)
  overlay.append(card)

  ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDialog()
    }
  }, { signal: signalController.signal })
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeDialog()
    }
  }, { signal: signalController.signal })
  cancel.addEventListener('click', () => {
    closeDialog()
  }, { signal: signalController.signal })
  card.addEventListener('submit', (event) => {
    event.preventDefault()
    applyCustomPageSize(options, fields, error, closeDialog)
  }, { signal: signalController.signal })

  options.host.append(overlay)
  queueMicrotask(() => fields.width.input.focus())

  /** 关闭弹窗并恢复编辑器焦点。 */
  function closeDialog(): void {
    signalController.abort()
    overlay.remove()
    options.restoreEditorFocusSoon()
  }
}

/** 创建弹窗全部输入字段。 */
function createDialogFields(
  ownerDocument: Document,
  options: OpenCustomPageSizeDialogOptions
): PageSizeDialogFields {
  const pageConfig = options.editor.getPageConfig()
  const unit = readJWordUiText(options.i18n, 'dialog.pageSize.unitCm')

  return {
    width: createDialogField(ownerDocument, {
      name: 'width',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.width'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.widthTwips)),
      min: '0.1'
    }),
    height: createDialogField(ownerDocument, {
      name: 'height',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.height'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.heightTwips)),
      min: '0.1'
    }),
    marginTop: createDialogField(ownerDocument, {
      name: 'marginTop',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.marginTop'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.marginTwips.top)),
      min: '0'
    }),
    marginRight: createDialogField(ownerDocument, {
      name: 'marginRight',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.marginRight'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.marginTwips.right)),
      min: '0'
    }),
    marginBottom: createDialogField(ownerDocument, {
      name: 'marginBottom',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.marginBottom'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.marginTwips.bottom)),
      min: '0'
    }),
    marginLeft: createDialogField(ownerDocument, {
      name: 'marginLeft',
      label: readJWordUiText(options.i18n, 'dialog.pageSize.marginLeft'),
      unit,
      value: formatCentimeters(twipsToCentimeters(pageConfig.marginTwips.left)),
      min: '0'
    })
  }
}

/** 创建单个数值输入字段。 */
function createDialogField(
  ownerDocument: Document,
  options: Readonly<{
    name: string
    label: string
    unit: string
    value: string
    min: string
  }>
): PageSizeDialogField {
  const row = ownerDocument.createElement('label')
  const label = ownerDocument.createElement('span')
  const input = ownerDocument.createElement('input')
  const unit = ownerDocument.createElement('span')

  row.className = 'jw-page-size-dialog__field'
  row.setAttribute('data-jword-page-size-field', options.name)
  label.className = 'jw-page-size-dialog__field-label'
  label.textContent = options.label
  input.className = 'jw-page-size-dialog__input'
  input.type = 'number'
  input.min = options.min
  input.step = '0.1'
  input.value = options.value
  input.setAttribute('inputmode', 'decimal')
  input.setAttribute('aria-label', options.label)
  unit.className = 'jw-page-size-dialog__unit'
  unit.textContent = options.unit
  row.append(label, input, unit)

  return {
    row,
    input
  }
}

/** 应用用户输入的自定义页面大小。 */
function applyCustomPageSize(
  options: OpenCustomPageSizeDialogOptions,
  fields: PageSizeDialogFields,
  error: HTMLElement,
  closeDialog: () => void
): void {
  const values = readDialogValues(fields)

  if (values === null) {
    writeDialogError(options.i18n, error, 'dialog.pageSize.errorInvalid')
    return
  }

  if (values.marginLeft + values.marginRight >= values.width || values.marginTop + values.marginBottom >= values.height) {
    writeDialogError(options.i18n, error, 'dialog.pageSize.errorContent')
    return
  }

  const widthTwips = centimetersToTwips(values.width)
  const heightTwips = centimetersToTwips(values.height)
  const nextPageConfig = applyCustomPageConfig(options, values, widthTwips, heightTwips)

  options.refresh()
  options.announce(readCustomPageSizeMessage(options.i18n, nextPageConfig), true)
  closeDialog()
}

/** 写入弹窗错误文案并记录可本地化 key。 */
function writeDialogError(
  i18n: ResolvedJWordUiI18n,
  error: HTMLElement,
  key: 'dialog.pageSize.errorInvalid' | 'dialog.pageSize.errorContent'
): void {
  error.setAttribute('data-jword-page-size-error-key', key)
  error.textContent = readJWordUiText(i18n, key)
}

/** 读取并校验弹窗输入值。 */
function readDialogValues(fields: PageSizeDialogFields): PageSizeDialogValues | null {
  const width = readPositiveNumber(fields.width.input)
  const height = readPositiveNumber(fields.height.input)
  const marginTop = readNonNegativeNumber(fields.marginTop.input)
  const marginRight = readNonNegativeNumber(fields.marginRight.input)
  const marginBottom = readNonNegativeNumber(fields.marginBottom.input)
  const marginLeft = readNonNegativeNumber(fields.marginLeft.input)

  if (
    width === null
    || height === null
    || marginTop === null
    || marginRight === null
    || marginBottom === null
    || marginLeft === null
  ) {
    return null
  }

  return {
    width,
    height,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft
  }
}

/** 将自定义页面配置写入 editor。 */
function applyCustomPageConfig(
  options: OpenCustomPageSizeDialogOptions,
  values: PageSizeDialogValues,
  widthTwips: number,
  heightTwips: number
): PageConfig {
  options.markToolbarTransaction()

  return options.editor.setPageConfig({
    widthTwips,
    heightTwips,
    orientation: widthTwips > heightTwips ? 'landscape' : 'portrait',
    marginTwips: {
      top: centimetersToTwips(values.marginTop),
      right: centimetersToTwips(values.marginRight),
      bottom: centimetersToTwips(values.marginBottom),
      left: centimetersToTwips(values.marginLeft)
    }
  })
}

/** 读取正数输入。 */
function readPositiveNumber(input: HTMLInputElement): number | null {
  const value = Number(input.value)

  return Number.isFinite(value) && value > 0 ? value : null
}

/** 读取非负数输入。 */
function readNonNegativeNumber(input: HTMLInputElement): number | null {
  const value = Number(input.value)

  return Number.isFinite(value) && value >= 0 ? value : null
}

/** 生成自定义页面应用成功播报。 */
function readCustomPageSizeMessage(i18n: ResolvedJWordUiI18n, pageConfig: PageConfig): string {
  return readJWordUiText(
    i18n,
    'a11y.pageSize.customApplied'
  )
    .replace('{width}', formatCentimeters(twipsToCentimeters(pageConfig.widthTwips)))
    .replace('{height}', formatCentimeters(twipsToCentimeters(pageConfig.heightTwips)))
}

/** 将厘米换算为 twip。 */
function centimetersToTwips(centimeters: number): number {
  return Math.round(centimeters / CENTIMETERS_PER_INCH * TWIPS_PER_INCH)
}

/** 将 twip 换算为厘米。 */
function twipsToCentimeters(twips: number): number {
  return twips / TWIPS_PER_INCH * CENTIMETERS_PER_INCH
}

/** 格式化厘米数值，最多保留一位小数。 */
function formatCentimeters(centimeters: number): string {
  return Number(centimeters.toFixed(1)).toString()
}
