# SDK 文档当前实现摘要

## 目标

本目录记录 `docs/sdk` 当前文档与真实代码、测试入口之间的对应关系。后续做 SDK 审查时，以这里和 `docs/sdk` 为当前事实入口，不依赖历史需求或实施计划。

## 文档清单

- [公开 API 与导入边界](./public-api.md)
- [免费 Quickstart](./quickstart.md)
- [.jword 原生格式](./jword-format.md)
- [DOCX/PDF 高级格式](./advanced-formats.md)
- [协作客户端](./collaboration.md)
- [协作服务端](./collab-server.md)
- [授权与收费能力](./licensing.md)
- [诊断码与 support bundle](./diagnostics-and-support.md)
- [浏览器支持与稳定矩阵](./browser-and-e2e.md)
- [迁移与兼容策略](./migration.md)

## 当前事实边界

- SDK 文档在 `docs/sdk` 下，当前实现摘要在本目录下。
- 所有 package manifest 当前仍是 `private: true`；文档描述的是可用源码/API 和本地验收入口，不表示已发布到 registry。
- 公开集成只允许从 package export map 导入，不允许第三方直接使用 `packages/*/src/*`。
- 付费格式与协作能力需要 license/server/worker 层 enforcement；隐藏按钮或 wrapper props 不是授权边界。
- 窄屏只承诺分页滚动预览和工具栏样式适配，不建立独立移动端产品线。
