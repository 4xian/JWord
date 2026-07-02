# Gate 0 / Gate 1 代码审查报告

- 审查日期：2026-07-02
- 审查范围：Gate 0（工程基座：根配置、工具链、边界测试）与 Gate 1（权威状态模型与事务：模型层、Operation/Transaction Pipeline、DocumentProjection、Editor Facade、Anchor/Selection/History、错误码）
- 审查依据：`docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`（Gate 0 第 78-119 行、Gate 1 第 121-163 行）与根 `CLAUDE.md` 约束
- 严重程度分级：严重（Critical）/ 主要（Major）/ 次要（Minor）/ 提示（Info）

---

## 一、总体结论

**核心架构不变式整体成立，未发现严重（Critical）级别问题。**

经过对全部写入路径的核查（含 `grep` 全仓验证），确认：

1. **Y.Doc 是唯一可写真源**：未发现第二套可写 Model；`document.ts` 中的直接 store 写入均只在 `pipeline.runMutation()` 闭包内被调用；`transaction.ts` 之外不存在任何直接 `doc.transact()` 调用。
2. **Transaction Pipeline 统一了所有写入路径**：`Editor.executeCommand()` → `pipeline.run()`、`applySyncUpdate()` → `pipeline.applyUpdate()`、`replaceDocument()` → `pipeline.runMutation()`、undo/redo 经 Y.UndoManager 作用于同一 Y.Doc、自动插入经 `executeCommand()`。origin 强制、operation 校验、投影更新、dirty 标记、事件通知齐备。
3. **DocumentProjection 只读**：所有输出经 `Object.freeze`，不保留可写 Yjs 容器引用（但冻结深度有限，见 G1-08）。
4. **History 双层正确**：user / auto-inserter / version-restore 三个独立 scoped UndoManager，remote origin 不进任何 undo 栈；metadata（命令名、selectionBefore/After）在 undo/redo 栈间正确转移。
5. **Anchor 稳定性**：基于 `Y.RelativePosition`，split/merge 迁移逻辑正确；grapheme 用 `Intl.Segmenter` 处理多 code-unit 场景。
6. **Operation fixture 与属性测试**：覆盖全部 8 种 Gate 1 operation，可序列化、可回放。

但存在多处**主要（Major）级别的执行缺口**，主要集中在：边界防线的多层实现不一致（lint 脚本、ESLint 规则、架构测试三者覆盖面不同步）、根依赖提升削弱包边界、构建 external 配置缺失、以及少量运行时缺陷（事件监听器泄漏、跨块选区方向判断错误）。

---

## 二、Gate 0 问题清单

### 主要（Major）

#### G0-01 生产依赖提升到根 package.json，削弱边界强制
- **文件**：`/Users/jian/Desktop/study/JWord/package.json`（第 26-31 行）
- **描述**：根 `dependencies` 包含 `@hocuspocus/server`、`dompurify`、`fontkit`、`jszip`、`pdf-lib`、`yjs`。monorepo 中依赖提升到根意味着所有 workspace 包（包括 `packages/core`）都能在运行时解析这些包，即使它们未出现在子包自己的 package.json 中——边界只剩 lint/测试这一道防线，失去了包管理器层面的天然隔离。
- **修复建议**：将各依赖下沉到实际消费它的子包（`jszip` → docx、`pdf-lib`/`fontkit` → pdf、`dompurify` → ui、`@hocuspocus/server` → collab-server、`yjs` → core），根只保留 devDependencies。

#### G0-02 缺少 pre-commit 钩子，lint/typecheck 不在提交前强制
- **文件**：`.husky/`（缺 `.husky/pre-commit`）
- **描述**：仅有 `commit-msg`（commitlint）钩子生效。`pnpm lint` 与 `pnpm typecheck` 未在提交前执行，违规代码可以先进入仓库、依赖 CI 兜底。
- **修复建议**：新增 `.husky/pre-commit`，内容至少包含 `pnpm lint && pnpm typecheck`。

