# JWord SDK 文档站入口

## 快速开始与核心概念

- [Quickstart](./quickstart.md)：免费基础版安装、创建 editor/UI、保存和打开 `.jword`。
- [Public API](./public-api.md)：当前 package 入口、stable / experimental / internal 分级、diagnostics payload contract。
- [Public API examples](./public-api-examples.md)：可编译的外部式 package 入口示例。

## 格式、插件和 diagnostics

- [.jword native format](./jword-format.md)：原生格式结构、schema、resources、checksum、migration 和 warning。
- [Advanced formats](./advanced-formats.md)：DOCX/PDF paid format 能力、worker、license 和 fixture 验收。
- [Diagnostic codes](./diagnostic-codes.md)：diagnostics registry 生成清单。
- [Support bundle](./support-bundle.md)：商业支持诊断包字段和隐私裁剪。

## 协作、服务端和授权

- [Collaboration](./collaboration.md)：collab client、remote cursor、offline、history、auto-insert、版本握手。
- [Self-host server](./collab-server.md)：版本化 Docker 镜像交付边界、health/readiness、持久化、License secret 和 HTTP/WSS 代理。
- [Licensing](./licensing.md)：edition matrix、feature key、license token、未授权失败和私有 registry。

## 交付与维护

- [Browser support](./browser-support.md)：浏览器支持矩阵与构建 target。
- [Migration](./migration.md)：semver、deprecation、native schema、collab protocol 和 license contract 迁移。
- [Stable E2E matrix](./stable-e2e-matrix.md)：Gate 7 收口矩阵。
- Troubleshooting：优先从 [Diagnostic codes](./diagnostic-codes.md)、[Support bundle](./support-bundle.md)、[Collaboration](./collaboration.md) 和 [Licensing](./licensing.md) 定位。
- FAQ：发布前先准备 B4 canonical run-a，再运行 `: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"`、`node tools/release/gate7-release-dry-run.mjs` 和 `node tools/release/check-gate7-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"`；脚本不会自动 build、pack 或 publish。
