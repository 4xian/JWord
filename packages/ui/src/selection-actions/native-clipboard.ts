/**
 * 职责：封装 selection-actions 使用的原生 clipboard 事件与 execCommand 兼容层。
 * 边界：不读取 editor projection，不决定 cut/copy/paste 业务语义。
 * 协作模块：selection-actions/clipboard 负责稳定选区剪贴板动作，core facade 监听合成事件。
 * 性能/安全约束：只在用户交互链路内分发合成事件，失败时由调用方输出稳定提示。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */

/** selection-actions 内部剪贴板缓冲区。 */
export interface ClipboardBuffer {
  plainText: string
  htmlText: string
}

/** 创建可被 facade runtime 识别的最小 clipboardData 对象。 */
export function createClipboardData(buffer: ClipboardBuffer): Readonly<{
  getData(type: string): string
  setData(type: string, value: string): void
}> {
  return {
    getData(type: string): string {
      if (type === 'text/plain') {
        return buffer.plainText
      }

      if (type === 'text/html') {
        return buffer.htmlText
      }

      return ''
    },
    setData(type: string, value: string): void {
      if (type === 'text/plain') {
        buffer.plainText = value
      }

      if (type === 'text/html') {
        buffer.htmlText = value
      }
    }
  }
}

/** 通过合成 clipboard 事件收集 core facade 生成的复制内容。 */
export function collectClipboardBuffer(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut'
): ClipboardBuffer {
  const buffer: ClipboardBuffer = {
    plainText: '',
    htmlText: ''
  }

  dispatchClipboardEvent(hiddenTextarea, kind, createClipboardData(buffer))

  return buffer
}

/** 向当前 hidden textarea 分发一条带 clipboardData 的合成事件。 */
export function dispatchClipboardEvent(
  hiddenTextarea: HTMLTextAreaElement,
  kind: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardData>
): void {
  const event = new Event(kind, {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  hiddenTextarea.dispatchEvent(event)
}

/** 尝试通过浏览器原生命令完成 copy/cut/paste。 */
export function runNativeExecCommand(command: 'copy' | 'cut' | 'paste'): boolean {
  const documentWithExec = document as Document & {
    execCommand?: (name: string) => boolean
  }

  return typeof documentWithExec.execCommand === 'function'
    && documentWithExec.execCommand(command) === true
}