#### G0-03 ESLint core 禁止导入列表缺 dompurify
- **文件**：`/Users/jian/Desktop/study/JWord/eslint.config.js`（第 7-24 行）
- **描述**：自定义规则 `no-core-forbidden-imports` 覆盖了 14 个禁止导入项，但缺 `dompurify`（UI 包的 DOM 库）。core 若导入 dompurify 将违反"框架无关、无 DOM"约束却不会被该规则拦截。
- **修复建议**：向 `coreForbiddenImports` 数组补充 `'dompurify'`（同时建议补 `@hocuspocus/provider`、`@4xian/jword-persistence`、`@4xian/jword-collab-server`，与 G0-06 对齐）。

#### G0-04 Rollup externals 缺失，第三方库会被打进产物
- **文件**：`/Users/jian/Desktop/study/JWord/rollup.config.mjs`（第 8 行）
- **描述**：`externalPrefixes` 未包含 `dompurify`、`jszip`、`@hocuspocus`。这些根依赖会被 Rollup **打包进 dist 输出**，导致包体积膨胀、运行时可能出现重复实例。
- **修复建议**：补充 `'dompurify'`、`'jszip'`、`'@hocuspocus'` 到 externals；更稳妥的做法是按各包 `dependencies`/`peerDependencies` 动态生成 external 列表。

#### G0-05 Vitest 别名与 tsconfig paths 不同步
- **文件**：`/Users/jian/Desktop/study/JWord/vitest.config.ts`（第 13-25 行）
- **描述**：缺少 `@4xian/jword-ui` 与 `@4xian/jword-native/worker` 两条别名（tsconfig.base.json paths 中存在）。任何测试导入这两个入口将解析失败。
- **修复建议**：补齐两条别名，并注意 `/worker` 子路径别名须排在包主入口别名之前（与现有 `@4xian/jword-collab/experimental` 的处理方式一致）。

#### G0-06 check-boundaries.mjs 的 import 匹配存在绕过通道
- **文件**：`/Users/jian/Desktop/study/JWord/tools/lint/check-boundaries.mjs`（第 24 行）
- **描述**：`importPattern` 只匹配 `import ... from '...'` 静态语法。以下写法均可绕过检查：`export { x } from 'react'`、`export * from 'react'`、副作用导入 `import 'react'`、动态 `import('react')`。禁止列表本身也缺 `@4xian/jword-collab-server`、`@4xian/jword-persistence`、`@hocuspocus/provider`（第 6-23 行）。
- **修复建议**：扩展正则覆盖 `export ... from`、副作用 import 与动态 import()；补齐禁止列表。

#### G0-07 check-package-versions.mjs 只检查根 package.json
- **文件**：`/Users/jian/Desktop/study/JWord/tools/lint/check-package-versions.mjs`（第 3 行）
- **描述**：仅读取根 `package.json`。9 个 workspace 子包的第三方依赖完全未检查——子包中出现 `^`/`~` 版本不会被发现，与"所有依赖必须精确 semver"的工程标准不符。
- **修复建议**：遍历 `packages/*/package.json`（以及 examples/tools），对内部依赖放行 `workspace:` 协议，其余强制精确版本；同时建议检查 `pnpm.overrides` 字段。

#### G0-08 core-boundary.test.ts 禁止列表窄于 lint 脚本
- **文件**：`/Users/jian/Desktop/study/JWord/tests/architecture/core-boundary.test.ts`（第 18-27、29-39 行）
- **描述**：`BANNED_DEPENDENCY_PATTERNS` / `BANNED_IMPORT_PATTERNS` 缺以下项：`jszip`、`fontkit`、`vite`、`playwright`/`@playwright/test`、`@4xian/jword-ui`、`@4xian/jword-collab`、`@4xian/jword-react`、`@4xian/jword-vue`（注：非锚定的 `/pdf/i`、`/docx/i` 已能覆盖 `pdf-lib` 与 docx 相关包，`/hocuspocus/i` 已覆盖 hocuspocus）。若开发者只跑 `pnpm test` 不跑 `pnpm lint`，上述违规依赖会漏过。Gate 0 验收条目"core 边界测试能阻止错误依赖"因此打了折扣。
- **修复建议**：将 `tools/lint/check-boundaries.mjs` 的完整禁止列表镜像到测试中；更优方案是两者共享同一份禁止清单数据源。

