# Gate 7 SDK 稳定化方案审查报告

审查日期：2026-07-02
审查范围：Gate 7 规划方案完整性、可行性与企业级 SDK 差距分析

---

## 一、方案总体评价

Gate 7 规划方案在目标定义、迭代分解和验收标准方面已达到较高成熟度。24 个待办步骤覆盖了从 API 冻结到私有发布 dry-run 的完整 SDK 交付链路，执行顺序合理（先冻结再实现再文档再发布）。但在以下方面存在关键缺口和风险。

---

## 二、关键问题与修改建议

### 2.1 Plugin API 设计严重不足

**问题**：当前代码库中不存在任何 Plugin 基础设施。核心架构存在以下阻塞 Plugin API 的结构性缺口：

| 缺失能力 | 影响 |
|---|---|
| 无命令拦截/中间件链 | 插件无法在命令执行前拦截、修改或拒绝操作 |
| 无视觉装饰层 | 插件无法在 Canvas 上添加自定义高亮、标注、覆盖层 |
| 无自定义 Operation 类型 | Operation 联合类型和 OperationKind 集合是封闭的 |
| 无文档模型扩展命名空间 | Document/Paragraph/Run 无 metadata slot 供插件存储自定义数据 |
| 无生命周期钩子 | 无 onMount/onDestroy/beforeTransaction/afterLayout 钩子 |
| 无快捷键注册 API | 输入处理硬编码在 JWordEditorInputRuntime 中 |
| 无工具栏扩展注册 | JWordToolbarToolId 是固定联合类型，插件无法添加新按钮 |

**建议**：
1. Plugin API 的工作量远超 Step 7.5 的描述，需要拆分为 3-4 个子步骤，并且部分基础工作（如命令中间件链、生命周期钩子）必须在 core 包中完成，这意味着需要对 core 进行结构性修改。
2. 建议 Plugin API 分为两层：
   - **核心层（core 包）**：`PluginContext` 接口、命令中间件注册、生命周期钩子（`onMount`/`onDestroy`/`afterTransaction`）、键绑定注册、schema metadata slot。
   - **UI 层（ui 包）**：工具栏扩展注册、面板注册、自定义菜单项。
3. 视觉装饰层（decorations）的实现需要修改渲染管线（`renderPageCanvas`），建议标记为 `experimental`，不阻塞 1.0-stable。
4. 参考 Tiptap 的 Extension 模式：每个插件是一个包含 `name`、`addCommands()`、`addKeyboardShortcuts()`、`onTransaction()` 等钩子的对象，宿主通过 `createEditor({ extensions: [...] })` 注册。

### 2.2 React/Vue Wrapper 方案缺少具体设计

**问题**：规划中只有一句话描述（"只负责生命周期、props 到 EditorOptions、事件桥接"），未涉及以下关键问题：

| 未覆盖项 | 说明 |
|---|---|
| ref/实例暴露 | React 需要 `useImperativeHandle` 暴露 Editor 实例；Vue 需要 `defineExpose` |
| 受控/非受控模式 | 是否支持受控模式（props 变化触发 document 更新） |
| Context/Provide-Inject | 是否通过 React Context / Vue provide-inject 向子组件共享 Editor 实例 |
| Suspense/ErrorBoundary | React 18+ Suspense 和 Error Boundary 集成 |
| Vue Composition API | 是否提供 `useEditor()` composable |
| Teleport/Portal | 工具栏等 UI 是否支持 Teleport/Portal 渲染到其他 DOM 节点 |
| TypeScript 泛型 props | Wrapper props 的 TypeScript 体验 |
| StrictMode 兼容 | React StrictMode 下 double-mount 行为 |

**建议**：
1. 新增 Step 7.7a：React/Vue Wrapper 技术方案设计文档，覆盖上述所有问题。
2. SSR 空壳渲染需要明确：输出什么 HTML 结构（空 div + 占位高度？骨架屏？）。
3. 建议提供 headless 模式（仅提供 Editor 实例，不渲染 UI），方便集成方完全自定义 UI。

### 2.3 Theme/i18n 方案过于简略

**问题**：只提到 "jw- BEM 类名与 WCAG AA 对比度约束"，未回答以下关键问题：

- 主题切换机制：CSS 变量？class 切换？runtime theme object？
- 暗色模式：是否必须支持？
- i18n 实现方式：运行时字典替换？编译时抽取？
- i18n 覆盖范围：工具栏文案？错误消息？a11y label？
- 日期/数字格式本地化：是否在 scope 内？
- RTL 布局：是否在 1.0 scope 内？

