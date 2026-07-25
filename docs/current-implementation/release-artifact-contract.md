# Phase 3 Release Artifact Contract

状态：`B0 Implementation Ready / final evidence pending`（contract 已实现，尚未生成 JWord artifact）。

本文件说明 Phase 3 的 package、交付和消费边界。逐字段的机器可验证真源是
`tools/release/package-artifact-contract.json`；本文件不得被解释为真实 publish、
registry-ready、最低浏览器认证或商业 GA 证据。

## 范围和冻结决策

- 12 个 runtime package 当前全部保持 `version: 0.0.0`、`private: true`，不执行
  build、pack、publish 或 registry 操作。
- 11 个 npm-delivery package 与一个 Docker-only `collab-server` 分层交付。
  `collab-server` 只进入 image-internal Node assembly，不进入客户 npm consumer。
- 当前不存在 Professional Editing package；contract 固定为
  `not-present / deferred-to-Phase-4A`。DOCX 和 PDF 属于 Formats。
- `LIC-107B2`（最低浏览器认证）保持 `Deferred/not-run`，只阻断兼容声明和商业
  GA，不阻断本阶段内部 contract 实施。
- 真实版本、法律 license、2FA、dist-tag、changeset、signed provenance 和
  registry access 都是后续 readiness gate；Phase 3 只允许 synthetic rehearsal。

## Package 分类

| package | 分类 | 交付 / registry intent | source access | first-party dependencies | first-party peers |
| --- | --- | --- | --- | --- | --- |
| `@4xian/jword-core` | base | npm-public / public | public | none | none |
| `@4xian/jword-ui` | base | npm-public / public | public | core | none |
| `@4xian/jword-native` | base | npm-public / public | public | core | none |
| `@4xian/jword-devtools` | base | npm-public / public | public | core | none |
| `@4xian/jword-react` | base | npm-public / public | public | core, ui | none |
| `@4xian/jword-vue` | base | npm-public / public | public | core, ui | none |
| `@4xian/jword-docx` | formats | npm-restricted / restricted | restricted | core | license |
| `@4xian/jword-pdf` | formats | npm-restricted / restricted | restricted | core | license |
| `@4xian/jword-license` | license | npm-restricted / restricted | restricted | none | none |
| `@4xian/jword-persistence` | collaboration | npm-restricted / restricted | restricted | core | none |
| `@4xian/jword-collab` | collaboration | npm-restricted / restricted | restricted | core | license |
| `@4xian/jword-collab-server` | docker-only | docker-image-internal / not-published | restricted | persistence | license |

所有 first-party dependency/peer 名称、外部版本、manifest `files`、
`sideEffects` 和 `exports` 均必须与机器 contract 及对应 source manifest 完全一致。
外部依赖不属于本 contract 的 first-party closure；真实 registry 解析仍是外部 gate。

## Artifact 内容和 exports

- 常规 package 只允许 manifest 声明的 `dist` 和可选 `README.md`。不允许 source、
  test、非 declaration TypeScript、source map、构建脚本、测试 signer 或私钥材料。
- native 是唯一 fixture 例外，只允许精确路径
  `fixtures/registry.json`，其内容必须与 `fixtures/native/registry.json` 相同；
  不允许任何第二个 package fixture。
- `.` export 的环境标签为 `node`、`browser`、`types`；License 根入口另加
  `dedicated-worker`。UI 的 `./styles.css` 仅为 `browser`。native、DOCX、PDF 的
  `./worker` 为 `browser`、`dedicated-worker`、`types`。Collab 的 `./experimental`
  为 `node`、`browser`、`types`。server 根入口仅为 `image-node`、`types`。
- 环境到执行 runtime 的固定映射为：`node -> node`、`browser -> vite-browser`、
  `dedicated-worker -> dedicated-worker`、`types -> types`、`image-node -> image-node`。
  未声明的 export/environment 不得被消费矩阵静默跳过。

非 runtime workspace（根目录、`examples/*`、`fixtures/`、`benchmarks/`、
`tools/*`）的 artifact policy 均为 `forbidden`。

## Consumer journeys

每条 journey 必须从指定 package 的精确版本开始，只由动态端口、只读 scoped loopback
registry 解析到同一 run-a tarball bytes；不使用 `file:`、`workspace:`、`link:`、alias、
`overrides` 或 `resolutions`。npm 和 pnpm 各执行一次，且使用独立无凭据配置、cache/store；
B0 只验证仓库外 synthetic `leaf -> base@0.0.0` 预检，不代表 JWord runtime artifact。

| journey | requested packages | first-party closure | runtimes |
| --- | --- | --- | --- |
| `node-exports-types` | 全部 11 个 npm package | none | node, types |
| `vanilla-editorshell-css` | core, devtools, ui | none | vite-browser |
| `react-wrapper` | react | core, ui | vite-browser |
| `vue-wrapper` | vue | core, ui | vite-browser |
| `module-workers` | docx, native, pdf | core, license | vite-browser, dedicated-worker |
| `license-runtime-identity` | collab, license, persistence | core | node, vite-browser, dedicated-worker, types |
| `collab-server-image-node` | collab-server | core, license, persistence | image-node, types |

每个 target 的完整 `{ package, subpath, environment, runtime }` 集合、每个
export/environment 的覆盖关系及闭包顺序只以机器 contract 为准。server journey
属于独立 image assembly，不能混入 customer assembly。

## Size and release boundary

固定八项 size budget：`@4xian/jword-core` 的 `dist/index.js` 为 650000 bytes，
native `fixtures/registry.json` 固定为 1093 bytes、SHA-256
`db07de6b0a63f4d34cec1ad5bbc0f9ba61bbab66a6a7379160c225b1a8a48caa`。
六项 Vanilla limit 固定为 `900000` bytes，以真实完整首屏 859055 bytes 为基线；
统计入口 JS、CSS 和 Vite `modulepreload`，保留 40945 bytes、约 4.77% 余量，
不得按后续观测值自动抬高。
完整 source、limit 和 bundle path 见机器 contract。

后续 B1-B4 必须从同一 clean SHA 生成并绑定 source report、artifact manifest、
test report、run-a inventory、consumer/audit/reproducibility evidence。run-a 是唯一
可供消费和审计的 package artifact；run-b 只能作为最终 verifier 的可比重建原始证据。
任何真实 publish、tag、dist-tag、PR、commit、push 或最低浏览器认证都不由本 contract
授权。