#### G0-09 core-boundary.test.ts 缺顶层 DOM 访问检查
- **文件**：`/Users/jian/Desktop/study/JWord/tests/architecture/core-boundary.test.ts`（第 89-136 行）
- **描述**：测试只覆盖 4 项（测试文件位置、禁止依赖、禁止导入、精确版本），没有顶层 DOM 访问检查。该检查目前只存在于 lint 脚本（check-boundaries.mjs 第 90-117 行）与 ESLint 自定义规则 `no-core-top-level-dom` 中——有两道防线但均在 lint 链路，测试链路缺失。
- **修复建议**：向测试补充一条扫描 core 源码顶层 DOM 访问的用例。

#### G0-10 packages/core 无文件行数预算测试
- **文件**：`tests/architecture/`（缺失项）
- **描述**：docx、pdf、collab、collab-server、persistence 等包均有 1000 行/文件预算测试，唯独最大最核心的 `packages/core/src` 没有。实际后果已显现：`document-store.ts` 1155 行、`operation-adapter.ts` 1362 行、`command-builders.ts` 1703 行。
- **修复建议**：新增 `core-file-budget.test.ts`（可先以现状设置宽限值再逐步收紧），并配合 G1-10 的重复代码抽取推动大文件拆分。

### 次要（Minor）

#### G0-11 check-boundaries.mjs 大括号深度启发式可被字符串干扰
- **文件**：`tools/lint/check-boundaries.mjs`（第 112-113 行）
- **描述**：深度计数作用于原始行而非 `stripStringLiterals` 处理后的行。包含不配对大括号的字符串字面量（如 `const x = "{{{"`）会污染深度追踪，造成后续漏报或误报。
- **修复建议**：先剥离字符串字面量再计数，或改用 TypeScript scanner/AST。

#### G0-12 check-boundaries.mjs 声明行判断遗漏 `export interface`
- **文件**：`tools/lint/check-boundaries.mjs`（第 99 行）
- **描述**：`isDeclarationOnly` 判断 `interface ` 开头但未判断 `export interface `，顶层 `export interface Foo { el: HTMLElement }` 会被误报为 DOM 访问。
- **修复建议**：补充 `export interface `、`export type ` 前缀判断。

#### G0-13 check-boundaries.mjs 扫描范围缺口
- **文件**：`tools/lint/check-boundaries.mjs`（第 36、47 行）
- **描述**：`listTypeScriptFiles` 只收集 `.ts` 文件且不跳过 `node_modules`/`dist`（`listFiles` 跳过了但前者没有）。core 目录下的 `.mjs`/`.js` 文件不被扫描；本地存在 dist 时可能误报。
- **修复建议**：统一目录排除逻辑，扩展扫描扩展名至 `.ts/.tsx/.mjs/.js`。

#### G0-14 check-comments.mjs CJK 分段范围未含中文标点
- **文件**：`tools/lint/check-comments.mjs`（第 88 行）
- **描述**：分段正则 `[㐀-鿿]` 不含 CJK 标点（U+3000-303F）与全角形式（U+FF00-FFEF）。含全角逗号的中英混排注释分段位置不准，可能误报或漏报英文单词计数。
- **修复建议**：扩展为 `[　-鿿＀-￯]`。

#### G0-15 ESLint 若干规则强度不足
- **文件**：`/Users/jian/Desktop/study/JWord/eslint.config.js`
- **描述**：(a) 第 25 行 `domIdentifiers` 只拦 `window`/`document`/`HTMLElement`，不含 `navigator`、`localStorage` 等；(b) `@typescript-eslint/no-unused-vars` 沿用 recommended 的 warn 级别而非 error；(c) 第 79-101 行 `file-header` 规则只检查头注释存在性，不校验"职责/边界/协作模块/约束/Specs"结构。
- **修复建议**：按需扩展 DOM 全局名单；将 no-unused-vars 提升为 error；file-header 结构校验可作为后续增强。

#### G0-16 test:e2e 脚本未覆盖全部 Playwright 项目
- **文件**：`/Users/jian/Desktop/study/JWord/package.json`（第 18 行）、`playwright.config.ts`
- **描述**：配置定义了 7 个项目，但 `test:e2e` 只跑 chromium/firefox/webkit/perf-chromium；`ime-chromium`、`visual-chromium`、`collab-chromium` 游离于主流水线之外。
- **修复建议**：补充专用脚本（如 `test:ime`、`test:collab`）或在文档中明确它们的触发方式。

