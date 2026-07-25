/**
 * 职责：把 @4xian/jword-ui 的轻量主题输入应用到宿主 DOM 根节点。
 * 边界：只写 class、data-theme 和 CSS custom properties，不创建样式表或读取 editor 状态。
 * 协作模块：create-ui 调用本模块，toolbar.css 消费 --jw-* token。
 * 性能/安全约束：主题应用只写有限 DOM 属性和 token，不引入 CSS-in-JS 或运行时布局计算。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordUiThemeName,
  JWordUiThemeOptions,
  JWordUiThemeToken
} from './types'

interface ApplyJWordUiThemeOptions {
  readonly theme?: JWordUiThemeOptions
  readonly hosts: readonly (HTMLElement | undefined | null)[]
}

interface CreateJWordUiThemeControllerOptions extends ApplyJWordUiThemeOptions {}

interface HostThemeSnapshot {
  readonly host: HTMLElement
  readonly hadRootClass: boolean
  readonly themeName: string | null
  readonly classNameHadToken: boolean
  readonly tokenValues: Readonly<Record<string, string>>
}

/** UI 默认 light 主题 token。 */
export const DEFAULT_JWORD_UI_THEME_TOKENS: Readonly<Record<JWordUiThemeToken, string>> = /* @__PURE__ */ Object.freeze({
  colorSurface: '#ffffff',
  colorSurfaceMuted: '#f8fafc',
  colorSurfaceElevated: '#ffffff',
  colorText: '#454d5a',
  colorTextMuted: '#667085',
  colorBorder: '#e8ebef',
  colorBorderStrong: '#94a3b8',
  colorAccent: '#2467f2',
  colorAccentMuted: '#eef2fc',
  colorDanger: '#b42318',
  radiusControl: '4px',
  radiusPanel: '10px',
  shadowShell: '0 2px 8px rgb(31 41 55 / 4%)',
  shadowOverlay: '0 12px 28px rgb(25 35 52 / 12%)',
  focusRing: '#1d4ed8'
})

const DARK_JWORD_UI_THEME_TOKENS: Readonly<Record<JWordUiThemeToken, string>> = /* @__PURE__ */ Object.freeze({
  colorSurface: '#09090b',
  colorSurfaceMuted: '#27272a',
  colorSurfaceElevated: '#18181b',
  colorText: '#fafafa',
  colorTextMuted: '#a1a1aa',
  colorBorder: '#27272a',
  colorBorderStrong: '#3f3f46',
  colorAccent: '#fafafa',
  colorAccentMuted: '#27272a',
  colorDanger: '#f87171',
  radiusControl: '4px',
  radiusPanel: '10px',
  shadowShell: '0 2px 8px rgb(0 0 0 / 20%)',
  shadowOverlay: '0 12px 28px rgb(0 0 0 / 28%)',
  focusRing: '#71717a'
})

/** UI 内建主题 token，状态栏和 toolbar 动态切换时复用同一套双色取值。 */
export const JWORD_UI_THEME_TOKENS_BY_NAME: Readonly<Record<JWordUiThemeName, Readonly<Record<JWordUiThemeToken, string>>>> = /* @__PURE__ */ Object.freeze({
  light: DEFAULT_JWORD_UI_THEME_TOKENS,
  dark: DARK_JWORD_UI_THEME_TOKENS
})

/** 动态主题控制器，供 createJWordUi 和状态栏切换按钮复用。 */
export interface JWordUiThemeController {
  /** 切换主题并同步 data-theme、class 与 CSS custom properties。 */
  setTheme(theme?: JWordUiThemeOptions): void
  /** 更新需要同步主题的宿主节点。 */
  setHosts(hosts: readonly (HTMLElement | undefined | null)[]): void
  /** 恢复创建控制器前的 DOM 主题状态。 */
  destroy(): void
}

/** 应用主题并返回销毁清理函数。 */
export function applyJWordUiTheme(options: ApplyJWordUiThemeOptions): () => void {
  const themeName = options.theme?.name ?? 'light'
  const customClass = options.theme?.className
  const tokens = resolveThemeTokens(options.theme)
  const hosts = dedupeThemeHosts(options.hosts)
  const snapshots = hosts.map((host) => snapshotThemeHost(host, customClass, tokens))

  for (const host of hosts) {
    host.classList.add('jw-root')
    if (customClass !== undefined && customClass.length > 0) {
      host.classList.add(customClass)
    }
    host.setAttribute('data-theme', themeName)
    applyThemeTokens(host, tokens)
  }

  return () => {
    for (const snapshot of snapshots) {
      restoreThemeHost(snapshot, customClass, tokens)
    }
  }
}

