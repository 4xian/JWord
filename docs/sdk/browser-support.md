# Browser Support Matrix

Gate 7 对外浏览器支持矩阵。本文是 1.0-stable SDK 的公开支持口径；测试矩阵用于回归覆盖，不等同于最低版本承诺。

## 桌面编辑支持

| 浏览器族 | 最低版本 | 支持能力 |
| --- | --- | --- |
| Chrome / Edge | Chrome / Edge ≥ 114 | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |
| Firefox | Firefox ≥ 115 ESR | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |
| Safari | Safari ≥ 16.4 | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |

## 窄屏适配边界

窄屏不再作为独立平台或能力路线描述，只作为同一套桌面 Web 编辑器的响应式视口适配。当前验收只要求分页 canvas 在窄屏视口下可滚动、可阅读、页面不空白，且工具栏样式不遮挡正文。

窄屏适配不得引入第二套 editor、第二套只读模式或专用输入链路。后续若要改变编辑交互，应按通用浏览器输入、选择区、滚动焦点和工具栏响应式问题处理，不在 JWord 中建立单独的窄屏平台概念。

## 构建 target

公开包和示例构建 target 与本矩阵对齐到 ES2022：

- `packages/*/tsconfig.json` 使用 `target: ES2022` 和 `lib: ES2022`。
- `examples/vanilla`、`examples/docx`、`examples/collab`、`examples/react`、`examples/vue`、`examples/vue2` 的示例构建链路均对齐 ES2022。
- Vite 示例配置均设置 `build.target: 'es2022'`。
- 仓库不为低于上述矩阵的浏览器内置额外 polyfill；宿主若要支持更旧浏览器，需要在自己的应用构建链路中降级和补 polyfill。

## E2E 回归矩阵

自动化 E2E 维持 Chromium / Firefox / WebKit 最新版项目：

- `chromium`：覆盖 Chrome / Edge 浏览器族的常规桌面编辑回归。
- `firefox`：覆盖 Firefox 浏览器族的常规桌面编辑回归。
- `webkit`：覆盖 Safari 浏览器族的常规桌面编辑回归。
- `perf-chromium`、`visual-chromium`、`ime-chromium`、`collab-chromium` 仍作为专项回归项目，不改变最低浏览器版本承诺。

最低版本兼容由本文档、ES2022 target 和后续人工/外部集成验证共同约束；Playwright 最新版三浏览器项目用于防止主流浏览器族回归。

## 无障碍人工验证边界

当前仓库已有 axe-core serious/critical 扫描与键盘 smoke，用于防止明显无障碍结构回归；这些自动化检查不等同屏幕阅读器真实朗读验证。

屏幕阅读器人工矩阵仍为 pending：发布材料不得宣称 VoiceOver、NVDA、JAWS 或其他读屏组合已经完成朗读顺序、状态提示和复杂交互验证。人工操作步骤记录在 `docs/current-implementation/screen-reader-manual-verification.md`；需要补证的范围记录在 `docs/current-implementation/backlog.md` 的 `JW-BACKLOG-001`。