**建议**：
1. Theme 方案建议采用 CSS Custom Properties（CSS 变量），配合 `data-theme` 属性切换。这是当前主流方案，与框架无关。
2. i18n 建议采用简单的 key-value 字典对象注入模式（类似 `createJWordUi({ locale: { bold: '加粗', italic: '斜体', ... } })`），避免引入 i18next 等重依赖。
3. RTL 布局建议明确标注为 post-1.0。

### 2.4 Devtools 面板设计缺少架构方案

**问题**：Step 7.10 列出了 devtools 要展示的数据（operation log、layout overlay、selection inspect 等），但未说明：

- 渲染方式：独立面板？浮动窗口？Chrome Extension？
- 数据源：如何从 Editor 获取 internal state 而不破坏封装？
- 性能影响：devtools 开启时的性能降级预算是多少？
- 条件加载：devtools 代码如何确保不进入生产 bundle？

**建议**：
1. Devtools 建议采用独立包 `@4xian/jword-devtools`，通过 `Editor.subscribe()` + 额外的 diagnostic API 获取数据。
2. 第一版建议只做浮动面板（类似 Vue DevTools 的浮动模式），Chrome Extension 放入 post-1.0。
3. 需要在 core 中新增 `Editor.getDiagnostics()` 或类似方法，以安全方式暴露内部状态快照。

### 2.5 文档站内容清单不完整

**问题**：Step 7.18 列出了文档站的信息架构（快速开始、核心概念、API 等），但缺少以下企业级 SDK 必备内容：

| 缺失内容 | 企业级必要性 |
|---|---|
| 安全指南 | URL 白名单、XSS 防护、内容清洗策略 |
| 性能优化指南 | 大文档优化、虚拟滚动配置、worker 调优 |
| 无障碍指南 | 屏幕阅读器兼容、键盘导航 |
| 升级指南（逐版本） | 每个 minor/major 版本的 breaking changes 和迁移步骤 |
| Changelog | 自动生成的版本变更日志 |
| 贡献指南 | 如果计划开源免费部分 |
| 浏览器兼容性矩阵 | 支持的浏览器及版本 |
| Node.js 兼容性 | collab-server 的 Node.js 版本要求 |
| TypeScript 版本兼容 | 最低 TypeScript 版本要求 |
| 错误代码参考 | 所有 JWordErrorCode / diagnostic code 的完整参考 |

**建议**：在 Step 7.18 中补充上述内容为文档站的必要页面。

### 2.6 Bundle Size 预算需要更新和细化

**问题**：
- 当前 `check-size.mjs` 的预算是 core 260KB / 首屏 330KB，但这是 Gate 2 时期设定的。用户提到当前 core dist 已达 494KB，首屏 581KB，远超 Gate 2 预算。
- 没有针对 React/Vue wrapper、devtools 等新增包的 size 预算。
- 没有 gzip/brotli 压缩后的尺寸门禁。

**建议**：
1. 重新评估并更新 size 预算。494KB core / 581KB 首屏在同类产品中属于中等偏上（Tiptap core ~200KB，ONLYOFFICE 无法比较因为其首屏加载整体较重）。
2. 新增分包 size 预算：
   - `@4xian/jword-react` < 15KB
   - `@4xian/jword-vue` < 15KB
   - `@4xian/jword-devtools` < 50KB（生产环境不加载）
3. 新增 gzip 尺寸门禁，这是集成方更关注的指标。
4. 将自定义 `check-size.mjs` 迁移到标准 `size-limit` 工具（Gate 7 specs 已提到但未执行）。

### 2.7 私有发布流程缺少关键环节

**问题**：Step 7.20 提到了 release dry-run，但缺少以下关键安全环节：

| 缺失环节 | 风险 |
|---|---|
| 源码泄漏检查 | `files` 字段或 `.npmignore` 配置不当导致源码发布 |
| 凭据泄漏检查 | 环境变量、API key 等硬编码检查 |
| License 文件 | 商业包是否携带正确的 LICENSE 文件 |
| README 一致性 | 每个包是否有独立 README |
| peer dependency 声明 | 外部消费时 peerDependencies 是否正确 |
| workspace 协议清洗 | `workspace:*` 是否在 publish 时被正确替换 |
| ESM/CJS 双模式 | 当前只有 ESM，是否需要 CJS fallback |

**建议**：
1. 现有的 Gate 5/6 commercial pack 脚本已覆盖了部分检查（源码泄漏、workspace 协议），但需要统一为 Gate 7 级别的全量检查。
2. 明确 ESM-only 策略并在文档中声明最低 Node.js 版本要求（>=18 或 >=20）。
3. 注意当前 `core`、`native`、`ui` 三个免费包缺少 `publishConfig.access` 配置。

