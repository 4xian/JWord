/**
 * 职责：提供 Gate 0 最小 Editor facade 和 DOM 挂载生命周期。
 * 边界：不实现 Gate 1 文档模型、事务管线、输入系统、布局或渲染。
 * 协作模块：examples/vanilla、UI wrapper 和后续 renderer 只通过公开 facade 管理生命周期。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#45-模块边界。
 */

const DEFAULT_EDITOR_LABEL = 'JWord editor'

/**
 * 创建 JWord editor 实例时使用的选项。
 *
 * @remarks
 * Gate 0 只接受可识别外壳所需的展示元数据。
 * 不创建文档状态、事务、布局或输入处理器。
 *
 * @example
 * ```ts
 * const editor = createEditor({ label: 'Contract draft' });
 * editor.mount(document.querySelector('#editor')!);
 * ```
 */
export interface EditorOptions {
  /**
   * 挂载后编辑器外壳使用的无障碍标签。
   *
   * @defaultValue `"JWord editor"`
   */
  readonly label?: string
}

/**
 * JWord editor 生命周期的公开 facade。
 *
 * @remarks
 * facade 可在非 DOM 环境安全创建。浏览器 DOM 只在 {@link Editor.mount} 中访问。
 * 挂载前或多次调用 {@link Editor.destroy} 都是 no-op。
 */
export interface Editor {
  /**
   * 将编辑器外壳挂载到 host 元素。
   *
   * @param host 集成应用持有的现有 DOM 元素。
   * @throws Error 当编辑器已经挂载时抛出。
   * @returns 无返回值。
   * @remarks
   * 副作用：向 `host` 追加 `jw-editor` 外壳和 canvas 容器。
   *
   * @example
   * ```ts
   * const editor = createEditor();
   * editor.mount(document.body);
   * ```
   */
  mount(host: HTMLElement): void

  /**
   * 销毁已挂载的编辑器外壳。
   *
   * @returns 无返回值。
   * @remarks
   * 副作用：移除本 editor 创建的 DOM。重复调用安全，首次成功清理后不再执行操作。
   *
   * @example
   * ```ts
   * const editor = createEditor();
   * editor.destroy();
   * ```
   */
  destroy(): void
}

interface MountedEditorDom {
  readonly shell: HTMLElement
}

class JWordEditor implements Editor {
  private readonly label: string
  private mountedDom: MountedEditorDom | undefined

  constructor(options?: EditorOptions) {
    this.label = options?.label ?? DEFAULT_EDITOR_LABEL
  }

  mount(host: HTMLElement): void {
    if (this.mountedDom !== undefined) {
      throw new Error('JWord editor is already mounted.')
    }

    const ownerDocument = host.ownerDocument
    const shell = ownerDocument.createElement('div')
    shell.className = 'jw-editor'
    shell.setAttribute('data-jword-editor', '')
    shell.setAttribute('role', 'application')
    shell.setAttribute('aria-label', this.label)

    const canvasContainer = ownerDocument.createElement('div')
    canvasContainer.className = 'jw-editor__canvas-container'
    canvasContainer.setAttribute('data-jword-canvas-container', '')

    shell.append(canvasContainer)
    host.append(shell)

    this.mountedDom = { shell }
  }

  destroy(): void {
    this.mountedDom?.shell.remove()
    this.mountedDom = undefined
  }
}

/**
 * 创建 JWord editor facade。
 *
 * @param options 可选的 Gate 0 shell 配置。
 * @returns Editor 生命周期 facade。
 * @remarks
 * 此函数不访问浏览器 DOM。调用 {@link Editor.mount} 才会把 editor shell 挂载到 host 元素。
 *
 * @example
 * ```ts
 * const editor = createEditor();
 * editor.mount(document.querySelector('#editor')!);
 * editor.destroy();
 * ```
 */
export function createEditor(options?: EditorOptions): Editor {
  return new JWordEditor(options)
}
