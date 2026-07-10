# JWord Gate 4 Fixtures

这些 fixture 用于冻结 Gate 4 的起跑线，避免图片、表格、批注、链接和企业文档能力在实现时各自定义一套不可复查的样例。

## Fixture Registry

| Fixture | 当前用途 | 最小可观察契约 |
| --- | --- | --- |
| `image-inline` | 行内图片插入、替换、删除、尺寸调整 | anchor、selection、history、render、error recovery |
| `table-basic` | 基础表格插入、行列操作、单元格文本编辑 | anchor、selection、history、render、error recovery |
| `comment-thread` | 批注添加、回复、解决、重新打开、定位 | anchor、selection、history、render、error recovery |
| `link-basic` | 超链接创建、编辑、allowlist 校验、打开行为 | anchor、selection、history、render、error recovery |
| `find-replace` | 查找结果定位、替换、批量替换 | anchor、selection、history、render、error recovery |
| `header-footer` | 页眉页脚、页码与分页协同 | anchor、selection、history、render、error recovery |
| `paste-html` | Word HTML / 常见 HTML 粘贴和安全降级 | anchor、selection、history、render、error recovery |
| `narrow-viewport` | 窄屏视口分页滚动预览 | anchor、selection、history、render、error recovery |

## Contract Definitions

### `anchor`

- 新能力必须能落到稳定 `AnchorRef` / `RangeRef`，不能退回普通字符 offset。
- 图片、表格、批注、查找替换都要能在编辑后重新定位到原目标，或给出明确失败状态。

### `selection`

- 用户需要能从当前公开 facade 或浏览器钩子里观察到“当前选中了哪个能力对象”。
- 对图片/表格这类非纯文本对象，至少要能从命中点或当前折叠选区还原出稳定 target。

### `history`

- 插入、替换、删除、尺寸调整、解决/重开等用户动作必须进入同一 transaction pipeline。
- `undo` / `redo` 需要恢复对象状态，而不是只恢复局部 UI 文案。

### `render`

- 浏览器里必须能观察到 pending / success / failed 或等价的状态差异。
- 布局结果必须继续服从分页、viewport virtualization 和 page-local hit-test 约束。

### `error recovery`

- 上传失败、协议不允许、目标丢失、替换失败等路径不能破坏 Y.Doc。
- 失败后必须保留可恢复状态，例如 retry token、替换入口或安全降级结果。

## Current Gate 4 Assets

- `media-inline.svg`：图片纵线的最小本地上传样例，供浏览器 E2E 和手工 smoke 复用。

## Layering Rules

- `packages/core` 负责 model / operation / layout / render / command / history。
- `packages/ui` 负责 panel / dialog / sidebar / toolbar entry / upload state。
- `examples/vanilla` 只负责装配、fixture 切换和测试钩子。