### 2.8 版本兼容策略缺少具体细节

**问题**：Step 7.22 提到了 semver 和 deprecation，但缺少以下关键内容：

- 最低 TypeScript 版本承诺（如 `>=5.0`）
- 最低浏览器版本（如 Chrome 90+、Firefox 90+、Safari 15+）
- Node.js 版本支持策略（collab-server）
- Yjs 版本锁定策略（Yjs 升级是否算 breaking change）
- peerDependencies 版本范围策略
- 公开 API 的 deprecation 周期（多少个 minor 版本后移除）

---

## 三、缺失的关键交付物

### 3.1 对标企业级 SDK 的差距分析

| 能力 | Tiptap Pro | ONLYOFFICE SDK | JWord Gate 7 现状 |
|---|---|---|---|
| Plugin/Extension 系统 | 成熟的 Extension API，200+ 社区扩展 | 宏/插件系统 | 完全缺失，无任何基础设施 |
| 框架 Wrapper | React、Vue 2/3 官方支持 | React、Angular 官方支持 | 未实现，无 packages 目录 |
| 主题系统 | CSS 变量 + 预设主题 | Skin 系统 | 完全缺失 |
| i18n | 42 种语言 | 30+ 种语言 | 完全缺失 |
| Devtools | Chrome Extension | N/A | 完全缺失 |
| 文档站 | 完整的 docs.tiptap.dev | 完整的 api.onlyoffice.com | 仅有内部 specs |
| Playground | 在线交互式 demo | 在线 demo | 仅有开发示例 |
| Changelog | 自动化 changelog | 有 | 无 |
| Migration Guide | 逐版本迁移指南 | 有 | 无 |
| SDK 初始化模板 | `create-tiptap-app` CLI | 安装包 | 无 |
| 错误追踪集成 | 内置 error boundary | 有 | 仅有 JWordError 基础 |
| 遥测/分析 | 可选 usage analytics | N/A | 无 |
| 商业 License 管理 | License portal + key validation | License server | 仅有纯函数 entitlement 校验 |
| 社区支持渠道 | Discord + Forum | Forum | 无 |
| TypeScript 类型测试 | 有（dtslint / tsd） | N/A | 规划中未实现 |
| CI/CD 发布流水线 | GitHub Actions + changesets | 有 | 仅有 dry-run 脚本 |

### 3.2 必须在 Gate 7 中补充的关键交付物

1. **SDK 初始化模板或 Scaffold CLI**：帮助集成方快速创建项目（即使只是一个 `examples/starter` 模板项目）。
2. **Playground / 在线交互式 Demo**：嵌入文档站的可编辑示例，类似 CodeSandbox embed。
3. **Changelog 自动化**：基于 changesets 或 conventional-changelog 的自动 changelog 生成。
4. **浏览器兼容性测试矩阵**：明确记录并自动化验证支持的浏览器和版本。
5. **TypeScript 类型测试基础设施**：使用 `tsd` 或 `@typescript/lib-dom` 做类型层面的兼容验证。
6. **错误代码完整参考文档**：所有 JWordErrorCode 和 diagnostic code 的枚举、含义和恢复建议。
7. **peerDependencies 声明**：wrapper 包对 React/Vue 版本的 peer 依赖声明。

---

## 四、实施优先级调整建议

### 4.1 建议的调整顺序

```
原方案优先级：
Iteration 0 (冻结) → Iteration 1 (API/TSDoc) → Iteration 2 (文档/Plugin/Devtools)
  → Iteration 3 (Wrappers/Theme/Examples) → Iteration 4-5 (高级文档)
  → Iteration 6 (文档站/Bundle/Release)

建议调整为：
Phase 0: 冻结 + Core 扩展点改造
  - 冻结 API/edition matrix/feature key
  - 在 core 中增加 Plugin 所需的最小扩展点（命令中间件、生命周期钩子、键绑定注册）
  - 更新 size 预算

Phase 1: API 稳定化 + 类型测试
  - TSDoc / 类型测试 / 导出审计
  - 错误代码完整参考
  - tsd 类型测试基础设施

Phase 2: Plugin API + Theme/i18n
  - Plugin API 核心层（core 包）
  - Plugin API UI 层（ui 包）
  - Theme CSS 变量系统
  - i18n 字典注入

Phase 3: Wrappers
  - React wrapper + examples
  - Vue 3 wrapper + examples
  - SSR 验证

Phase 4: Devtools + Diagnostics
  - Devtools 浮动面板
  - Diagnostics export
  - 商业支持诊断包

Phase 5: 文档站 + Bundle + Release
  - 文档站完整内容
  - size-limit 集成
  - Release dry-run
  - 外部项目集成验收
  - Starter 模板
  - Changelog 自动化
```

