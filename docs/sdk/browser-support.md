# Browser Support Matrix

Gate 7 对外浏览器支持真源。以下版本是 1.0-stable SDK 的最低兼容目标。`LIC-107B2` 已按明确风险接受允许内部阶段继续，但真实最低版本人工认证仍为 `Deferred`；认证完成前仍阻断对应最低版本对外声明和商业 GA，且不得对外描述为已完成最低版本实测。

## 桌面编辑支持

| 浏览器族 | 最低兼容目标 | 认证状态 | 支持能力 |
| --- | --- | --- | --- |
| Chrome / Edge | Chrome / Edge ≥ 100 | `LIC-107B2` Deferred | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。Chrome 100 与 Edge 100 需分别实测。 |
| Firefox | Firefox ≥ 128 | `LIC-107B2` Deferred | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |
| Safari | Safari ≥ 16.4 | `LIC-107B2` Deferred | 完整桌面编辑、分页渲染、基础 `.jword` 保存/打开、按授权启用高级格式与协作能力。 |

Firefox 128 是最低兼容目标，不是当前仍受 Mozilla 支持的 ESR。Mozilla 已说明 Firefox 128 ESR 于 2025-09-16 结束支持；生产环境应使用 Mozilla 当前仍提供安全更新的 ESR。最低兼容与浏览器厂商安全支持是两个独立维度。

## 浏览器 API 编写规则

- 新增或修改的浏览器运行时代码必须逐项核对 Chrome 100、Edge 100、Firefox 128 和 Safari 16.4；对任一最低目标不可用的 API，必须增加 feature detection 与明确 fallback/polyfill，或重新批准提高最低版本。
- JWord 自有浏览器源码在不增加复杂度的前提下，优先使用 Chrome 92 已支持的语法和 API 写法。这是代码编写基线，不会把完整 SDK 的对外最低版本降为 Chrome 92。
- 对外兼容结论必须同时审查直接依赖和浏览器 bundle。当前 `@noble/curves@2.2.0` 运行时包含 `Object.hasOwn()`，因此不得只根据 JWord 自有源码宣称 Chrome 92 完整支持。
- 语法转换不等于 Web/JavaScript API 兼容。Vite 官方文档明确说明默认只处理语法转换；`target` 不提供运行时 API polyfill。

## 窄屏适配边界

窄屏不再作为独立平台或能力路线描述，只作为同一套桌面 Web 编辑器的响应式视口适配。当前验收只要求分页 canvas 在窄屏视口下可滚动、可阅读、页面不空白，且工具栏样式不遮挡正文。

窄屏适配不得引入第二套 editor、第二套只读模式或专用输入链路。后续若要改变编辑交互，应按通用浏览器输入、选择区、滚动焦点和工具栏响应式问题处理，不在 JWord 中建立单独的窄屏平台概念。

## 构建 target

公开包和示例构建 target 保持 ES2022，但不把 ES2022 单独作为浏览器支持证据：

- `packages/*/tsconfig.json` 使用 `target: ES2022` 和 `lib: ES2022`。
- `examples/vanilla`、`examples/docx`、`examples/collab`、`examples/react`、`examples/vue`、`examples/vue2` 的示例构建链路均对齐 ES2022。
- Vite 示例配置均设置 `build.target: 'es2022'`。
- 仓库不为低于上述矩阵的浏览器内置额外 polyfill；宿主若要支持更旧浏览器，需先评估自己的应用构建链路、polyfill 和 JWord 依赖 bundle，且不计入 JWord 公开支持范围。

## Node 与客户宿主边界

仓库 `engines.node` 的 Node ≥ 20.19.0 用于 JWord 开发、构建、测试、发布工具和 `LIC-107B2` Node 最低版本验证。它不是客户浏览器宿主要求：客户应用代码只集成浏览器 SDK。未来协作等正式服务端统一以版本化 Docker 镜像交付，Node 运行时位于镜像内；客户部署宿主只需要符合要求的容器运行环境，不需要直接安装 Node 或导入服务端 npm package。

## E2E 回归矩阵

自动化 E2E 维持 Chromium / Firefox / WebKit 最新版项目：

- `chromium`：覆盖 Chrome / Edge 浏览器族的常规桌面编辑回归。
- `firefox`：覆盖 Firefox 浏览器族的常规桌面编辑回归。
- `webkit`：覆盖 Safari 浏览器族的常规桌面编辑回归。
- `perf-chromium`、`visual-chromium`、`ime-chromium`、`collab-chromium` 仍作为专项回归项目，不改变最低浏览器版本承诺。

`LIC-107B1` 自动 smoke 覆盖当前 Node、Chromium、Firefox、WebKit 和真实 module Dedicated Worker，用于防止当前主流运行时回归。Playwright 最新版结果不是最低版本证据。

`LIC-107B2` 的 Node 20.19.0 已通过固定 Docker 环境验证；Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 仍必须在真实环境执行最低版本矩阵，并记录浏览器完整版本、操作系统、tarball hash 和执行日期。人工步骤见 [LIC-107B2 最低浏览器人工验证手册](../current-implementation/license-minimum-browser-manual-verification.md)。没有 BrowserStack、Sauce Labs 或对应真实机器时保持 `Deferred/not-run`，不阻断内部阶段；但不得把未执行写成通过，也不得在认证前对外宣称该最低版本矩阵已经验证。

## 参考来源

- [Mozilla Firefox ESR release cycle](https://support.mozilla.org/en-US/kb/firefox-esr-release-cycle)
- [Mozilla Firefox for Enterprise 141 release notes](https://support.mozilla.org/en-US/kb/firefox-enterprise-141-release-notes)
- [MDN `Object.hasOwn()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn)
- [Vite Browser Compatibility](https://vite.dev/guide/build#browser-compatibility)
- [Vite `build.target`](https://vite.dev/config/build-options#build-target)

## 无障碍人工验证边界

当前仓库已有 axe-core serious/critical 扫描与键盘 smoke，用于防止明显无障碍结构回归；这些自动化检查不等同屏幕阅读器真实朗读验证。

屏幕阅读器人工矩阵仍为 pending：发布材料不得宣称 VoiceOver、NVDA、JAWS 或其他读屏组合已经完成朗读顺序、状态提示和复杂交互验证。人工操作步骤记录在 `docs/current-implementation/screen-reader-manual-verification.md`；需要补证的范围记录在 `docs/current-implementation/backlog.md` 的 `JW-BACKLOG-001`。