/** 创建可重复切换的 UI 主题控制器。 */
export function createJWordUiThemeController(options: CreateJWordUiThemeControllerOptions): JWordUiThemeController {
  let hosts = options.hosts
  let currentTheme = options.theme
  let cleanupTheme = (): void => {}

  /** 重新应用当前主题，切换前先恢复上一次写入。 */
  function applyCurrentTheme(): void {
    cleanupTheme()
    cleanupTheme = applyJWordUiTheme({
      ...(currentTheme === undefined ? {} : { theme: currentTheme }),
      hosts
    })
  }

  applyCurrentTheme()

  return {
    setTheme(theme): void {
      currentTheme = mergeThemeOptions(currentTheme, theme)
      applyCurrentTheme()
    },
    setHosts(nextHosts): void {
      hosts = nextHosts
      applyCurrentTheme()
    },
    destroy(): void {
      cleanupTheme()
      cleanupTheme = (): void => {}
    }
  }
}

/** 合并动态主题输入，保留宿主 class 和 token 覆盖。 */
function mergeThemeOptions(
  current: JWordUiThemeOptions | undefined,
  next: JWordUiThemeOptions | undefined
): JWordUiThemeOptions | undefined {
  if (next === undefined) {
    return current
  }

  return {
    ...current,
    ...next,
    tokens: {
      ...(current?.tokens ?? {}),
      ...(next.tokens ?? {})
    }
  }
}

/** 去重主题宿主，避免同一节点重复快照。 */
function dedupeThemeHosts(hosts: readonly (HTMLElement | undefined | null)[]): HTMLElement[] {
  const deduped: HTMLElement[] = []

  for (const host of hosts) {
    if (host === undefined || host === null || deduped.includes(host)) {
      continue
    }

    deduped.push(host)
  }

  return deduped
}

/** 记录主题写入前的宿主状态。 */
function snapshotThemeHost(
  host: HTMLElement,
  customClass: string | undefined,
  tokens: Readonly<Record<JWordUiThemeToken, string>>
): HostThemeSnapshot {
  const tokenValues: Record<string, string> = {}

  for (const token of Object.keys(tokens) as JWordUiThemeToken[]) {
    const customProperty = readThemeCustomProperty(token)

    tokenValues[customProperty] = host.style.getPropertyValue(customProperty)
  }

  return {
    host,
    hadRootClass: host.classList.contains('jw-root'),
    themeName: host.getAttribute('data-theme'),
    classNameHadToken: customClass === undefined || customClass.length === 0 || host.classList.contains(customClass),
    tokenValues
  }
}

/** 把主题 token 写成 CSS custom property。 */
function applyThemeTokens(
  host: HTMLElement,
  tokens: Readonly<Record<JWordUiThemeToken, string>>
): void {
  for (const [token, value] of Object.entries(tokens) as [JWordUiThemeToken, string][]) {
    host.style.setProperty(readThemeCustomProperty(token), value)
  }
}

/** 恢复主题写入前的宿主状态。 */
function restoreThemeHost(
  snapshot: HostThemeSnapshot,
  customClass: string | undefined,
  tokens: Readonly<Record<JWordUiThemeToken, string>>
): void {
  if (!snapshot.hadRootClass) {
    snapshot.host.classList.remove('jw-root')
  }

  if (customClass !== undefined && customClass.length > 0 && !snapshot.classNameHadToken) {
    snapshot.host.classList.remove(customClass)
  }

  if (snapshot.themeName === null) {
    snapshot.host.removeAttribute('data-theme')
  } else {
    snapshot.host.setAttribute('data-theme', snapshot.themeName)
  }

  for (const token of Object.keys(tokens) as JWordUiThemeToken[]) {
    const customProperty = readThemeCustomProperty(token)
    const previousValue = snapshot.tokenValues[customProperty]

    if (previousValue === undefined || previousValue.length === 0) {
      snapshot.host.style.removeProperty(customProperty)
    } else {
      snapshot.host.style.setProperty(customProperty, previousValue)
    }
  }
}

/** 合并内建主题 token 与宿主覆盖。 */
function resolveThemeTokens(theme: JWordUiThemeOptions | undefined): Readonly<Record<JWordUiThemeToken, string>> {
  const themeName = theme?.name ?? 'light'

  return {
    ...JWORD_UI_THEME_TOKENS_BY_NAME[themeName],
    ...(theme?.tokens ?? {})
  }
}

/** 把公开 token 名转换成对应 CSS custom property。 */
function readThemeCustomProperty(token: JWordUiThemeToken): string {
  return `--jw-${token.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`)}`
}
