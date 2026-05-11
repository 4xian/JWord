# 06 - Acceptance And Testing

本文件定义验收标准和测试策略。任何功能没有自动化或可复查验收，不算完成。

## 6.1 阶段验收口径

### Alpha

目标：证明最终架构可行。

必须满足：

- 分页 Canvas 架构可运行。
- 本地单人编辑走 Y.Doc transaction。
- 基础输入、格式、撤销重做稳定。
- 1-2 万字文档编辑可用。
- 50 页文档可滚动。
- vanilla demo 可视化验证。

### Beta

目标：证明常用企业文档能力可用。

必须满足：

- 表格、图片、批注可用。
- docx T1 导入导出可用。
- PDF 基础导出可用。
- 保格式粘贴有安全清洗。
- 10 万字、200 页以内 fixture 有性能报告。

### Stable

目标：证明 SDK 可集成和协同可用。

必须满足：

- 协同编辑、离线恢复、远端光标可用。
- 自动插入与手动编辑并发正确。
- React/Vue wrapper 可集成。
- 插件 API 可用。
- 错误诊断和文档站可用。

## 6.2 性能指标

性能指标分阶段生效，不把最终压力目标写成早期承诺。

| 指标 | Alpha | Beta | Stable |
|---|---:|---:|---:|
| 可编辑字符数 | 1-2 万 | 10 万 | 50-100 万压力测试 |
| 页数 | 50 | 200 | 1000 压力测试 |
| 输入热路径 | P95 < 50ms | P95 < 32ms | P95 < 16-32ms |
| INP | P95 < 150ms | P95 < 120ms | P95 < 100ms |
| 长任务 | < 80ms | < 50ms | < 50ms |
| PC 滚动 | 不明显掉帧 | FPS >= 50 | FPS >= 55 |
| 移动预览 | 可阅读 | FPS >= 35 | FPS >= 40 |

docx/PDF 导入导出不承诺固定 1 秒级目标，必须根据 fixture 大小、页数、图片数建立 benchmark。

## 6.3 测试矩阵

### 单元测试

覆盖：

- Document schema。
- Operation serialization。
- AnchorRef / RangeRef。
- Y.Doc adapter。
- Projection。
- Layout line breaking。
- Page breaking。
- Font metrics。
- History metadata。
- OOXML mapping。

### 属性测试

覆盖：

- 随机编辑序列不破坏文档结构。
- Anchor 在插入/删除/合并/拆分后稳定。
- undo/redo roundtrip。
- projection 与 Y.Doc 一致。

### 集成测试

覆盖：

- Input -> Command -> Operation -> Transaction -> Projection -> Layout -> Render。
- docx import -> transaction -> render。
- collab remote update -> projection -> render。
- auto inserter -> transaction -> history policy。

### 浏览器 E2E

覆盖：

- 中文 IME。
- 鼠标选择。
- 键盘选择。
- 复制粘贴。
- toolbar 状态同步。
- undo/redo。
- 表格编辑。
- 图片插入。
- 批注。
- 双窗口协同。

### 视觉回归

覆盖 fixture：

- 英文长文。
- 中文长文。
- 中英混排。
- emoji 与组合字符。
- 多段落样式。
- 表格。
- 图片。
- 页眉页脚。
- 批注。
- PDF 截图对比。

## 6.4 安全验收

必须有测试：

- `<script>` 粘贴。
- `onerror`/`onclick` 属性。
- `javascript:` 链接。
- SVG payload。
- data URL 图片。
- Word HTML 中的 `mso-*` 样式。
- docx 外链图片。
- 不可信插件返回 DOM/HTML。

验收标准：

- 不执行不可信脚本。
- 不产生危险 URL。
- 不绕过 protocol allowlist。
- 清洗结果可复查。
- 安全清洗失败时降级为纯文本。

## 6.5 docx 验收

fixture 分层：

- T1：段落、run 样式、列表、简单表格、inline 图片。
- T2：页眉页脚、分页符、超链接、批注、简单浮动对象。
- post-1.0：脚注尾注、复杂修订、复杂表格、复杂浮动、文本框。

验收方式：

- XML 结构 diff。
- 样式映射 diff。
- Word/WPS/LibreOffice 打开检查。
- 导入后渲染截图。
- 导出后重新导入 roundtrip。

不得用单一“80% 保真度”替代具体 fixture 结果。

## 6.6 协同验收

场景：

- 两个用户同段不同位置输入。
- 两个用户同位置输入。
- 一个用户删除，另一个用户格式化。
- 用户编辑时 AI 自动插入。
- 断网编辑，联网恢复。
- undo 本地操作，不影响 remote/AI。
- 批注 anchor 在远端编辑后稳定。

验收：

- 所有客户端最终状态一致。
- 无重复文本、无丢失文本。
- 光标和批注位置可解释。
- 失败时能保留本地未同步变更。

## 6.7 a11y 验收

必须检查：

- toolbar 键盘可达。
- 菜单和 dialog 有 role/label。
- 编辑区 focus 可见。
- 只读文本可被屏幕阅读器读取。
- aria-live 不过度刷屏。
- 颜色对比满足 WCAG AA。

## 6.8 Bundle 验收

首屏包只包含：

- core 基础运行时。
- UI 基础组件。
- 必要 CSS。

不包含：

- docx parser/exporter。
- PDF。
- collab provider。
- hocuspocus。
- React/Vue wrapper。
- 大字体文件。

所有重包必须 lazy load。

## 6.9 完整性检查

新 specs 必须覆盖旧文档中所有能力：

- L1 基础编辑。
- L2 排版。
- L3 图片/表格/页眉页脚/分页。
- L4 查找替换/批注/修订/目录/超链接。
- L5 协同。
- L6 docx/PDF/粘贴互通。
- L7 自动插入。

若能力延后，必须标为 `post-1.0` 或 `out of scope`。