### 4.2 调整理由

1. **Plugin 扩展点改造必须前置**：Plugin API 需要修改 core 包的内部架构（transaction pipeline 增加中间件链、Editor 增加钩子注册），这些修改可能影响已有测试，因此必须在 API 冻结后立即进行，而不是等到 Iteration 2。
2. **Theme/i18n 应与 Plugin 同期**：Theme 和 i18n 的实现可能影响 Plugin 的 UI 层设计（插件是否能自定义主题变量？插件是否能注入翻译？），应同期设计。
3. **Wrappers 依赖 Plugin API 稳定**：如果 Plugin API 的 `EditorOptions` 或 `createEditor` 入参发生变化，Wrappers 也需要跟着调整，因此 Wrappers 应在 Plugin API 稳定后再实现。

---

## 五、需要提前在其他 Gate 中准备的前置工作

### 5.1 已完成但需要检查的前置

| 前置 | 来源 Gate | 当前状态 | Gate 7 影响 |
|---|---|---|---|
| 公开 API 清单 | Gate 7 Step 7.1 | 已完成 | 清单护栏测试覆盖的 token 较少，建议扩大覆盖面 |
| Bundle size 工具链 | Gate 2 | 已完成但预算过时 | 需要更新预算值和检查范围 |
| 商业包 pack 审计 | Gate 5/6 | 已完成 | 需要统一为全量检查 |
| 第三方烟雾测试 | Gate 5/6 | 已完成 | 需要扩展到 wrapper 包 |

### 5.2 应提前准备但尚未开始的前置

1. **Core 扩展点**：在 Iteration 0 阶段就应评估 core 包需要暴露哪些新的 internal API 给 Plugin 使用。当前 Editor 的深层继承链（11 层 abstract class）使得添加扩展点的成本很高。
2. **UI 包的 CSS 变量化**：当前 `packages/ui/src/styles/toolbar.css` 是否已使用 CSS 变量？如果是硬编码颜色值，Theme 系统需要大量重构 CSS。
3. **UI 包的 export map 修正**：当前 `"./styles.css": "./src/styles/toolbar.css"` 指向源码目录，publish 后会失败，需要修正为指向 dist。

---

## 六、工作量评估

### 6.1 预估工时

| 阶段 | 估算人周 | 风险等级 |
|---|---|---|
| Phase 0: 冻结 + Core 扩展点 | 3-4 周 | 高（涉及 core 架构修改） |
| Phase 1: API 稳定化 + 类型测试 | 2-3 周 | 中 |
| Phase 2: Plugin API + Theme/i18n | 4-6 周 | 高（最大不确定性） |
| Phase 3: Wrappers | 2-3 周 | 低 |
| Phase 4: Devtools + Diagnostics | 2-3 周 | 中 |
| Phase 5: 文档站 + Bundle + Release | 3-4 周 | 中 |
| **总计** | **16-23 周** | |

### 6.2 关键风险

1. **Plugin API 的 core 改造风险**：向已有的 11 层继承链中添加扩展点，可能引发大量回归测试失败。建议采用 composition 而非 inheritance 的方式注入插件系统。
2. **文档站维护成本**：完整的文档站（含 Playground）初始搭建需要 2-3 周，但后续维护成本更高。建议使用 VitePress 或类似 SSG 工具，代码示例直接引用 examples/ 目录。
3. **外部项目集成验收（Step 7.21）依赖 npm pack 的正确性**：当前 `workspace:*` 协议在 pack 时的行为需要仔细验证，建议使用 verdaccio 本地 registry 进行端到端验证。

---

## 七、结论

Gate 7 规划方案的结构和目标设定合理，但在 Plugin API、Wrappers、Theme/i18n 和 Devtools 四个核心交付物上缺少具体的技术方案设计。其中 Plugin API 是最大的风险点，需要对 core 包进行结构性修改，这部分工作量被严重低估。

建议在启动 Gate 7 实施前：
1. 完成 Plugin API 的详细技术方案设计（含 core 扩展点改造方案）。
2. 完成 React/Vue Wrapper 的技术方案设计。
3. 更新 bundle size 预算。
4. 修正 UI 包的 styles export map。
5. 补充企业级 SDK 缺失的交付物清单（Starter 模板、Changelog、Playground、浏览器兼容矩阵、错误代码参考）。
