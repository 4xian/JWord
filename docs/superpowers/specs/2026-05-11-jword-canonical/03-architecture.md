# 03 - Architecture

本文件定义 JWord 的长期架构。实现可以分阶段填充，但不得使用会推翻本架构的临时方案。

## 3.1 分层

```
Host App
  |
Framework Wrapper (React/Vue/Vanilla lifecycle)
  |
JWord UI (toolbar/menu/sidebar/status)
  |
Editor Facade
  |
Command/Input/History/Selection/Plugin
  |
Transaction Pipeline
  |
Y.Doc State  ---- Collab Provider / IndexedDB / Snapshot
  |
DocumentProjection
  |
Layout Engine
  |
Page Canvas Renderer
```

依赖方向只能向下。`Layout` 不能调用 UI，`Render` 不能修改状态，`Wrapper` 不能绕过 Editor Facade 直接操作内部状态。

## 3.2 状态真源

Y.Doc 是唯一权威编辑状态。

本地单人模式也创建本地 Y.Doc，不联网时只是不挂 provider。这样协同、自动插入、历史、离线恢复从第一天共享同一语义。

`DocumentProjection` 是只读投影：

- 从 Y.Doc 派生。
- 提供 layout/render/docx/pdf 使用的稳定快照。
- 可增量更新。
- 不接受直接修改。

禁止出现第二套可写 Model 与 Y.Doc 双向同步。需要类型友好的访问时，只能通过 projection 或 typed adapter。

## 3.3 Transaction Pipeline

所有变更必须经过同一管线：

```
Input / API / Remote / Inserter
  -> Command
  -> Operation
  -> ydoc.transact(origin)
  -> Projection Update
  -> Dirty Mark
  -> Layout Schedule
  -> Page Render
  -> Events
```

要求：

- 每个 transaction 必须有 origin。
- Command 负责语义，Operation 负责最小状态变更。
- History 不直接改 Projection，只触发 Yjs undo/redo。
- Layout 只读取 Projection。
- Events 对外发布稳定 payload，不泄露内部 Yjs 结构。

## 3.4 Operation

Operation 是可序列化、可审计、可测试的编辑意图。

基础 operation：

- `insertText`
- `deleteRange`
- `setRunProperties`
- `setParagraphProperties`
- `splitBlock`
- `mergeBlock`
- `insertBlock`
- `deleteBlock`
- `insertInline`
- `updateTable`
- `addComment`
- `resolveComment`
- `setRevisionState`

每类 operation 必须有：

- schema。
- apply 到 Y.Doc 的 adapter。
- 反向验证或 Y.UndoManager 覆盖策略。
- fixture。
- 错误码。

## 3.5 Anchor 与 Selection

公开类型：

- `AnchorRef`：稳定位置。
- `RangeRef`：稳定范围。
- `SelectionState`：anchor/focus、direction、affinity。

内部实现：

- 文本位置可由 Y.RelativePosition 表达。
- 表格、图片、块级对象可扩展为 block-relative anchor。
- `AnchorRef` 是 opaque 类型，外部不能依赖其内部结构。

使用场景：

- 光标和选区。
- 批注锚点。
- 修订范围。
- 自动插入位置。
- 远端光标。
- docx import/export 中 comment range 和 bookmark 映射。

## 3.6 Layout Engine

Layout 输入：

- `DocumentProjection`
- 页面配置
- 字体度量
- viewport 信息
- dirty range

Layout 输出：

- `DocumentLayout`
- `PageBox`
- `ParagraphBox`
- `LineBox`
- `TextFragment`
- `InlineBox`
- `TableBox`
- hit-test 索引

原则：

- 编辑期即分页。
- 当前编辑页同步优先，后续分页分片计算。
- 分页早停：若页起点未变化，后续页复用。
- 行内文本按 grapheme 处理。
- 布局单位内部使用 twip；渲染时转换为 CSS px。

## 3.7 Canvas Renderer

Renderer 输入 LayoutBox，不读取状态树。

渲染阶段：

1. 计算可视页和 buffer 页。
2. 为每页分配或复用 canvas。
3. 按页收集 LayoutBox。
4. 按视觉层级排序。
5. 在同层级内做安全的状态合并。
6. 绘制 page background、text、inline、table、selection、caret、comments、remote cursors。
7. 回收离屏 canvas 画布。

禁止：

- 全文单 canvas。
- 为了减少 `ctx.font` 切换而打乱跨层级绘制顺序。
- 默认 main/overlay 双 canvas。
- 依赖 drawImage 复用大面积滚动内容作为主优化方案。

## 3.8 Input

输入系统包含：

- hidden textarea。
- IME composition handler。
- keyboard handler。
- pointer/mouse selection。
- clipboard handler。
- focus manager。

要求：

- DOM 只在 `mount()` 后创建。
- composition 事件要处理 Chrome/Safari/Firefox 差异。
- textarea 位置跟随 caret，保证候选框位置正确。
- 粘贴 HTML 必须先安全处理；v1 可先纯文本。
- 输入产生 Command，不直接写状态。

## 3.9 History

History 分两层：

- Y.UndoManager：负责状态回滚。
- JWord History Metadata：保存 command 名称、origin、selection restore、group boundary、用户可读描述。

规则：

- 本地用户操作进入用户 undo。
- remote 操作不进入用户 undo。
- AI/自动插入默认不进入用户 undo。
- `trackUndo: true` 的自动插入进入独立 undo scope 或明确配置的 scope。
- 连续输入按 500ms 左右聚合，但 Enter、格式切换、粘贴、表格操作必须产生 boundary。

## 3.10 docx/PDF Worker

互通任务必须在 worker 中执行：

```
Main Thread
  -> export/import request
  -> Worker
  -> progress / warning / result / error
```

要求：

- 支持 AbortSignal。
- 支持 progress。
- warning 可展示给用户。
- Worker 不访问 DOM。
- 导入结果必须进入 transaction pipeline，不得直接替换内部状态绕过事件。

## 3.11 Collab

协同层提供：

- provider adapter。
- awareness。
- remote cursor。
- offline restore。
- snapshot adapter。
- status event。

服务端约定：

- 房间 ID 由宿主系统提供。
- 鉴权由宿主系统提供。
- update log 和 snapshot 存储由宿主系统实现。
- JWord 提供 hocuspocus 示例，不承诺生产服务。

## 3.12 Plugin

插件只能通过公开 extension point 交互：

- commands。
- menus。
- decorations。
- resource upload。
- persistence。
- collab provider。
- import/export adapter。
- diagnostics。

插件错误不能破坏 core 状态；Editor 必须捕获插件错误并触发 error event。