#### G0-17 Vitest 无 coverage 配置
- **文件**：`/Users/jian/Desktop/study/JWord/vitest.config.ts`
- **描述**：无 coverage provider 与阈值配置，覆盖率无门禁。
- **修复建议**：增加 `coverage: { provider: 'v8' }` 及阈值目标。

### 提示（Info）

- **G0-18** `tsconfig.base.json` 第 24 行 `"ignoreDeprecations": "6.0"`：TS 升级时需回顾清理。
- **G0-19** `check-comments.mjs` 第 6 行：`sourceExtensions` 缺 `.cjs`/`.jsx`（当前项目无此类文件，属前瞻项）。
- **G0-20** `gate6-bundle-gate.test.ts` 是"元测试"（只验证脚本存在与内容形状，不执行脚本），实际强制依赖 CI 单独执行。
- **G0-21** `pnpm-workspace.yaml` 第 5 行 `tools/*` 通配：新增 tools 子目录会自动成为 workspace，需留意。

### Gate 0 良好实践（值得肯定）

- TypeScript 配置极为严格：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` + `useUnknownInCatchVariables` + `skipLibCheck: false`。
- 根依赖全部精确 semver，`packageManager` 锁定 `pnpm@9.14.2`，与规范一致。
- ESLint flat config 内联实现三条自定义边界规则（file-header / no-core-top-level-dom / no-core-forbidden-imports），全部 error 级。
- Rollup 按依赖顺序构建、清理旧 dist、构建后归一化相对导入，工程化程度高。
- Playwright 配置 CI/本地差异化（forbidOnly、retries、workers）处理得当。

---

## 三、Gate 1 问题清单

### 主要（Major）

#### G1-01 mount 生命周期：focus/blur 监听器未在 destroy 中移除（已实证）
- **文件**：`/Users/jian/Desktop/study/JWord/packages/core/src/editor/mount-facade-runtime.ts`（注册：第 204-205 行；destroy 清理块：第 273-286 行）
- **描述**：`handleFocus`/`handleBlur` 在 mount 时注册到 `hiddenTextarea`，但 destroy 只移除了 scroll/mousedown/mousemove/mouseup/dblclick/beforeinput/input/keydown/copy/cut/paste/composition* 共 14 个监听器，focus/blur 两个闭包未存储在 `MountedEditorDom` 上、也未被移除。缓解因素：第 293 行 `shell.remove()` 会把 textarea 移出 DOM，泄漏影响限于闭包对 editor 实例的引用链。
- **修复建议**：将两个 handler 存储到 `MountedEditorDom`，在 destroy 中对称调用 `removeEventListener`。

#### G1-02 deleteRange 仅支持同 run 删除
- **文件**：`/Users/jian/Desktop/study/JWord/packages/core/src/operations/operation-adapter.ts`（第 519-524 行）
- **描述**：anchor 与 focus 位于不同 run 时抛 `OPERATION_DELETE_RANGE_CROSS_RUN`。跨 run/跨块删除依赖 command 层（text-editing-runtime.ts）分解为多个 operation，operation 本身在架构上不完整；fixture 回放场景下单条 deleteRange 无法表达跨 run 删除语义。
- **修复建议**：在 adapter 中实现跨 run/跨块删除，或在规范文档中把"command 层负责分解"明确为架构约束并保证分解后多 operation 在同一 transaction 内原子执行。

#### G1-03 跨块/跨 run 选区方向恒为 forward
- **文件**：`/Users/jian/Desktop/study/JWord/packages/core/src/model/selection.ts`（第 120-140 行）
- **描述**：`inferDirection` 仅处理同 run 比较；anchor 与 focus 位于不同 run/block/section 时一律返回 `'forward'`。用户从后往前跨段拖选时方向报告错误，影响光标形态、选区绘制方向及一切依赖 direction 的下游逻辑。
- **修复建议**：按文档序比较（section 序 → block 序 → run 序 → grapheme 序）推断真实方向。

#### G1-04 双重 opaque ID branding 体系并存
- **文件**：`packages/core/src/model/position.ts`（第 19-45 行）与 `packages/core/src/model/document-store.ts`（第 17-31 行）
- **描述**：`Opaque<V,N>`（position.ts）与 `DocumentStoreId<N>`（document-store.ts）两套独立 `unique symbol` brand 并存，产物类型互不兼容。且 `types.ts` 第 113 行 `Resource.id` 是裸 `string`，在 `createResourceRecord`（document-store.ts 第 488 行）中强转为 `ResourceId`，跨模块类型安全被削弱。
- **修复建议**：统一到 position.ts 的 `Opaque` 模式，并让 `types.ts` 层的实体 ID 直接使用品牌类型。

#### G1-05 模块级可变状态：序号计数器与 anchor 注册表
- **文件**：`packages/core/src/operations/command-builders.ts`（第 41 行）、`comment-command-builders.ts`（第 16-18 行）、`link-command-builders.ts`（第 19 行）、`revision-command-builders.ts`（第 17-18 行）；`packages/core/src/model/position.ts`（第 139 行）
- **描述**：(a) 5 个文件共 7 个模块级 `let` 序号计数器，同页多编辑器实例间共享、长生命周期环境下单调增长（有 `usedIds` 碰撞检查兜底，非正确性问题但架构不纯）。(b) `textAnchorRegistry` 为模块级 `WeakMap<Y.Text, Set<AnchorRefState>>`，Set 内 state 强引用 Y.Text，迁移路径有 `unregisterTextAnchorState` 清理，但被放弃而未迁移的 anchor 没有显式清理路径（依赖 Y.Doc 释放后整体 GC）。
- **修复建议**：计数器移入 builder 作用域或由调用方注入分配器；为 anchor 注册表补充随 section/block 删除或 editor destroy 触发的清理 API，并在注释中写明生命周期契约。

#### G1-06 AnchorRefState 可变且被原地迁移
- **文件**：`packages/core/src/model/position.ts`（定义：第 79-89 行；迁移写入：第 544-552 行；`resolveAnchorRef` 副作用：第 351 行）
- **描述**：`AnchorRefState` 字段未加 `readonly`，`migrateTextAnchors*` 原地改写 sectionId/blockId/runId/graphemeIndex/text/relativePosition，`resolveAnchorRef` 也会副作用更新 `graphemeIndex`。对外 `AnchorRef` 是冻结的 opaque 对象、快照读取有防御拷贝，设计上成立，但可变性契约完全未文档化，后续维护者易踩坑。
- **修复建议**：在 `AnchorRefState` 类型上注明"仅迁移路径可变"；`resolveAnchorRef` 注明是带副作用的操作；保持 `readAnchorRefSnapshot` 的防御拷贝。

### 次要（Minor）

#### G1-07 runMutation 恒置 dirty: true
- **文件**：`packages/core/src/operations/transaction.ts`（第 634 行）
- **描述**：`run` 与 `applyUpdate` 路径按 operation 数 / update 字节长度计算 dirty，`runMutation` 却硬编码 `dirty: true`，空变更也会触发脏标记与下游调度。
- **修复建议**：与 `applyUpdate`（第 608 行）一致，改用 `dirty: updateByteLength > 0`。

#### G1-08 projection deepFreeze 冻结深度有限
- **文件**：`packages/core/src/model/projection.ts`（第 452-460 行，`projectProperties` 第 252-258 行）
- **描述**：`deepFreeze` 只冻结对象本身及直接子级。树形结构因每层投影时各自调用 deepFreeze 而实际全冻结，但 `ModelProperties` 的值若含两层以上嵌套对象，深层在运行时仍可变（TS `readonly` 类型是唯一防线）。
- **修复建议**：`projectProperties` 改用真递归冻结，或在类型/文档上约束 properties 值必须为扁平结构。

#### G1-09 applyOperation switch 无穷尽性检查
- **文件**：`packages/core/src/operations/operation-adapter.ts`（第 125-229 行）
- **描述**：switch 无 `default` 分支的 `never` 检查。新增 `OperationKind` 而漏写 adapter 分支时会静默穿透。
- **修复建议**：补 `default: { const _exhaustive: never = operation; throw createJWordError(...) }`。

#### G1-10 operations 目录重复代码
- **文件**：`operation-adapter.ts` / `table-operation-adapter.ts` / `block-record-factory.ts`；`link-command-builders.ts` 与 `command-builders.ts`（第 425-504 行）
- **描述**：(a) `toDocumentStoreJson`、`readPropertyMap`、`readRequiredString`、`setProperties`、`assertBlockKind`、`clonePropertyMap`、`createPropertyMap` 在三个文件中以相同实现重复。(b) link 相关命令构建在两个文件中近乎重复实现，`command-builders.ts` 一边委托 URL 校验一边又自行重建 run-link 命令。
- **修复建议**：抽取共享 `store-utils.ts`；link 命令构建收敛到单一位置。此项与 G0-10（core 文件行数预算）联动处理。

#### G1-11 table adapter 的 findBlockLocation 不递归嵌套表格
- **文件**：`packages/core/src/operations/table-operation-adapter.ts`（第 538-552 行）
- **描述**：本地 `findBlockLocation` 只搜 section 顶层 blocks；主 adapter 有递归进表格单元的 `findBlockLocationInContainer`。表格嵌套在表格单元内时，表格类操作会找不到目标。
- **修复建议**：复用主 adapter 的递归查找，或将本地实现改为递归。

#### G1-12 EditorDocumentModelInput 未从包入口导出
- **文件**：`packages/core/src/index.ts`
- **描述**：`Editor` 接口声明了 `loadDocumentModel(input: EditorDocumentModelInput)`（types.ts 第 338 行），该类型经 runtime.ts（第 28 行）再导出，但 index.ts 未导出——外部消费者拿不到公开方法参数的类型。
- **修复建议**：在 index.ts 导出该类型，并确认 `docs/sdk/public-api.md` 目录同步。

#### G1-13 错误码体系小缺口
- **文件**：`packages/core/src/shared/errors.ts`
- **描述**：32 个错误码中 `OPERATION_IMAGE_TARGET_INVALID` 定义后从未被使用（死码）；selection restore 失败、布局溢出、字体加载失败等路径无专属错误码（当前抛通用 Error 或返回 undefined）。
- **修复建议**：在图片目标校验路径使用该码或删除；按需为上述失败路径补码。

#### G1-14 selection-targets 在 push 后修改 readonly 对象
- **文件**：`packages/core/src/model/selection-targets.ts`（第 167-193 行）
- **描述**：`paragraphTarget` 推入数组后再对 `lastRunOrder`/`lastRunGraphemeLength` 赋值，绕过 `SelectedParagraphTarget` 声明的 `readonly` 契约。
- **修复建议**：遍历完该段落的 runs 后再构造完整对象，或用内部可变类型、返回前冻结。

#### G1-15 段落 list 语义以扁平 key 混入 properties map
- **文件**：`packages/core/src/model/projection.ts`（第 315-327 行）
- **描述**：`listNumberingId`/`listLevel` 与格式属性同层存放在段落 properties Y.Map 中，属性批量写入可能意外覆盖，与 `types.ts` 的 `ParagraphList` 结构化类型不对称。
- **修复建议**：改为 properties 内嵌套 `list` key 或 block record 上的独立字段。

#### G1-16 formatting-state 模块级 defaultFontManager 单例
- **文件**：`packages/core/src/model/formatting-state.ts`（第 81 行）
- **描述**：`createFontManager()` 在模块加载时执行，阻碍按编辑器实例定制字体配置。
- **修复建议**：改为参数注入或惰性初始化。

#### G1-17 mergeBlock 仅支持同容器相邻段落（有意约束但未文档化）
- **文件**：`packages/core/src/operations/operation-adapter.ts`（第 618-620 行）
- **描述**：非相邻块合并抛 `OPERATION_MERGE_BLOCK_NOT_ADJACENT`，且与 deleteRange 不同，command 层无分解兜底。作为 Gate 1 约束可接受，但规范未记载。
- **修复建议**：在规范文档中明确该约束。

### 提示（Info）

- **G1-18** `history.ts` 第 178 行：`new Y.UndoManager(doc, ...)` 追踪整个文档的共享类型（yjs 13.6.30 支持此用法），auto-inserter / version-restore 作用域未来可缩小追踪子树以降内存。
- **G1-19** `operation-property.test.ts` 第 37 行：属性测试使用固定 seed `0x20260511`，可复现但不探索新输入空间；测试头注释已声明这是有意为之。可考虑追加 fast-check 类库的随机探索层。
- **G1-20** `types.ts` 第 12 行与 `document-store.ts` 第 33 行：`DOCUMENT_MODEL_SCHEMA_VERSION` 与 `DOCUMENT_STORE_SCHEMA_VERSION` 双版本常量均为 1，二者关系应文档化。
- **G1-21** OOXML 覆盖缺口（Gate 1 阶段属预期，列出供后续 Gate 参考）：仅 inline 图片（无浮动锚定 drawing）、表格边框无分边样式、无脚注/尾注、页眉页脚仅 ID 引用无内容体、numbering 仅引用无定义体、样式仅 basedOn 占位。

### Gate 1 良好实践（值得肯定）

- **写入路径统一验证通过**：全仓 grep 确认 `transaction.ts` 之外无直接 `doc.transact()`；Editor 全部编辑方法首行 `assertActive()` 守卫，destroy 幂等。
- **Operation schema 远超 Gate 1 最低要求**：8 个必需 operation 之外还有 section/resource/image/table/comment/link/revision 共 20+ 种，全部 JSON 可序列化（不含 AnchorRef/Y.RelativePosition）。
- **Pipeline 诊断完备**：origin 强制校验、operation kind 白名单、`TransactionDiagnostic` 携带 source/字节长度/request/room/client ID 且不泄漏 store/doc 引用。
- **History 三作用域隔离正确**：user（local-user）/ auto-inserter / version-restore 各持独立 UndoManager 与 trackedOrigins；remote-user 不入任何栈；metadata 在 undo/redo 栈间正确转移（`copyMetadataToLatestStackItem`，history.ts 第 212-226 行）；500ms captureTimeout 分组 + executeCommand 前 stopCapturing 防误合并。
- **Anchor 实现扎实**：`Y.RelativePosition` 底座；split 迁移正确处理边界 `assoc > 0` 语义（position.ts 第 362-381 行）；`Intl.Segmenter` grapheme 分段正确处理 emoji/合成字符。
- **测试基础完备**：operation fixture 可序列化回放（覆盖 8 种 operation）、固定 seed 属性测试、transaction 序列化测试、远程 update 应用测试、Gate 2 视觉基线（draw-call SHA-256 哈希）均在位。

---

## 四、修复优先级建议

| 优先级 | 问题编号 | 理由 |
|---|---|---|
| P0（本周） | G1-01、G1-03、G0-04 | 运行时缺陷（监听器泄漏、选区方向错误）与产物正确性（第三方库被打包） |
| P1（Gate 门禁补强） | G0-06、G0-07、G0-08、G0-09、G0-02 | 边界防线多层不一致，存在真实绕过通道；与 Gate 0 验收条目直接相关 |
| P1（依赖治理） | G0-01、G0-03、G0-05 | 依赖下沉 + lint/别名同步，一次性联动修复 |
| P2 | G1-02、G1-04、G1-05、G1-06、G0-10、G1-10 | 架构纯度与可维护性，建议在 Gate 2+ 迭代中安排 |
| P3 | 其余 Minor/Info | 按顺手原则处理 |

---

## 五、验收结论

对照规划文档验收条目：

| 验收项 | 结论 |
|---|---|
| Gate 0：lint/typecheck/test/build/dev 可运行 | 通过（配置齐备且相互佐证） |
| Gate 0：core 边界测试能阻止错误依赖 | **有条件通过**——lint 链路覆盖完整，但测试链路禁止列表偏窄且缺 DOM 检查（G0-08/G0-09），单跑 `pnpm test` 时防线不完整 |
| Gate 1：Y.Doc 唯一可写真源、无第二套 Model | 通过 |
| Gate 1：所有编辑路径经 transaction pipeline | 通过（grep 实证） |
| Gate 1：Projection 稳定派生且只读 | 通过（冻结深度有限但有 TS 类型兜底，见 G1-08） |
| Gate 1：Anchor 不漂移（插入/删除/拆分/合并） | 通过 |
| Gate 1：Operation fixture 可序列化、可回放 | 通过 |
| Gate 1：undo/redo 不丢样式、selection restore 正确 | 通过（跨块选区 direction 缺陷见 G1-03，不影响 undo 语义） |

**总评**：Gate 0/Gate 1 的核心承诺兑现良好，架构不变式经受住了逐文件审查与全仓写入路径核查。问题集中在"防线一致性"（多套边界检查覆盖面不同步）与少量运行时细节缺陷，均可在不动架构的前提下修复。
