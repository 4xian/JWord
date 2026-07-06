# Browser Support Matrix

Gate 7 对外浏览器支持矩阵。本文是 1.0-stable SDK 的公开支持口径；测试矩阵用于回归覆盖，不等同于最低版本承诺。

## 桌面编辑支持

| 浏览器族 | 最低版本 | 支持能力 |
| --- | --- | --- |
| Chrome / Edge | Chrome / Edge ≥ 114 | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |
| Firefox | Firefox ≥ 115 ESR | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |
| Safari | Safari ≥ 16.4 | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |

## 移动端边界

移动端仅承诺只读分页预览：同一套分页 canvas 在移动视口下应保持可滚动、可阅读、页面不空白。1.0 不承诺移动端编辑，不承诺触摸选区、虚拟键盘 IME、拖拽缩放或复杂工具栏交互在移动浏览器中达到桌面编辑能力。

移动端宿主如果需要编辑能力，应按 post-1.0 移动编辑专项重新评估输入法、触摸选区、滚动焦点和工具栏布局，不能把当前只读分页预览口径扩展为移动编辑承诺。

## 构建 target

公开包和示例构建 target 与本矩阵对齐到 ES2022：

- `packages/*/tsconfig.json` 使用 `target: ES2022` 和 `lib: ES2022`。
- `examples/vanilla`、`examples/docx`、`examples/collab` 的 `tsconfig.json` 使用 `target: ES2022` 和 `lib: ES2022`。
- 三个 Vite 示例配置均设置 `build.target: 'es2022'`。
- 仓库不为低于上述矩阵的浏览器内置额外 polyfill；宿主若要支持更旧浏览器，需要在自己的应用构建链路中降级和补 polyfill。

## E2E 回归矩阵

自动化 E2E 维持 Chromium / Firefox / WebKit 最新版项目：

- `chromium`：覆盖 Chrome / Edge 浏览器族的常规桌面编辑回归。
- `firefox`：覆盖 Firefox 浏览器族的常规桌面编辑回归。
- `webkit`：覆盖 Safari 浏览器族的常规桌面编辑回归。
- `perf-chromium`、`visual-chromium`、`ime-chromium`、`collab-chromium` 仍作为专项回归项目，不改变最低浏览器版本承诺。

最低版本兼容由本文档、ES2022 target 和后续人工/外部集成验证共同约束；Playwright 最新版三浏览器项目用于防止主流浏览器族回归。
