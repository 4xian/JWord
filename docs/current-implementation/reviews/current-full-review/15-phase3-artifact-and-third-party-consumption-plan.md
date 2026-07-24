# 统一整改路线 Phase 3：发布 artifact 与第三方消费基线计划

> 文档状态：`Implementation Ready / final evidence pending`（UI测试生命周期修复已以clean SHA `b9b13110a6b5a7829135d583acb2f05c3e668e24`触发远端run `30066733479`；`source-gates`通过，`artifact-build`的direct Vitest已越过上一轮异步错误，Chromium/Firefox为136 passed / 4 skipped。WebKit虽已使用单worker，仍有Gate 2两项、Gate 3 clipboard、keyboard两项和selection共六项被默认30秒测试预算阻断，结果为61 passed / 3 skipped / 6 failed，证伪“仅单worker即可关闭远端争用”的旧判断。当前最小修复只在Phase 3专属WebKit子命令追加`--timeout=60000`并以architecture seam冻结，完整architecture为7/7、本地WebKit为67 passed / 3 skipped；根`test:e2e`、Playwright全局配置、retries、生产代码与Phase 4 JWL1调用方均未修改。远端final pipeline、`artifactSetId`与`finalVerificationSha256`仍pending/not-generated，新clean SHA远端复跑成功前不得进入B5）
>
> 调查日期：2026-07-21
>
> 实施顺序唯一来源：[09-remediation-roadmap.md](09-remediation-roadmap.md)。本文件规划并记录统一路线 Phase 3；不执行真实 publish，也不进入 OEM Phase 3。
>
> 当前计划复审：原始计划第26轮冻结稿 SHA-256 `f9b4a5e0b6bc3793495d1509f97fad334a3370e80014ff9b5e3bc6db2d72a6bc`、B4检查点1冻结稿 SHA-256 `a70c6e3f2e90ec6a83c6531263cbc5b6c2e8e460cf2f5842bc9dfd087f3cbfca`、首轮Core scope修订冻结稿 SHA-256 `cc3ff0ea8bd2d16ace0c5c370c150e4d8926fdec4a92c02eae7d6e4cd0a31c26`与第二轮Core scope修订冻结稿 SHA-256 `eebdd94aa952d69eb0e68a34435381aa8ac94ba4d9382990a3664f53447d5c0d`均已取得Standards、Spec `PASS / 0 finding`。第二轮批准的严格等价快路径已关闭原OOM及两个Node 20同步分段超时，完整direct Vitest和本地扩大门禁均已转绿；远端失败前最后批准快照为1086行、SHA-256 `f19dca0569b8d39c2c6af9c8ea5346aa4854269a6cd987f23ebed156b1fb2a18`，Standards、Spec均为`PASS / 0 finding`。builder失败诊断范围冻结稿为1096行、SHA-256 `fd4f1407c6eabbb0993ed95149a029f4edbb038600416e309dff920e178c98fb`，Standards、Spec均为`PASS / 0 finding`；上一轮implementation/evidence回写冻结稿为1101行、SHA-256 `c3061188cfdfd5728038838ca8adaf83804740b5ec13ffb8a56023e63020c1`，Standards、Spec均为`PASS / 0 finding`。本次worker争用范围修订冻结稿为1112行、SHA-256 `b8f584589cbde10baf26cfb88ddbc2b4794c12f04984932d9d9ddd136c091b47`，Standards、Spec均为`PASS / 0 finding`；implementation/evidence回写冻结稿为1117行、SHA-256 `088ca8ed9c8b9118febecaa6725c2b43450804497a39c9587f1d6de48a9b9836`，Standards、Spec均为`PASS / 0 finding`。最新clean SHA远端pipeline暴露的旧JWL1调用方继续留在OEM Phase 4；B4 Phase 3专属gate与Vanilla本地closure现已完成，当前完整差异仍须取得最终Standards/Spec `PASS / 0 finding`。只有形成并推送新clean SHA、远端final pipeline通过且evidence复审通过后，才可进入B5。
>
> 本轮B4门禁修订遵循“每个Phase只实施本Phase事项”：保留根`pnpm test:e2e`与`pnpm bench`为全仓回归入口且不修改其集合；Phase 3新增独立`pnpm test:e2e:phase3`与`pnpm bench:phase3`，只运行不依赖待迁移JWL1调用方的既有Vanilla回归及Gate 2/Gate 4.5/输入热路径benchmark。DOCX、PDF与Collaboration旧JWL1 happy path继续由OEM Phase 4 `LIC-400`至`LIC-404`迁移并在对应阶段恢复为全仓blocking，不得通过测试trust、临时token、忽略失败或修改后续阶段测试/benchmark绕过。

## 1. 当前结论

Phase 2A、2B、2C 已全部 `Closed`，统一路线的下一边界是 Phase 3。Phase 3 的目标是形成一次 canonical run-a 构建/打包、可校验且可由多个 gate 共同消费的 artifact set，并证明普通空项目只依赖本地 tarball 和公开 package 入口，不依赖 workspace alias、仓库源码或每个 smoke 临时重打的另一批产物。除 run-a 外只允许一个隔离的 run-b 用于 bit-for-bit 可复现性比较；run-b原始bytes必须留给final verifier重算，但不得进入consumer、audit、size、SBOM、provenance或发布输入。路线图明确要求在 clean SHA 上绑定 lockfile/artifact hash，覆盖 Vanilla、React、Vue、CSS、Worker、EditorShell，并在同一 SHA 和 artifact 上完成发布门禁；真实 publish 仍禁用（`docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md:141-160`、`docs/current-implementation/reviews/current-full-review/10-verification-plan.md:336-350`）。

当前仓库已有 dry-run、Gate 5/6/7 third-party smoke、License runtime/identity smoke 和商业包扫描，但还不是统一 Phase 3 基线：

- 12 个 runtime package 都是 `0.0.0`、`private: true`，package 级 `license`、`engines` 均未声明；当前审计也明确把版本、license、registry、2FA、provenance、dist-tag 和 rollback 保留为真实发布阻断项（`package.json:2-9`、`docs/current-implementation/release-metadata-audit.md:8-16`、`docs/current-implementation/release-metadata-audit.md:76-85`）。
- Rollup fresh build 会在每个 package 第一次构建前递归清空 `dist`，输出 ESM 和 `.d.ts`，关闭 declaration map/source map，并把 workspace/runtime dependencies external；因此本轮脏工作区不能执行 build 以免改写既有 tracked artifact（`rollup.config.mjs:60-95`、`rollup.config.mjs:191-208`、`rollup.config.mjs:235-263`、`rollup.config.mjs:303-309`）。
- Gate 7 确实在临时空目录安装 tarball，但脚本自己重新 pack 全部 package，并写入 `pnpm-workspace.yaml` overrides；浏览器只跑 Chromium，React/Vue 仅做类型引用，真实页面只执行 core layout 和 PDF 路径（`tools/release/check-gate7-third-party-smoke.mjs:70-100`、`tools/release/check-gate7-third-party-smoke.mjs:144-207`、`tools/release/check-gate7-third-party-smoke.mjs:318-405`、`tools/release/check-gate7-third-party-smoke.mjs:408-482`、`tools/release/check-gate7-third-party-smoke.mjs:485-541`）。
- Gate 5/6 third-party smoke 同样各自 pack，并用 overrides 修复传递依赖；这些验证不能证明所有消费路径使用同一批 artifact，也不能作为“无需 override”的证据（`tools/release/check-gate5-third-party-smoke.mjs:40-106`、`tools/release/check-gate6-third-party-smoke.mjs:52-127`）。
- License runtime smoke 已支持 `--pack-path`，可以消费外部指定 tarball；License identity smoke 仍自行 pack，并在 pnpm 路径添加 core/persistence overrides（`tools/release/check-license-runtime-smoke.mjs:39-80`、`tools/release/check-license-runtime-smoke.mjs:114-143`、`tools/release/check-license-runtime-identity-smoke.mjs:106-140`、`tools/release/check-license-runtime-identity-smoke.mjs:162-204`）。
- CI 目前只有一个 `verify` job，执行 lint、typecheck、test、build、E2E、visual、bench、size；没有 `test:types`、canonical pack、artifact inventory/hash、同批 consumer、production audit、SBOM、provenance predicate 或 rollback rehearsal job（`.github/workflows/ci.yml:1-57`）。
- 现有 examples 都是仓库开发面：依赖 `workspace:*`，Vite 配置使用源码 alias；它们可以继续做开发/E2E，但不能作为第三方 artifact 证据（`pnpm-workspace.yaml:1-5`、`examples/vanilla/package.json:11-19`、`examples/react/package.json:11-19`、`examples/vue/package.json:11-18`、`examples/docx/package.json:11-20`、`examples/collab/package.json:12-26`）。
- 仓库没有统一 artifact inventory、checksum、SBOM、provenance 或 `.changeset` 目录；当前 dry-run report 只记录 package 结构和 `publish:not-run`，不会绑定 Git SHA、dirty flag、lockfile、构建环境或 tarball hash（`tools/release/gate7-release-dry-run.mjs:12-43`、`docs/current-implementation/release-metadata-audit.md:55-74`）。

因此，Phase 3 不是“再加一个 smoke”，而是把 package 分类、打包输入、artifact identity、consumer 输入和 CI evidence 统一为一个 contract。现有 Gate 5/6 的旧业务成功路径不能替代这个 contract；旧 JWL1及DOCX/PDF/Collaboration授权调用方迁移属于OEM Phase 4，Collaboration deployment/admission与生产数据面属于统一路线Phase 6，不得在Phase 3顺手迁移。

## 2. 调查工作区基线与保护

### 2.1 起始快照

| 项目 | 2026-07-21 只读快照 |
| --- | --- |
| 分支 | `feature/review_questions` |
| HEAD | `a94c6761bfc1b0b57f33074954b7e845edc862e6` |
| `git status --short` 项数 | 203 |
| staged 路径数 | 153 |
| unstaged 路径数 | 62 |
| untracked 路径数 | 20 |
| NUL 分隔 porcelain SHA-256 | `386695e3a307b4a5e4fe226ce6398a406b4d0b622d3862e89a2689d55a4a1d6b` |
| `pnpm-lock.yaml` SHA-256 | `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b` |
| 环境 | Node `v24.14.0`；npm `11.9.0`；pnpm `9.14.2`；Darwin `25.5.0 arm64` |

staged 与 unstaged 数量按各自路径集合统计，同一路径可能同时出现，所以两者不能与 porcelain 总数直接相加。稳定指纹定义为 `git status --porcelain=v1 -z` 原始 bytes 的 SHA-256；实施时还必须分别记录 staged、unstaged、untracked 的 NUL 分隔路径指纹。Phase 2C 最新记录也确认同一 203 项指纹，并明确 Phase 2 已完成、下一边界为 Phase 3（`docs/current-implementation/reviews/current-full-review/10-verification-plan.md:324-334`）。

### 2.2 结束前只读快照

| 项目 | 2026-07-21 结束前观测 |
| --- | --- |
| 分支 / HEAD | `feature/review_questions` / `a94c6761bfc1b0b57f33074954b7e845edc862e6` |
| 全部 `git status --short` | 204 项：203 staged、0 unstaged、1 untracked |
| staged 状态分类 | 139 `M`、61 `A`、3 `D` |
| 唯一 untracked | 本文件 |
| 全部 porcelain SHA-256 | `8191c7e92514065c980da3550f09be37474b8b91b3c3ffee03d93293c8652ff5` |
| 排除本文件后的 porcelain SHA-256 | `4b9ebfc3f9d4daea4e4ef414baebbd6c60bb750346bc67e153ad317f0d71cc1f` |

起始快照之后，既有203项资产的index/worktree边界从153 staged、62 unstaged、20 untracked变为203项全部staged；计划编制轮的只读命令和本文件编辑记录不能确认该迁移的操作者或授权来源，所以当时不得把它解释为本任务完成的资产迁移，也不得据此宣称当时的workspace适合实施。本任务当时的写入范围只包含本文件，其余203项均作为用户资产保护。2026-07-22用户随后明确要求直接在当前分支实施，当前分支HEAD已变为`906ec700246a7020c7f82fd18c17fd50ee3fbcce`；该授权和当前实施边界以下节为准，不反向改写上述历史观测。

### 2.3 计划编制历史与当前实施边界

- 计划编制轮只新增本文件，未修改manifest、lockfile、源码、测试、CI、release script或dist，也未运行build/test/pack/install/audit/browser命令；这是历史事实，不是当前实施轮的命令禁令。
- 2026-07-22用户明确授权直接在当前分支实施，当前分支`feature/review_questions`的HEAD `906ec700246a7020c7f82fd18c17fd50ee3fbcce`固定为Phase 3 implementation base。该授权明确覆盖第2.2节旧dirty workspace所触发的“必须另建clean checkout才能开始B0”阻断，允许在当前checkout按B0至B4检查点1的批准文件表连续实现、运行对应focused/expanded验证并回写本ledger；不要求agent重新迁移或逐路径重演旧203项index状态。
- 该例外不授权reset、checkout、restore、clean、`git add`、commit、push、PR、publish、tag或dist-tag，也不允许覆盖起始已staged的本计划既有内容或untracked执行提示词。每批只允许“implementation base blob + 此前已批准Phase 3 patch + 当前批patch”；按base与批次结束worktree/index差异证明只出现表内Phase 3改动，任何范围外新增或无法解释的既有hunk都hard stop。
- 当前checkout含批准的Phase 3 patch时不称为clean，也不能生成canonical JWord artifact。B2的repo外synthetic fixture可以在该checkout验证builder contract，但production/canonical builder仍必须对其输入repo的tracked、staged及non-ignored untracked状态fail closed；B4检查点2仍需用户另行提供或授权包含B0-B4批准改动的clean commit、远端ref和PR。
- B2只实现builder并用repo外synthetic fixture验证，不生成JWord artifact。canonical artifact/closure只能由B4 final pipeline在包含B0-B4全部批准改动的clean commit或同SHA clean CI checkout执行；创建该commit需要用户另行明确授权，不属于本计划编制或自动实施权限。
- builder 发现任何 tracked、staged 或 untracked 状态时必须 fail closed，不能提供 `--allow-dirty`、`--force` 或忽略 untracked 的逃生参数。

## 3. Phase 3 目标、非目标与退出状态

### 3.1 目标

1. 冻结 12 个 runtime package 及仓库非发布 workspace 的交付分类、允许文件、出口、依赖和实际 packed manifest contract。
2. 从 clean SHA fresh build canonical run-a 一次，在隔离 staging 对每包 dry-run 一次并真实 pack 一次，生成 immutable tarball set、inventory、字节规范固定的`SHA256SUMS`、payload diagnosis hash、环境和构建证据；另允许一个只供比较的隔离 run-b，其12个原始tarball只进入reproducibility handoff供final verifier独立重算，不得成为consumer、audit或发布输入。
3. 所有 dry-run、tarball audit、License、Node、Vite/browser、Vanilla/EditorShell、React、Vue、CSS 和 Worker 验证只读取该 inventory，不自行 build/pack。
4. 在 npm 与 pnpm 空项目中验证无 `workspace:`、无 alias、无 override 的安装；每条旅程显式列出请求包及其 first-party 传递闭包，由只读 loopback scoped registry 按精确版本解析到同一 run-a tarball bytes，验证唯一 runtime、ESM 和类型解析。该证据不冒充真实 registry access、权限、2FA 或 publish readiness。
5. 把 source gate、artifact build、reproducibility、consumer、audit/size/SBOM/provenance predicate/rollback rehearsal和final evidence verifier分离为CI jobs，并通过不可变binding/final record关联。
6. 在 Phase 3 内冻结 version/metadata/registry 分层、2FA、dist-tag、changeset、provenance 和 rollback 政策并形成自动 fail-closed readiness evidence；区分可自动关闭、依赖外部服务和必须人工完成的 gate，内部关单不得冒充正式 publish readiness。

### 3.2 非目标

Phase 3 不实施或顺带修复：

- `LIC-200` 至 `LIC-208`、`LIC-300` 至 `LIC-311`、`LIC-400` 至 `LIC-404`、`LIC-500` 至 `LIC-508`；
- JWL1 删除、DOCX/PDF 授权调用方迁移、Professional Editing 新 package 或能力目录、Formats 正确性修复；
- Collaboration admission、deployment license context、可信 actor、生产数据面或客户直接安装 `collab-server`；
- 未经批准直接写入正式版本、解除 `private:true`、猜测法律 `license` 值，或执行真实 registry publish/access/2FA/dist-tag/changeset/version 操作；Phase 3 仍必须完成这些项目的政策、校验器、synthetic fixture 和离线 rehearsal；
- 法律批准、收费 PoC 批准、Chrome 100/Edge 100/Firefox 128/Safari 16.4 最低版本人工认证。

OEM Phase 3 是 Collaboration deployment/admission，对应统一路线 Phase 6A，不是本文件的 Phase 3（`docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md:11-18`、`docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md:39-45`）。`LIC-107B2` 保持 `Deferred`，只阻断最低浏览器声明和商业 GA，不阻断本阶段内部实施（`docs/current-implementation/reviews/current-full-review/08-issues-register.md:14-19`、`docs/current-implementation/oem-licensing-open-access-implementation-plan.md:1-15`、`docs/current-implementation/oem-licensing-open-access-implementation-plan.md:69-75`）。`CORE-05` 已在 Phase 2C `Closed`；B5 必须删除路线图 Phase 5 的过期列项，不得重新打开（`docs/current-implementation/reviews/current-full-review/08-issues-register.md:30-39`、`docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md:191-196`）。

### 3.3 退出状态

B0-B4只有在B4 final pipeline满足下列artifact条件后才可一起标记`Closed`；随后B5完成文档回写、scope/whitespace和最终双轴复审才可单独标记`Closed`。只有B0-B5全部`Closed`，统一路线Phase 3才可标记`Completed for internal progression`：

- clean SHA 上 source gates 全绿；canonical run-a 只 build 一次、每包 pack 一次，另一个隔离 run-b 只用于 reproducibility；source命令、build、pack和每条direct test/E2E/visual/bench命令后都重新证明tracked、staged及non-ignored untracked状态为空；
- `source-report.json`记录`clean: true`和lint/typecheck/test:types命令结果，`artifact-manifest.json`记录SHA、lock hash、Node/npm/pnpm、OS/arch、builder ID及每个tarball/payload hash，`test-report.json`记录direct Vitest、E2E、visual和bench命令结果；
- 全部 package contract、tarball 内容、secret/test signer/source/source map 扫描通过；
- npm/pnpm 无 override 空项目按旅程显式列出 first-party 传递闭包，并经只读 loopback scoped registry 安装同一 run-a tarball set；Node/Vanilla/EditorShell/React/Vue/CSS/Worker/License matrix 都消费该 artifact set 并通过；
- customer/server两套production audit、artifact size/bundle、双assembly-root SBOM、provenance predicate、可比重建、version/metadata/registry/2FA/dist-tag/changeset readiness 和离线 rollback rehearsal 有结构化证据；
- 五个输入handoff经final verifier交叉校验并生成第六个`final-evidence`；verifier直接读取run-a与reproducibility handoff内run-b的24个原始tarball bytes重算左右hash，record/sidecar与本文件唯一authoritative ledger的artifactSetId/finalVerificationSha256一致，其余七份状态文档只引用该ledger；
- 自动 gate 中没有 skipped、fallback-to-workspace 或重新 pack；
- Standards/Spec 独立复审均为 `PASS / 0 finding`；
- 文档链完成 B5 回写，scope/whitespace/dirty-workspace 检查通过。

该状态不等于 `Verified`、public SDK GA、商业 GA 或 registry-ready。Phase 3 内部完成要求上述 release-readiness 检查按预期 fail closed；法律、真实 registry access、2FA、正式 signed provenance/attestation、dist-tag、正式 changeset/version、最低浏览器认证任一未完成时，真实 publish 继续禁用（`docs/current-implementation/reviews/current-full-review/01-current-conclusion.md:24-44`、`docs/current-implementation/reviews/current-full-review/01-current-conclusion.md:46-56`、`docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md:47-49`）。

## 4. Workspace 与 package 发布分类

### 4.1 Runtime package contract

全部 12 个 package 的逐包核查有以下共同结果：`version: 0.0.0`、`private: true`、`license`/`engines` 缺失；均有 TypeScript `src/`、colocated `test/`、`build`/`test`/`typecheck` scripts，且 `types`/`main`/`module` 都指向 `dist/index.d.ts`/`dist/index.js`。Rollup 统一输出 ESM 和 `.d.ts`，`declarationMap:false`、`sourcemap:false`；tarball 允许 `.d.ts`，拒绝非 declaration TypeScript、测试、未批准 fixture 和 map。native 的 `fixtures/registry.json` 是唯一既有 package-local 兼容资产，Phase 3 保留当前发布契约，只允许该精确路径并将其纳入大小、哈希、内容和秘密扫描；下面逐包列出差异，不能用共同项掩盖例外（`rollup.config.mjs:235-263`、`rollup.config.mjs:267-299`、`tests/architecture/gate45-native-release.test.ts:7-37`、`tools/release/check-native-pack.mjs:38-49`）。

| package | 分类/定位 | 当前发布 metadata | exports / files / sideEffects | runtime dependencies / peers | 仓库依赖与 Phase 3 结论 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `@4xian/jword-core` | Base 公开 SDK intent | `0.0.0`; private; license/engines 无; access public | `.`; `dist`; false | `yjs`; peers 无 | 不依赖 workspace 包；browser/Node ESM tarball 候选 | `packages/core/package.json:2-29` |
| `@4xian/jword-ui` | Base 公开 SDK intent | 同上；access public | `.`、`./styles.css`; `dist`; CSS allowlist | workspace core + `dompurify`; peers 无 | 当前必须由 workspace/link 才能开发；artifact 保留 CSS side effect，EditorShell/Vanilla 实跑 | `packages/ui/package.json:2-33`、`packages/ui/src/editor-shell.ts:61-114` |
| `@4xian/jword-native` | Base 公开 SDK intent | 同上；access public | `.`、`./worker`; `dist`,`fixtures`,`README`; false | workspace core + zip.js/jszip; peers 无 | 保留既有 `fixtures/registry.json` 兼容资产；contract 只允许该精确路径，记录 bytes/hash 并执行与 dist 相同强度的内容和秘密扫描，不允许新增 fixture | `packages/native/package.json:2-37`、`packages/native/fixtures/registry.json:1`、`tests/architecture/gate45-native-release.test.ts:7-37` |
| `@4xian/jword-devtools` | Base 公开可选工具 intent | 同上；access public | `.`; `dist`; false | workspace core; peers 无 | 当前依赖 workspace core；artifact 只允许公开入口和 dist | `packages/devtools/package.json:2-29` |
| `@4xian/jword-react` | Base 公开 wrapper intent | 同上；access public | `.`; `dist`; false | workspace core/ui; peers React/DOM `19.2.7` | 当前依赖 workspace closure；必须真实 `createRoot` mount/unmount | `packages/react/package.json:2-34`、`packages/react/src/index.ts:90-169` |
| `@4xian/jword-vue` | Base 公开 wrapper intent | 同上；access public | `.`; `dist`; false | workspace core/ui; peer Vue `3.5.39` | 当前依赖 workspace closure；必须真实 `createApp` mount/unmount | `packages/vue/package.json:2-33`、`packages/vue/src/index.ts:81-181` |
| `@4xian/jword-docx` | Formats 商业 package intent | 同上；access restricted | `.`、`./worker`; `dist`; false | workspace core + jszip; required peer license | 显式 tarball closure；只验证 artifact/worker 装载和当前 fail-closed contract，授权迁移留 Phase 4 | `packages/docx/package.json:2-40` |
| `@4xian/jword-pdf` | Formats 商业 package intent | 同上；access restricted | `.`、`./worker`; `dist`; false | workspace core + fontkit/pdf-lib/pdfjs; required peer license | 显式 tarball closure；不借 Phase 3 修复 Formats 行为 | `packages/pdf/package.json:2-42` |
| `@4xian/jword-license` | License 商业基础包 intent | 同上；access restricted | `.`; `dist`,`README`; false | noble curves; peers 无 | 不依赖 workspace 包；复用 production golden token，禁止 signer/private key/test trust 入包 | `packages/license/package.json:2-30`、`tools/release/check-license-runtime-smoke.mjs:101-111` |
| `@4xian/jword-persistence` | Collaboration 浏览器 package intent | 同上；access restricted | `.`; `dist`,`README`; false | workspace core + IndexedDB/Yjs; peers 无 | 显式 tarball closure；只做 browser/Node import，不宣称生产协作完成 | `packages/persistence/package.json:2-32` |
| `@4xian/jword-collab` | Collaboration 浏览器 package intent | 同上；access restricted | `.`、`./experimental`; `dist`,`README`; false | workspace core + Hocuspocus/Yjs; required peer license | 显式 tarball closure；只验证浏览器/experimental export，admission/数据面留 Phase 6 | `packages/collab/package.json:2-43` |
| `@4xian/jword-collab-server` | Docker-only 服务端内部 | 同上；source access restricted 仅为审计输入 | `.`; `dist`,`README`; false | workspace persistence + server/Yjs; required peer license | 只生成 image-assembly/internal Node artifact，不进入客户 npm consumer 或 registry 发布集合 | `packages/collab-server/package.json:2-39`、`packages/collab-server/Dockerfile:1`、`docs/current-implementation/oem-licensing-open-access-implementation-plan.md:118-126` |

当前没有独立 Professional Editing package。Phase 3 contract 只能记录 `not-present / deferred-to-Phase-4A`，不能为了填表新建 package。DOCX/PDF 是 Formats，不得冒充 Professional Editing（`docs/current-implementation/oem-licensing-open-access-implementation-plan.md:149-161`）。

当前根lockfile没有全局override配置，workspace importer把内部`workspace:*`解析为`link:`路径；因此仓库开发消费依赖workspace link，而不是可交付artifact。现有third-party smoke再在临时项目额外生成override，这是Phase 3必须移除的第二层仓库耦合（`pnpm-lock.yaml:1-7`、`pnpm-lock.yaml:257-397`、`tools/release/check-gate7-third-party-smoke.mjs:144-207`）。

### 4.2 非 runtime workspace

| 路径/类别 | 定位 | Phase 3 规则 | 证据 |
| --- | --- | --- | --- |
| 根 package | 仓库编排 | 永久 private，不打包；只承载 scripts/toolchain | `package.json:2-25` |
| `examples/*` | 开发示例 | 永久 private，不进入 artifact；可继续 workspace alias，但不能作为 B3 evidence | `pnpm-workspace.yaml:1-5`、`examples/vanilla/package.json:1-20`、`examples/collab/package.json:1-27` |
| `fixtures/` | 测试/兼容资产 | 根 fixtures 和 License fixture 禁止进入 runtime tarball，只能供 repo test/smoke 读取；唯一例外是已在 native 既有发布契约中的 `packages/native/fixtures/registry.json`，禁止把该例外扩展到其他路径或包 | `pnpm-workspace.yaml:1-5`、`tools/release/check-gate5-commercial-pack.mjs:229-239`、`tests/architecture/gate45-native-release.test.ts:7-37` |
| `benchmarks/` | 仓库 benchmark | 永久 private，不发布 | `benchmarks/package.json:1-7` |
| `tools/*` | 仓库维护/测试工具 | 永久 private，不发布；`tools/fixtures` 是唯一带 manifest 的内部工具 package | `pnpm-workspace.yaml:1-5`、`tools/fixtures/package.json:1-8` |

### 4.3 Metadata 冻结决策

- Phase 3 source manifests 和 internal packed manifests 都保持 `version: 0.0.0`、`private: true`；artifactSetId 是内部 rehearsal identity，任何真实 publish 检查都必须拒绝该版本和 private 状态。
- 正式版本策略在 Phase 3 冻结为：11 个 npm-delivery package 使用一个同步 SemVer；Docker-only `collab-server` image tag使用同一 approved version但不进入 npm。真实候选版本是人工批准输入，必须是非 `0.0.0` 的稳定 SemVer；本阶段只用固定 synthetic `1.2.3` fixture 验证 version/changeset/dist-tag 状态机，不把 fixture 值写回 manifest。
- registry 分层在 Phase 3 冻结为：Base 6 包 `public`，License/Formats/Collaboration 浏览器 5 包 `restricted`，`collab-server` 为 `docker-image-internal`。source `publishConfig.access` 只作 contract 输入，不授权真实 registry 操作。
- Phase 3 不猜测法律 `license` 字段。first-party SBOM 使用 `NOASSERTION`，release readiness 显示 `blocked: legal-license-metadata`；只有法律批准后才能另行写入真实值。
- 真实 registry 策略固定要求发布身份启用 2FA/最小权限、candidate 使用 `next`、稳定提升使用 `latest`、signed provenance 可验证、changeset 覆盖全部受同步版本影响的 npm 包、rollback 把 `latest` 恢复到已记录 previous version。B4 对 synthetic registry state 做离线 rehearsal；真实账户检查和命令保持 `not-run/blocked`。
- browser SDK 不添加 `engines.node`。`collab-server` 的 Node runtime 由 Docker image/base image contract 约束；Phase 3 只记录当前 toolchain Node `>=20.19.0`，不把根 `engines` 复制成全部 package 的浏览器支持声明（`package.json:6-9`）。
- source manifest 可以保留仓库 build/test/typecheck scripts；canonical packed manifest 必须由B2实现、B4 final pipeline调用的staging逻辑生成，删除`scripts`、`devDependencies`和所有`workspace:`，只保留运行消费需要的字段。这样商业tarball不携带TypeScript源码、source map、构建脚本文件或可执行lifecycle script。
- canonical packed manifest 把内部 `workspace:*` dependency/peer 精确改写为同一 artifact set 的 `0.0.0`。因为这些版本不在真实 registry，B3 的每条 journey 必须从 contract 计算并在空项目根 manifest 中以精确版本显式列出请求包及其完整 first-party 传递闭包；只读 loopback scoped registry 仅把这些名称/版本映射到同一 run-a tarball bytes。禁止安装全量无关包、override、resolution、alias 或 workspace link。该证据证明同批 tarball 的名称/版本传递解析和消费，不证明真实 registry access、权限、2FA、signed provenance 或 publish readiness；这些仍是外部发布 gate。

## 5. 当前 artifact、CI 与 consumer 缺口

| 领域 | 已有证据 | 缺口与 Phase 3 处理 |
| --- | --- | --- |
| dry-run | 12 包检查 dist、exports、`npm pack --dry-run --json`，且脚本明示不 publish（`tools/release/gate7-release-dry-run.mjs:36-54`、`tools/release/gate7-release-dry-run.mjs:91-146`） | scanner 只统一拒绝 `src`，Gate 5/6 又各自实现更强扫描；B1 合并 contract/内容/秘密扫描 |
| packed manifest | 现有 Gate 5/6/7 smoke分别调用pack并检查`workspace:`残留（`tools/release/check-gate5-third-party-smoke.mjs:40-106`、`tools/release/check-gate6-third-party-smoke.mjs:52-127`、`tools/release/check-gate7-third-party-smoke.mjs:70-207`） | source package scripts/devDependencies语义未形成统一packed contract；B2实现staging，B4 final pipeline执行一次 |
| same artifact | Gate 5/6/7和License identity各自pack（同上及`tools/release/check-license-runtime-identity-smoke.mjs:106-140`） | B4最终inventory为唯一run-a输入；consumer/audit调用build/pack立即失败 |
| empty project | Gate 5/6/7使用临时目录/file tarball，但写入override（`tools/release/check-gate5-third-party-smoke.mjs:66-106`、`tools/release/check-gate6-third-party-smoke.mjs:83-127`、`tools/release/check-gate7-third-party-smoke.mjs:144-207`） | B3 npm/pnpm以精确版本列出最小闭包，经只读loopback scoped registry解析到run-a tarball且无override，并检查registry证据和resolved realpath不在repo |
| Vanilla/EditorShell/CSS | Gate 7页面导入CSS，但真实页面只覆盖core/PDF（`tools/release/check-gate7-third-party-smoke.mjs:318-405`、`tools/release/check-gate7-third-party-smoke.mjs:485-541`） | B3真实`createJWord({host})`、ready、DOM、destroy；CSS export实体和computed load证据 |
| React/Vue | Gate 7只在消费表面引用wrapper API（`tools/release/check-gate7-third-party-smoke.mjs:408-482`） | B3分别真实mount、ready、destroy/unmount；不处理Phase 5动态props finding |
| Worker | Gate 7只引用worker helper，未创建完整module Worker矩阵（`tools/release/check-gate7-third-party-smoke.mjs:408-482`） | B3真实module Worker解析native/docx/pdf子入口，验证启动/稳定fail-closed；不迁移授权调用方 |
| License | runtime smoke可接收pack；identity smoke重新pack并override（`tools/release/check-license-runtime-smoke.mjs:39-80`、`tools/release/check-license-runtime-identity-smoke.mjs:106-204`） | B3全部改为inventory输入，覆盖Node、Vite/current browser、Dedicated Worker、single/duplicate runtime identity |
| Node/ESM | build后有relative-import normalization，Gate 7含Node import/typecheck（`package.json:17-25`、`tools/release/check-gate7-third-party-smoke.mjs:318-405`） | B3对inventory中每个Node-compatible export做`import.meta.resolve`/dynamic import；browser-only行为不在Node执行 |
| Collab server | Gate 7把server列入同一个第三方消费package集合（`tools/release/check-gate7-third-party-smoke.mjs:70-100`） | B3从客户browser matrix移除并做独立image-internal Node检查；B4生成独立`server-image` assembly及audit/list evidence |
| reproducibility | dry-run报告不记录SHA/lock/tarball inventory（`tools/release/gate7-release-dry-run.mjs:12-43`、`docs/current-implementation/release-metadata-audit.md:55-74`） | B2实现manifest/hash逻辑；B4 final pipeline生成run-a/run-b并按同tuple比较raw tarball hash，payload hash只诊断 |
| CI | 单一verify，无artifact handoff且只由PR/main push触发（`.github/workflows/ci.yml:3-57`） | B4增加后续可复跑的`workflow_dispatch`并拆为source/artifact/reproducibility/consumer/audit/final jobs，以binding和upload/download串联；首次最终run固定由用户授权的远端分支PR触发，除非更新后的workflow已存在于default branch，届时才可直接dispatch |
| audit/size | `pnpm audit --prod`只在验证计划；根size会自行build（`docs/current-implementation/reviews/current-full-review/10-verification-plan.md:336-348`、`package.json:17-25`） | B4对customer/server两套assembly分别保存audit/list JSON/hash；artifact size只读tarball和B3 bundle，不执行旧重建路径 |
| secret/source scan | Gate 5扫描source/test/fixture/map和已知signer markers（`tools/release/check-gate5-commercial-pack.mjs:229-239`） | B1单一扫描器覆盖全部12包、source-map文本标记和已知私钥/test signer标记，旧脚本委托它 |
| SBOM/provenance | 现有CI和release audit没有生成步骤（`.github/workflows/ci.yml:12-57`、`docs/current-implementation/release-metadata-audit.md:76-85`） | B4生成SPDX 2.3 SBOM和SLSA v1 in-toto provenance predicate；未签predicate不冒充registry attestation |
| version/changeset | `.changeset` 不存在，dry-run 只报 `manual-draft-required`（`tools/release/gate7-release-dry-run.mjs:57-68`） | B4 固定 lockstep SemVer 与 synthetic changeset rehearsal；真实 candidate 缺 approved version/changeset 时硬阻断 |
| registry/2FA/dist-tag | 只有`publishConfig.access`和人工清单（`docs/current-implementation/release-metadata-audit.md:20-45`、`docs/current-implementation/release-metadata-audit.md:76-85`） | B4按public/restricted/docker-only分层校验，离线演练`next -> latest -> rollback`；真实access/2FA/命令保持blocked/not-run |
| rollback | 只在人工清单提及（`docs/current-implementation/release-metadata-audit.md:76-85`） | B4对immutable hash和本地channel pointer做离线promote/rollback rehearsal；不调用registry |

## 6. 已冻结技术决策

以下决定实施时不得重新选择；若源码证据推翻，必须停止并先修订/复审本计划。

1. `tools/release/package-artifact-contract.json` 是 package 分类、tarball allowlist、export运行环境、journey target映射和Phase 3 size budget的唯一机器可读真源；Gate 5/6/7 不再各自维护 package 数组。每个export entry恰好记录`subpath`、`target`和非空`environments[]`，环境枚举固定为`node`、`browser`、`dedicated-worker`、`types`、`image-node`：11个npm-delivery package的`.`恰好标记`node/browser/types`，其中License根入口额外标记`dedicated-worker`；UI `./styles.css`只标记`browser`，native/docx/pdf `./worker`标记`browser/dedicated-worker/types`，Collab `./experimental`标记`node/browser/types`，`collab-server`的`.`只标记`image-node/types`。每个journey保存精确且非空的`targets[]`，target恰好为`{ package, subpath, environment, runtime }`，引用一个已声明export/environment，且runtime只能是本journey声明值之一；映射固定为`node -> node`、`browser -> vite-browser`、`dedicated-worker -> dedicated-worker`、`types -> types`、`image-node -> image-node`，不得跨类复用标签。B3只能从这些映射生成tuple和逐export证据，禁止在Node动态import CSS或worker-only entry，也禁止把未分类entry静默跳过。

   contract中的budget集合恰好为：一个`core-entry-js`、一个`native-registry`以及`vanilla-first-screen/{npm|pnpm}/{chromium|firefox|webkit}`六项；`core-entry-js.limitBytes`固定为`650000`，六个Vanilla budget的`limitBytes`固定为`700000`，`native-registry.limitBytes`固定等于implementation base中`packages/native/fixtures/registry.json`的实际bytes且同时冻结该文件SHA-256，Phase 3不允许其增长或换内容。`core-entry-js.source`固定为`tarball:@4xian/jword-core/dist/index.js`，对应tarball内部相对path是`dist/index.js`；`native-registry.source`固定为`tarball:@4xian/jword-native/fixtures/registry.json`，对应tarball内部相对path是`fixtures/registry.json`；两者的`sourceSha256`取该单文件原始bytes。install ID固定为`<journey>--<packageManager>`，source/bundle ID固定为`<journey>--<packageManager>--<runtime>--<browser>`；六个Vanilla `source`分别固定为`consumer:bundles/vanilla-editorshell-css--<npm|pnpm>--vite-browser--<chromium|firefox|webkit>/first-screen`且不得重复。每项选择对应bundle目录`index.html`直接引用的首屏JS/CSS regular file集合。实际HTML和全部bundle文件必须在consumer handoff内，`bytes`为该集合总和，`sourceSha256`为按POSIX path排序的`{ path, sha256, bytes }`数组按第7项canonical serialization所得SHA-256。
2. Phase 3 canonical artifact set 包含 11 个 browser/SDK tarball和 1 个 `collab-server` image-internal tarball；后者带 `delivery: docker-image-internal`，所有 customer consumer 自动排除。
3. B2 只接受 clean worktree，输出目录必须由调用者显式传入且位于仓库外；不提供脏状态 override。
4. B2只实现并以synthetic fixture验证builder contract；B4 `artifact-build`调用该builder生成canonical run-a，fresh build一次、每个staging package先dry-run一次再真实pack一次。只有B4独立`artifact-reproducibility` job可按相同入口生成run-b；consumer/audit/size/SBOM/provenance和其他downstream只读run-a，不允许fallback到workspace dist、源码或重新build/pack。
5. packed manifest 由 staging 从 source manifest白名单生成；删除 `scripts`/`devDependencies`，改写内部 workspace dependency/peer 为本 artifact set 的精确版本，拒绝 lifecycle script、`workspace:` 和 repo path。真实 pack 前必须先用 `npm pack --dry-run --json --ignore-scripts` 对 staging 结果核对 contract allowlist。
6. artifact inventory 文件名固定为`artifact-manifest.json`，checksum文件固定为`SHA256SUMS`。tarball内路径先移除npm固定且唯一的`package/`前缀，再按POSIX相对路径处理；只允许regular file，拒绝重复路径、绝对路径、`.`/`..`段、反斜杠、symlink和hardlink。每包`files`是按path ASCII升序排列的`{ path, sha256, bytes }`数组，`sha256`取该regular file原始bytes，`bytes`为非负安全整数；`payloadSha256`的唯一preimage是该完整`files`数组按第7项canonical serialization得到的原始bytes。`tarballFile`必须是完整匹配`^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$`的ASCII basename：禁止`.`、`..`、`/`、`\`和任何部分匹配，且后缀必须恰好为`.tgz`。`SHA256SUMS`按`tarballFile` ASCII升序逐行写入恰好`<64位小写tarball SHA-256><两个ASCII空格><tarballFile><LF>`，UTF-8、无BOM、只使用LF且最后一行后恰好一个LF；空集合、CRLF、缺失/额外空格、无尾随LF、多余空行、顺序变化或非法文件名都失败。`sha256SumsSha256`只取最终`SHA256SUMS`原始bytes的SHA-256。每包同时记录tarball SHA-256、bytes、packed manifest hash、payload hash和上述文件清单。
7. `artifact-manifest.json`固定包含`artifactIdentity`、由其派生的`artifactSetId`和`runMetadata`。`artifactIdentity`是唯一hash preimage，字段恰好为`schemaVersion`、`gitSha`、`lockfileSha256`、`contractSha256`、`builderSha256`、`environment { node, npm, pnpm, os, arch }`、`sha256SumsSha256`和按package name排序的`packages`；每个package恰好记录`name`、`version`、`delivery`、`tarballFile`、`tarballSha256`、`tarballBytes`、`packedManifestSha256`、`payloadSha256`及第6项定义的`files`。`environment.os`唯一取当前Node进程的`process.platform`原始字符串，`environment.arch`唯一取`process.arch`原始字符串；禁止使用`node:os`返回值的再格式化结果、`uname`、runner标签、OS release/kernel版本或大小写转换代替。source report、run-a、run-b、compare和final verifier必须调用`phase3-artifact-utils.mjs`中的同一个environment helper并逐字复用这两个值。canonical serialization递归按ASCII key升序复制object，保留本计划明确冻结的array顺序，再用无replacer/无indent的`JSON.stringify`编码为UTF-8、无BOM、无尾随换行并取SHA-256；所有number必须为非负安全整数。`contractSha256`是`tools/release/package-artifact-contract.json`原始bytes的SHA-256；`builderSha256`的唯一preimage是按POSIX path ASCII升序排列的`tools/release/build-phase3-artifacts.mjs`、`tools/release/phase3-artifact-utils.mjs`、`tools/release/check-package-artifacts.mjs`、`tools/release/normalize-dist-relative-imports.mjs`和`rollup.config.mjs`五项，每项恰好为`{ path, sha256 }`且`sha256`取该文件原始bytes，整个数组再按本项canonical serialization编码并取SHA-256。preimage不含`artifactSetId`本身；`runMetadata`只允许`createdAt`、`executionRunId`和`outputDirectory`，且整体不进入preimage。B4 final run-a及全部下游evidence必须从最终manifest的`artifactIdentity`重算并记录同一run-a ID；B2 synthetic evidence使用fixture ID，禁止记录成JWord artifactSetId。
8. 可比重建 tuple 固定为 Git SHA、lockfile SHA-256、Node、npm、pnpm、OS、arch和builder implementation hash；其中OS/arch必须逐字复用第7项helper产生的`process.platform`/`process.arch`值，不得在compare时重新探测或归一化。npm是实际执行`npm pack`的精确版本，不能由Node版本隐式代替。execution run ID、时间和绝对路径不进入tuple。tuple 不同只报告 `not-comparable`；tuple 相同而raw tarball hash不同即失败，payload hash不能把失败改成通过。
9. npm 与 pnpm 都是 B3 必测；两者都从独立空目录开始，根manifest以精确版本列出journey请求包及contract计算出的first-party闭包，无`overrides`、`resolutions`、workspace file、alias或symlink。每个install启动独立的只读loopback scoped registry：只绑定`127.0.0.1`动态端口，只接受`GET`/`HEAD`，仅为该install的first-party集合返回由已校验packed manifest和原始tarball bytes构造的名称/版本metadata及tarball；metadata中的`dist.tarball`指向本进程loopback URL，`dist.shasum`和`dist.integrity`分别从同一bytes计算SHA-1和SHA-512，未知scope/name/version/path返回404，其他method返回405，不实现publish、dist-tag、auth或写入口。每个项目把无token/credential的独立`.npmrc`作为`NPM_CONFIG_USERCONFIG`，只把first-party scope指向loopback，外部依赖保持官方registry；npm cache和pnpm store都位于该repo外项目内，禁止继承用户registry credential或用全局cache掩盖请求。registry必须记录允许包、metadata/tarball请求计数、unexpected request和write attempt，并保存逐请求canonical transcript及其指向的原始metadata/tarball response bytes；每个允许包两类请求都至少一次，unexpected/write均为0，`registry-evidence.json`的served package恰好为`{ name, version, tarballFile, tarballSha256, tarballShasum, tarballIntegrity, metadataPath, metadataSha256, metadataBytes, metadataRequests, tarballRequests }`，transcript逐项记录`{ order, method, path, status, responseKind, responsePath, responseSha256, responseBytes }`。动态端口是每个install的运行时值，允许出现在`.npmrc`、transcript path、metadata raw response中的`dist.tarball`及由这些raw bytes派生的hash；它不得进入机器contract、静态fixture/golden hash或跨install identity比较。lockfile断言按包管理器分支执行：npm `package-lock.json` 的 first-party entry 必须含该install loopback `resolved` URL和与tarball相同的`integrity`；pnpm v9 `pnpm-lock.yaml` 只要求 first-party resolution 的`integrity`与tarball SHA-512一致，并由无凭据`.npmrc`、transcript中的loopback request path/status/response hash和registry evidence共同证明origin，不要求lockfile持久化动态端口。metadata中的SHA-1 hex由raw response与tarball bytes独立校验，不要求任一lockfile重复保存。安装后root与传递路径只能解析到一个仓库外realpath。B0先用同样约束的synthetic `leaf -> base@0.0.0` 双tarballfixture证明npm/pnpm均通过；任一失败即停止并修订/复审计划，不得回退到override、手工lockfile、workspace/link、全局store预热或外部真实registry。
10. React/Vue 必须真实 mount；Vanilla 必须走 public `createJWord` EditorShell；CSS 必须从 `@4xian/jword-ui/styles.css` 解析。仅 import/typecheck 不算 runtime 通过。
11. Worker 必须从 tarball export 创建真实 module Worker；Phase 3 只证明装载和当前安全失败契约，不把 DOCX/PDF 授权成功迁移提前。
12. License runtime/identity 只使用现有 production golden token和固定时间，不生成 signer、test trust、私钥或新 token。
13. Phase 3 blocking browser E2E只允许执行`pnpm test:e2e:phase3`；该script精确运行`examples/vanilla/tests`下Chromium/Firefox/WebKit非perf用例和`perf-chromium`用例，保持既有已完成能力的浏览器回归，但不得收集`examples/docx/tests`或`examples/collab/tests`。其中Chromium/Firefox保留默认worker和默认timeout，WebKit仅在该Phase 3子命令固定使用`--workers=1 --timeout=60000`，`perf-chromium`仅固定使用`--workers=1`；不得把worker、timeout或retry改成Playwright全局/项目级配置并影响根入口或后续Phase。Phase 3 blocking benchmark只允许执行`pnpm bench:phase3`；该script按固定顺序只运行`gate45-native-benchmark.mjs`、`gate2-render-benchmark.mjs`和`phase4-input-hotpath-benchmark.mjs`，不得运行装配旧JWL1 fixture的`gate5-interop-benchmark.mjs`或`gate6-collab-benchmark.mjs`。根`pnpm test:e2e`与`pnpm bench`保持全仓入口且集合不变；其中直接或间接装配`INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN`的DOCX/PDF/Collaboration happy path、Gate 5/6 legacy business smoke与benchmark均归属OEM Phase 4 `LIC-400`至`LIC-404`调用方迁移，不计入Phase 3绿灯。Phase 3若为诊断另行运行这些用例或benchmark，必须标为`legacy-non-gating`并如实记录失败，只能路由Phase 4，不得修改示例/测试/benchmark、启用`allowInsecureFixtureLicense`、注入测试trust或生成临时token。
14. `source-report.json`字段恰好为`schemaVersion`、`clean`、`gitSha`、`lockfileSha256`、`environment { node, npm, pnpm, os, arch }`和`commands[]`；三个工具版本分别取`node --version`、`npm --version`和`pnpm --version`原始单行值，OS/arch按第7项取同一helper的原始值。commands恰好按`lint/typecheck/test-types`顺序各一项，每项恰好为`{ id, command, exitCode, status }`，command分别为`pnpm lint`、`pnpm typecheck`、`pnpm test:types`，只有`clean: true`、全部`exitCode: 0`和`status: passed`才可继续。`source-report.json.sha256`和`final-verification.json.sha256`统一使用精确sidecar字节格式：UTF-8、无BOM，内容恰好为对应JSON原始bytes的`<64位小写SHA-256><LF>`；禁止无尾随LF、CRLF、前后空白、多余空行、额外字段或文件名。生成端必须写恰好这些bytes，读取端必须先对完整raw bytes做格式校验，再去掉唯一尾随LF并比较hash，禁止使用`trim()`或按空白切分。run-a的`test-report.json`字段恰好为`schemaVersion`、`gitSha`、`artifactSetId`和`commands[]`；commands恰好按`direct-vitest/e2e/visual/bench`顺序各一项，每项复用`{ id, command, exitCode, status }`，command固定为`pnpm exec vitest run --passWithNoTests`、`pnpm test:e2e:phase3`、`pnpm test:visual`、`pnpm bench:phase3`且全部必须为0/passed。artifact-build随后创建固定`artifact-binding.json`，字段恰好为`schemaVersion`、`gitSha`、`lockfileSha256`、`artifactSetId`、`artifactManifestSha256`、`sha256SumsSha256`、`sourceReportSha256`和`testReportSha256`。consumer/audit必须显式接收`--binding`，compare必须显式接收`--left-binding`；三者先计算binding raw bytes SHA-256供evidence记录，再校验其字段、manifest raw hash、从最终manifest重算的ID及checksum，禁止按目录猜测或fallback。final verifier必须语义校验source report的`clean`、`environment`、source命令集合/顺序/command/exit/status，以及test report的`gitSha`、`artifactSetId`和命令集合/顺序/command/exit/status；各job和每条命令后的外部clean checkpoint仍必须按第6节第21项复查，任一变化立即失败。
15. SBOM固定为SPDX 2.3 JSON；依赖图只读取repo外`customer-production`和`server-image`两套assembly各自的`pnpm list --prod --depth Infinity --json`结构化输出、独立lockfile和packed manifests，不手写解析repo `pnpm-lock.yaml`。同一SPDX document必须建立两个不同的assembly root package及其关系，客户root覆盖11个npm-delivery tarball闭包，server root覆盖`collab-server`及contract计算的image-internal first-party闭包；不得合并依赖树或让server依赖伪装成客户依赖。first-party legal license未批准时写`NOASSERTION`。

   provenance文件固定为未包裹DSSE的in-toto Statement：顶层字段恰好为`_type`、`subject`、`predicateType`和`predicate`，其中`_type`固定为`https://in-toto.io/Statement/v1`，`predicateType`固定为`https://slsa.dev/provenance/v1`；`subject`恰好覆盖manifest中的12个tarball及其`sha256`。SLSA v1 `predicate.buildDefinition`恰好包含固定`buildType: urn:jword:build-type:phase3-artifact-set:v1`、`externalParameters`、`internalParameters`和`resolvedDependencies`：external恰好为`{ artifactSetId, gitSha, lockfileSha256, contractSha256 }`，internal恰好为`{ builderSha256, environment }`；四个resolved ResourceDescriptor按URI排序，URI固定为`urn:jword:source:git`、`urn:jword:source:pnpm-lock`、`urn:jword:source:package-artifact-contract`、`urn:jword:source:phase3-builder`，digest分别恰好为`{ gitCommit: gitSha }`和三个`{ sha256: <对应hash> }`。`predicate.runDetails`恰好包含`builder`、`metadata`和`byproducts`：builder恰好为`{ id: urn:jword:builder:phase3-artifacts:v1 }`，metadata恰好为`{ invocationId: executionRunId }`，两个byproduct按URI排序并分别以`urn:jword:artifact:artifact-manifest`、`urn:jword:artifact:sha256sums`及`{ sha256: <对应raw hash> }`绑定manifest/checksum。Statement本身不得添加`signed`、signature或DSSE envelope字段；未签状态只由audit summary的`provenanceAttestationStatus: unsigned`以及readiness中的`signed-provenance: blocked-as-expected`表达，Phase 3只能称“未签 provenance Statement”。
16. `pnpm audit --prod --audit-level high --json`是依赖外部registry的自动gate，必须分别在repo外`customer-production`和`server-image` assembly目录执行；固定`--audit-level high`使low/moderate advisory不进入输出也不导致命令因阈值非零。脚本必须分别按原始bytes保存该high/critical过滤后的JSON stdout，不得称为all-severity完整报告；随后解析有效JSON并独立统计high/critical：任一计数非零为`failed`；registry/网络不可用、无有效JSON、命令非零但没有可归因的high/critical时为`blocked`；只有有效JSON、high/critical均为0且exit 0才通过。任一目录缺少原始报告时B4 closure blocked，不能用另一套assembly的结果替代。两套audit/list原文、摘要、SHA-256和各自assembly manifest/lockfile都进入固定evidence。
17. rollback rehearsal 只操作临时 JSON channel pointer和 immutable artifact hash；脚本内禁止 child process 调用 npm/pnpm publish、dist-tag、git tag/push。
18. Phase 3 不引入 Changesets CLI、不改 source version，但必须用synthetic `1.2.3`输入生成并校验lockstep changeset draft、registry分层、2FA required、`next/latest` dist-tag和rollback command plan。release-candidate模式必须因无人工批准的真实version/changeset/legal/registry/2FA/signed-provenance输入而fail closed；不得把这些Phase 3 readiness项目整体推迟到后续阶段。
19. 当前 Chromium/Firefox/WebKit 自动 smoke 只能证明当前 runner，不得写成最低版本认证。`LIC-107B2` 保持 Deferred。
20. 五个final-verifier输入handoff都使用固定root contract，所有本项和第7/14项中的`schemaVersion`固定为整数`1`：`source-report`只含`source-report.json`和`source-report.json.sha256`；run-a只含`artifact-manifest.json`、`SHA256SUMS`、`artifact-binding.json`、`test-report.json`及manifest列出的12个tarball；consumer、audit和reproducibility使用下表固定payload再各加一个`evidence-manifest.json`。reproducibility handoff内的`run-b-tarballs/<tarballFile>`只供final verifier读取，不得被consumer、audit、size、SBOM、provenance或发布步骤下载/消费，也不得以独立package-artifact名称上传。final verifier递归枚举regular file，拒绝symlink、绝对/`..`路径、重复路径、缺失或额外文件。`evidence-manifest.json`本身不自列，schema恰好为`{ schemaVersion, evidenceType, files }`，`files`按POSIX相对path排序且每项恰好为`{ path, bytes, sha256 }`；用第7项canonical serialization写入并取raw SHA-256。所有JWord生成JSON沿用同一serialization；raw pnpm JSON、assembly lockfile按原bytes留存。final-evidence root只允许`final-verification.json`及其`.sha256` sidecar。

| Handoff | 固定payload（不含`evidence-manifest.json`） | payload schema |
| --- | --- | --- |
| consumer | `consumer-evidence.json`、`journey-evidence.json`、`install-evidence.json`、`export-evidence.json`、`bundle-evidence.json`，以及contract派生的每个`raw/installs/<installId>/`、`raw/sources/<sourceId>/`和`bundles/<bundleId>/`实际文件 | summary使用下述共同envelope；journey恰好为`{ schemaVersion, artifactSetId, journeys[] }`，entry恰好为`{ id, packageManager, packageManagerVersion, runtime, browser, command, status }`，browser固定为`none/chromium/firefox/webkit`之一并按id/packageManager/runtime/browser排序。install恰好为`{ schemaVersion, artifactSetId, installs[] }`，每个contract派生的journey/package-manager install恰好一项，entry恰好为`{ id, journey, packageManager, packageManagerVersion, manifestPath, manifestSha256, lockfilePath, lockfileSha256, dependencyTreePath, dependencyTreeSha256, registryConfigPath, registryConfigSha256, registryEvidencePath, registryEvidenceSha256, registryTranscriptPath, registryTranscriptSha256, requestedPackages[], firstPartyClosure[], resolvedPackages[] }`；`requestedPackages`和`firstPartyClosure`的元素都必须是package name字符串，分别按ASCII升序排列且无重复，前者恰好包含journey直接请求的first-party package，后者恰好包含contract派生的其余first-party传递依赖，两者不相交且并集等于该install的完整first-party集合。六个path必须分别固定为`raw/installs/<installId>/package.json`、同目录内恰好一个`package-lock.json`或`pnpm-lock.yaml`、`dependency-tree.json`、`.npmrc`、`registry-evidence.json`和`registry-transcript.json`；tree文件保存对应`npm ls --all --json`或`pnpm list --depth Infinity --json`的未改写stdout bytes。`.npmrc`只能含官方default registry和动态loopback first-party scoped registry，不得含token、credential或其他配置。registry evidence字段恰好为`{ schemaVersion, mode, host, scope, allowedMethods[], servedPackages[], unexpectedRequests, writeAttempts }`，固定`mode: read-only-loopback`、`host: 127.0.0.1`、`scope: @4xian`、`allowedMethods: [GET, HEAD]`、两个计数为0；served package恰好为`{ name, version, tarballFile, tarballSha256, tarballShasum, tarballIntegrity, metadataPath, metadataSha256, metadataBytes, metadataRequests, tarballRequests }`并按name/version/tarballFile排序，集合恰好等于requested/closure并集且两个request计数均为正整数。registry transcript恰好为`{ schemaVersion, requests[] }`，request按`order`从0连续递增且每项恰好为`{ order, method, path, status, responseKind, responsePath, responseSha256, responseBytes }`；`responseKind`只能是`metadata`或`tarball`，method只能是`GET`/`HEAD`，status必须为200，path必须精确命中本install allowlist，`responsePath`固定在同目录`registry-responses/<responseSha256>.bin`且对应raw bytes必须进入`evidence-manifest.json`。final verifier从metadata raw bytes解析唯一name/version，要求`dist.tarball`等于transcript证明的本install loopback tarball URL，并从对应tarball raw bytes独立重算SHA-1 hex、SHA-512 SRI、SHA-256和bytes，与metadata、served package、transcript及run-a逐项一致；可选HEAD只校验method/path/status及canonical空response raw bytes，不保存或校验response header，payload identity完全由必需GET raw bytes证明。npm lock按第9项校验loopback `resolved`和SHA-512 integrity；pnpm v9 lock只校验SHA-512 integrity并用`.npmrc`、transcript、raw response和registry evidence证明origin，禁止要求pnpm lock保存动态端口；SHA-1只从metadata raw response和对应tarball bytes重算，不属于lockfile字段。resolved package恰好为`{ name, version, realpath }`并按name/version/realpath排序。export恰好为`{ schemaVersion, artifactSetId, exports[] }`，entry恰好为`{ package, subpath, environment, journey, packageManager, runtime, browser, sourcePath, status }`并按这些字段顺序形成唯一键；`sourcePath`必须指向`raw/sources/<sourceId>/`内保存的实际consumer source regular file，final verifier解析该source并确认目标specifier及对应类型/runtime probe存在。bundle恰好为`{ schemaVersion, artifactSetId, bundles[] }`，entry恰好为`{ journey, packageManager, runtime, browser, path, bytes, sha256 }`并按journey/packageManager/runtime/browser/path排序，`path`必须指向consumer handoff内实际regular file。全部原始install文件、registry response bytes、consumer source和bundle bytes都进入`evidence-manifest.json`，禁止只保存临时绝对路径或摘要 |
| audit | `audit-evidence.json`、`raw/customer/pnpm-audit.json`、`raw/customer/pnpm-list-prod.json`、`raw/server/pnpm-audit.json`、`raw/server/pnpm-list-prod.json`、`assemblies/customer/package.json`、`assemblies/customer/pnpm-lock.yaml`、`assemblies/customer/.npmrc`、`assemblies/customer/registry-evidence.json`、`assemblies/customer/registry-transcript.json`、`assemblies/customer/registry-responses/<sha256>.bin`实际文件集合、`assemblies/server/package.json`、`assemblies/server/pnpm-lock.yaml`、`assemblies/server/.npmrc`、`assemblies/server/registry-evidence.json`、`assemblies/server/registry-transcript.json`、`assemblies/server/registry-responses/<sha256>.bin`实际文件集合、`customer-assembly-evidence.json`、`server-assembly-evidence.json`、`size-evidence.json`、`sbom.spdx.json`、`provenance.intoto.json`、`readiness-evidence.json`、`rollback-evidence.json` | summary使用共同envelope；两份assembly evidence均恰好为`{ schemaVersion, artifactSetId, assemblyKind, packageManifestSha256, lockfileSha256, registryConfigSha256, registryEvidenceSha256, registryTranscriptSha256, auditSha256, dependencyListSha256, dependencies[] }`，`assemblyKind`分别固定为`customer-production`和`server-image`，registry config/evidence/transcript/raw response复用consumer的无凭据loopback contract且served集合分别等于11个npm-delivery package和server contract闭包，dependency恰好为`{ name, version, realpath }`并按name/version/realpath排序；size恰好为`{ schemaVersion, artifactSetId, status, budgets[] }`，budget恰好为`{ id, source, sourceSha256, bytes, limitBytes, status }`并按id排序，budget ID集合和limit必须与第1项contract完全一致；readiness恰好为`{ schemaVersion, status, registryOperations, ownerStatus, checks[], commandPlan[] }`，check恰好为`{ id, status, reason }`并按id排序，command恰好为`{ order, action, target, execution }`并按order排序；rollback恰好为`{ schemaVersion, status, beforeSha256, promotedSha256, rolledBackSha256, reason, ownerStatus, realRegistryOperations, commandPlan[] }`且复用同一command schema；SBOM必须包含两个assembly root及各自关系，provenance遵循SLSA v1/in-toto；raw/assembly标准文件按原bytes进入manifest |
| reproducibility | `reproducibility-evidence.json`、`comparison-evidence.json`、`run-b-artifact-manifest.json`、`run-b-SHA256SUMS`及manifest列出的12个`run-b-tarballs/<tarballFile>` | summary使用下述共同envelope；comparison恰好为`{ schemaVersion, leftArtifactSetId, rightArtifactSetId, tuple, packages[] }`，tuple恰好为`{ gitSha, lockfileSha256, node, npm, pnpm, os, arch, builderSha256 }`，package恰好为`{ name, leftTarballSha256, rightTarballSha256, match }`并按name排序；compare运行时重读左右12个raw tarball，按原始bytes把右侧12包复制进固定目录，再由该副本生成右侧manifest/checksums。final verifier必须从handoff副本重算每个右侧hash、payload和`run-b-SHA256SUMS`，不得只信comparison/manifest/checksum三份摘要；除这12个受限原始证据外禁止其他payload |

registry evidence 的精确执行口径以第9项和consumer行的完整schema为准：npm lock只校验loopback`resolved`与SHA-512 integrity，SHA-1 hex只从metadata raw response和对应tarball bytes独立重算。pnpm v9 lock只校验SHA-512 integrity，origin由`.npmrc`、逐请求transcript和raw response共同证明。每个allowlist package必须至少有一条metadata `GET`和tarball `GET`；允许但非必需的`HEAD`仍按完整transcript schema记录method/path/status及canonical空response raw bytes，不保存或校验response header，也不能替代GET raw bytes。customer/server assembly同样分别保存`registry-transcript.json`及`registry-responses/<sha256>.bin`集合；所有新增raw bytes和transcript均进入audit `evidence-manifest.json`。

三份summary的共同envelope字段恰好为`schemaVersion`、`evidenceType`、`gitSha`、`lockfileSha256`、`artifactSetId`、`bindingSha256`、`status`和`checks`。consumer checks恰好为`allJourneysPassed: true`、`installEvidencePassed: true`、`registryEvidencePassed: true`、`exportEvidencePassed: true`、`consumerSourcesVerified: true`、`bundleBytesVerified: true`、`skipped: 0`、`fallbacks: 0`、`repacks: 0`、`workspaceLinks: 0`、`packageAliases: 0`、`overrides: 0`、`repoRealpaths: 0`、`registryWrites: 0`、`unexpectedRegistryRequests: 0`、`firstPartyRegistryFallbacks: 0`、`unexpectedRuntimeInstances: 0`；audit checks恰好为`customerAssemblyPassed: true`、`serverAssemblyPassed: true`、`customerHigh: 0`、`customerCritical: 0`、`serverHigh: 0`、`serverCritical: 0`、`sizePassed: true`、`sbomPassed: true`、`provenancePredicatePassed: true`、`provenanceAttestationStatus: unsigned`、`rollbackPassed: true`、`policyRehearsalPassed: true`、`releaseCandidateStatus: blocked-as-expected`；reproducibility checks恰好为`comparable: true`、`rawTarballsMatch: true`。readiness checks的synthetic ID固定为`lockstep-version`、`changeset-draft`、`registry-layering`、`2fa-required`、`dist-tag-transition`、`rollback-command-plan`、`signed-provenance-requirement`且status均为`passed`；真实candidate ID固定为`private-disabled`、`approved-version`、`legal-license`、`approved-changeset`、`registry-access`、`registry-2fa`、`signed-provenance`、`dist-tag-approval`、`rollback-owner`、`minimum-browser`且status均为`blocked-as-expected`，每个check的`reason`必须非空。readiness顶层固定`status: passed`、`registryOperations: not-run`、`ownerStatus: deferred`；`commandPlan`按order固定为`verify-access/public-and-restricted-registry`、`verify-2fa/release-identity`、`publish-next/11-npm-delivery-packages@1.2.3`、`promote-latest/11-npm-delivery-packages@1.2.3`、`restore-prior/recorded-previous-versions`、`remove-next/11-npm-delivery-packages@1.2.3`，每项`execution: not-run`。rollback顶层固定`status: passed`、`reason: simulated-health-check-failure`、`ownerStatus: deferred`、`realRegistryOperations: disabled`，三个state hash必须是实际64位小写SHA-256；`commandPlan`按order固定为`verify-prior/prior-artifact-set`、`promote-candidate/candidate-artifact-set`、`health-check/synthetic-health-gate`、`restore-prior/prior-artifact-set`、`clear-candidate/candidate-channel`，每项`execution: simulation-only`。final verifier必须从contract派生精确install/journey/export/bundle集合，解析每份原始manifest、lockfile、dependency tree、无凭据registry config/evidence和consumer source，逐项重算并精确比较install的`requestedPackages`、`firstPartyClosure`和两者并集，拒绝非字符串元素、乱序、重复、交集、缺失或额外first-party package；同时核对loopback host/method/scope、served集合、请求计数、first-party lock resolution与run-a tarball bytes，拒绝registry write/unexpected request/外网first-party fallback、workspace/link/alias/override、repo realpath、未执行export、缺失闭包及非预期重复runtime，并重算bundle bytes/hash。还必须逐字段校验两套assembly的固定kind、manifest/lock/registry config/registry evidence/audit/list hash、依赖集合和audit计数，拒绝空/缺失/额外/重复size budget并从run-a/consumer实际文件重算每项source hash/bytes/limit/status，校验provenance的`_type`、`predicateType`、12项subject、`buildDefinition`、四项`resolvedDependencies`、`runDetails`及audit/readiness中的未签状态，以及SBOM、readiness、rollback的固定值、顺序、非空reason和hash。mutation test更新对应`evidence-manifest.json`后仍须覆盖上述语义篡改，不能只证明manifest hash mismatch。summary `status`只有在对应checks和完整handoff manifest都通过时才可为`passed`；真实publish仍blocked。

七个consumer journey及展开规则固定如下；`package-artifact-contract.json`逐项保存同一表及精确`targets[]`，final verifier从该contract派生期望install、tuple、export和bundle集合并与evidence做精确比较，空数组、缺失、额外或重复项均失败。每个journey对npm和pnpm各跑一次；target按第1项固定映射明确指定runtime，`node`/`types`/`image-node`只允许`browser:none`，`vite-browser`/`dedicated-worker`必须分别跑Chromium、Firefox和WebKit。每个contract export/environment至少且只能由该contract声明的journey target展开，export evidence以package/subpath/environment/journey/packageManager/runtime/browser为唯一执行键。每个非Node tuple至少有一个且只允许映射到同tuple的bundle entry；bundle entry以journey/packageManager/runtime/browser/path作为唯一键，final verifier必须从handoff内实际consumer source和bundle regular file重算bytes和SHA-256。

| journey id | runtime | 必需目标 |
| --- | --- | --- |
| `node-exports-types` | `node`、`types` | Node子运行逐一解析11个npm-delivery package中全部标记`node`的根/子入口；types子运行逐一解析这11包全部标记`types`的根/子入口；CSS和worker-only entry不得进入Node动态import |
| `vanilla-editorshell-css` | `vite-browser` | core、ui、devtools根入口，public `createJWord` EditorShell和`@4xian/jword-ui/styles.css` |
| `react-wrapper` | `vite-browser` | react根入口，真实`createRoot` mount/unmount；core/ui browser入口由Vanilla journey直接覆盖 |
| `vue-wrapper` | `vite-browser` | vue根入口，真实`createApp` mount/unmount；core/ui browser入口由Vanilla journey直接覆盖 |
| `module-workers` | `vite-browser`、`dedicated-worker` | native/docx/pdf各自根入口和`./worker`，以及当前安全失败契约 |
| `license-runtime-identity` | `node`、`vite-browser`、`dedicated-worker` | license、persistence、collab根入口及Collab `./experimental`；覆盖golden token、single/duplicate runtime identity |
| `collab-server-image-node` | `image-node`、`types` | 只在独立server consumer解析`collab-server`根export及类型，不进入客户browser project；B4据此建立独立server-image assembly |

reproducibility期望集合恰好等于run-a manifest的12个package name。compare必须对左右tarball bytes重算SHA-256，把run-b原始bytes复制到受限handoff后再生成comparison、run-b manifest/checksums；final verifier拒绝空/缺失/额外/重复package，重算全部run-a左hash及handoff内全部run-b右hash/payload/checksum，并要求右hash同时等于原始bytes、comparison、run-b manifest和run-b checksums且每项`match: true`。architecture mutation test固定覆盖空数组、删除一项、重复项、额外项，以及在同步改写comparison/manifest/checksum后单独篡改run-b tarball bytes仍失败。

21. Phase 3的clean断言固定执行`git status --porcelain=v1 -z --untracked-files=all`并要求stdout为零bytes；该命令覆盖staged、unstaged和全部non-ignored untracked路径，Git ignored的dist、Playwright report等生成物不计入，但不得新增额外exclude、pathspec、`--untracked-files=no`或自动restore/clean。`source-report`在lint、typecheck、test:types每条命令后及写report前检查；canonical/repro builder在启动时、build+normalize后且创建staging/pack前、全部dry-run/pack/scanner后检查；canonical builder再在direct Vitest、E2E、visual、bench每条命令后及写`test-report.json`/binding前检查。B3 consumer与B4 audit/final job在各自frozen install后、每个顶层runner返回后和上传handoff前至少再检查一次。任一非空状态立即失败，保留诊断路径但不输出文件内容，不得生成或上传新的report、binding或evidence；已生成的本次repo外临时输出作废，不能成为下游输入。
22. Gate 5/6/7 third-party兼容入口的Phase 3可运行CLI统一要求显式`--artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"`；每处当前命令文档必须先写`: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"`，所以复制执行时缺输入会稳定失败而不是误用workspace。无参数调用必须输出usage并非零退出，不允许隐式build/pack或目录猜测。所有当前把无参数命令写成发布/验收步骤的SDK、current-implementation、OEM和README文档必须在B3同步改为该精确参数形式，并说明run-a由B4 canonical builder产生；对应architecture tests必须断言guard、两个完整参数和无参数fail-closed。历史结果可保留为带日期的旧证据，但不能继续作为当前可执行指引。
23. `check-native-pack.mjs`、Gate 5/6 commercial pack checker和`gate7-release-dry-run.mjs`及其architecture tests统一固定为两类都不pack的扫描模式：B1/default/source模式只读source manifest/contract并对repo外synthetic tarball调用scanner，不对JWord package执行任何dry-run/pack；artifact/inventory模式只读调用方显式传入的manifest及其tarball，B2回归使用synthetic artifact manifest，B4 direct Vitest使用真实run-a manifest。无环境变量的focused/默认路径、B2 synthetic inventory路径和设置`JWORD_PHASE3_ARTIFACT_MANIFEST`的B4路径都必须证明`npm pack`、`pnpm pack`及`npm pack --dry-run`子进程调用数为0；真实JWord dry-run/pack只能由B4 canonical builder每包各执行一次。

## 7. 文件级实施清单

### 7.1 新增文件

| 文件 | 批次 | 单一职责 |
| --- | --- | --- |
| `docs/current-implementation/release-artifact-contract.md` | B0 | 人类可读 package/delivery/artifact contract |
| `tools/release/package-artifact-contract.json` | B0 | 12 包机器可读分类、逐export环境标签、allowlist、dependency policy和固定size budget |
| `tests/architecture/phase3-package-artifact-contract.test.ts` | B0/B1 | package分类、journey、native、size contract与后续source/packed manifest、scanner最少回归 |
| `tests/architecture/phase3-package-artifact-registry.test.ts` | B0 | scoped synthetic npm/pnpm loopback closure与完整registry evidence回归 |
| `tools/release/check-package-artifacts.mjs` | B1 | 单一 manifest/tarball/file/content scanner |
| `tools/release/phase3-artifact-utils.mjs` | B2/B4 | B2提供canonical JSON、hash、inventory读取/校验共享函数；B4由唯一`TEST_COMMANDS`常量同时冻结builder执行与final verifier校验的四条命令，只把E2E/benchmark定义改为Phase 3专属script，保持id、顺序、direct Vitest和visual不变 |
| `tools/release/build-phase3-artifacts.mjs` | B2/B4 | B2实现source report、clean检查、canonical/repro build、staging pack、inventory/checksum；B4在fixed command非零且既有post-command clean断言通过时转发已捕获的stdout/stderr并输出安全退出元数据；四条命令继续只通过`testCommandDefinitions()`消费共享定义，不在builder重复硬编码 |
| `tools/release/compare-phase3-artifacts.mjs` | B2/B4 | B2实现tuple与两次构建tarball/payload比较；B4补齐受限reproducibility root的固定payload和`evidence-manifest.json` |
| `tests/architecture/phase3-artifact-build.test.ts` | B2/B4 | B2锁定builder fail-closed与inventory schema；B4锁定reproducibility固定payload、`evidence-manifest.json`及direct gate失败诊断的真实synthetic CLI seam |
| `examples/vanilla/tests/gate2-test-contract.ts` | B4 Vanilla closure | 集中冻结当前生产分页与Gate 2权威benchmark共同验证的53页测试契约，供同一长文夹具回归消费 |
| `tools/release/check-phase3-third-party-consumers.mjs` | B3 | 从 inventory 编排 npm/pnpm/Node/browser/License matrix |
| `tools/release/phase3-consumer-projects.mjs` | B3 | 生成空项目源码，避免主脚本超过文件预算 |
| `tests/architecture/phase3-third-party-consumers.test.ts` | B3 | 禁止 repack/override/fallback 并锁定真实 wrapper/worker 路径 |
| `tools/release/check-phase3-release-gates.mjs` | B4 | 汇总audit、size、SBOM、provenance、version/registry readiness和rollback evidence |
| `tools/release/verify-phase3-final-evidence.mjs` | B4 | 交叉校验run-a与source/consumer/audit/repro evidence，生成或复核final record |
| `tools/release/phase3-release-policy-utils.mjs` | B4 | 从contract与release policy严格校验readiness checks/command plan及rollback health清理证据 |
| `tools/release/check-phase3-artifact-size.mjs` | B4 | 只读 tarball/B3 bundle 体积门禁 |
| `tools/release/generate-phase3-sbom.mjs` | B4 | 生成 SPDX 2.3 JSON |
| `tools/release/generate-phase3-provenance.mjs` | B4 | 生成未签 SLSA v1 provenance predicate |
| `tools/release/rehearse-phase3-rollback.mjs` | B4 | 离线 channel pointer promote/rollback 状态机 |
| `fixtures/release/rollback-state.json` | B4 | 不进入 package 的离线 rollback fixture |
| `tests/architecture/phase3-release-gates.test.ts` | B4 | CI/release script 安全与结构化 evidence 回归 |

### 7.2 修改文件

| 文件 | 批次 | 精确修改 |
| --- | --- | --- |
| `tools/release/check-native-pack.mjs` | B1/B2 | 默认只做source/synthetic检查，artifact模式只读显式inventory；委托统一scanner，两种模式都禁止pack |
| `tools/release/check-gate5-commercial-pack.mjs` | B1/B2 | 默认只做source/synthetic检查，artifact模式只读显式inventory；保留Gate 5 lazy-loading特有检查，两种模式都禁止pack |
| `tools/release/check-gate6-commercial-pack.mjs` | B1/B2 | 默认只做source/synthetic检查，artifact模式只读显式inventory；委托统一scanner并保留Gate 6特有检查，两种模式都禁止pack |
| `tools/release/gate7-release-dry-run.mjs` | B1/B2 | default/source只读source manifest、contract和显式synthetic tarball，artifact/inventory只读调用方显式inventory及其tarball；两种模式都禁止build、pack和fallback，三类pack子进程调用数均为0 |
| `tests/architecture/gate45-native-release.test.ts` | B1/B2 | 保留native既有fixture发布契约，锁定default/source与artifact/inventory两种无pack路径，并断言统一scanner只允许精确`fixtures/registry.json` |
| `tests/architecture/gate5-commercial-readiness.test.ts` | B1-B3 | 锁定default/source与artifact/inventory两种无pack路径；legacy smoke标记non-gating |
| `tests/architecture/gate6-commercial-readiness.test.ts` | B3 | 同步Gate 6公开及current-implementation Collab/Collab Server文档中的inventory/binding CLI契约 |
| `tests/architecture/gate6-package-exports.test.ts` | B1-B3 | 锁定Gate 6 default/source与artifact/inventory两种无pack路径，统一scanner和Docker-only consumer边界 |
| `tests/architecture/gate7-release-readiness.test.ts` | B1-B3 | 锁定dry-run default/source与artifact/inventory两种无pack路径，inventory-only、无override、真实consumer matrix |
| `tests/architecture/gate7-public-api-catalog.test.ts` | B3 | SDK及current-implementation public API文档只接受带manifest/binding的可运行命令 |
| `tests/architecture/gate7-sdk-docs.test.ts` | B3 | SDK/current-implementation命令、参数和run-a前置条件同步回归，并覆盖第7.2节全部当前验收文档 |
| `package.json` | B2/B4 | 新增Phase 3 builder/consumer/release gate scripts；B4新增`test:e2e:phase3`，值精确为`playwright test examples/vanilla/tests --project=chromium --project=firefox --pass-with-no-tests && playwright test examples/vanilla/tests --project=webkit --workers=1 --timeout=60000 --pass-with-no-tests && playwright test examples/vanilla/tests --project=perf-chromium --workers=1 --pass-with-no-tests`；新增`bench:phase3`，值精确为`node benchmarks/gate45-native-benchmark.mjs && node benchmarks/gate2-render-benchmark.mjs && node benchmarks/phase4-input-hotpath-benchmark.mjs`。不改既有`test:e2e`、`bench`、version或dependencies |
| `vitest.config.ts` | B4 | 仅将`test.maxWorkers`从`4`改为`2`，保持其余配置和命令不变 |
| `tools/release/check-gate7-third-party-smoke.mjs` | B3 | 变为 inventory-only 兼容入口并委托 Phase 3 consumer；禁止 pack |
| `tools/release/check-license-runtime-smoke.mjs` | B3 | 统一支持 `--artifact-manifest`，保留现有 `--pack-path` 兼容 |
| `tools/release/check-license-runtime-identity-smoke.mjs` | B3 | 新增 inventory 输入，删除内部 pack/override 路径 |
| `tools/release/check-gate5-third-party-smoke.mjs` | B3 | 接受 inventory，标明 `legacy-non-gating`；不重新 pack |
| `tools/release/check-gate6-third-party-smoke.mjs` | B3 | 接受 inventory，标明 `legacy-non-gating`；不重新 pack |
| `docs/sdk/stable-e2e-matrix.md` | B3 | release/no-alias命令改为显式run-a root guard、manifest/binding并说明canonical run-a前置条件 |
| `docs/sdk/index.md` | B3 | FAQ改为可运行的inventory/binding命令，不再暗示脚本自行pack |
| `docs/sdk/licensing.md` | B3 | 发布前License验收命令消费指定run-a，不自行build/pack |
| `docs/sdk/migration.md` | B3 | no-alias命令补齐manifest/binding参数 |
| `docs/sdk/public-api.md` | B3 | Stable E2E入口补齐参数与run-a来源 |
| `docs/current-implementation/sdk/browser-and-e2e.md` | B3 | current implementation矩阵同步新CLI契约 |
| `docs/current-implementation/sdk/advanced-formats.md` | B3 | Gate 5 third-party验收入口补齐run-a guard、manifest/binding参数和canonical前置条件 |
| `docs/current-implementation/sdk/public-api.md` | B3 | Gate 7 third-party验收入口补齐run-a guard、manifest/binding参数和canonical前置条件 |
| `docs/current-implementation/sdk/collab-server.md` | B3 | Gate 6 third-party验收入口补齐run-a guard、manifest/binding参数和canonical前置条件 |
| `docs/current-implementation/packages/collab.md` | B3 | Gate 6 third-party命令补齐manifest/binding参数 |
| `docs/current-implementation/packages/collab-server.md` | B3 | Gate 6 third-party验收入口补齐run-a guard、manifest/binding参数和canonical前置条件 |
| `docs/current-implementation/oem-licensing-open-access-implementation-plan.md` | B3 | OEM验证清单中的Gate 5/6/7命令全部改为inventory/binding输入 |
| `packages/collab/README.md` | B3 | Gate 6示例命令消费指定run-a |
| `examples/collab/README.md` | B3 | Gate 6示例命令消费指定run-a |
| `packages/core/src/shared/grapheme.ts` | B4 | 先把可证明为单grapheme的可打印ASCII、CJK Extension A和BMP CJK Unified Ideograph纯文本按UTF-16单元线性投影；其他输入仍把`Intl.Segmenter`结果逐项投影，避免spread同时保留全部原生`SegmentData`。不改变公开grapheme边界语义或API |
| `.github/workflows/ci.yml` | B4 | 增加供default branch后续复跑的`workflow_dispatch`并拆分source/artifact/consumer/audit/repro/final jobs；首次最终run走用户授权的远端分支PR，保留Phase 3专属E2E/benchmark及visual为artifact-build阻断gate；run-a是唯一可被consumer/audit使用的package-artifact handoff，run-b tarball只作为reproducibility handoff内受限原始证据供final读取 |
| `tools/visual/run-visual.mjs` | B4 | 设置Phase 3 manifest时校验run-a并跳过内部build；默认入口保持现状 |
| `tests/gate2-fixture.test.ts` | B4 | 设置Phase 3 manifest时Core dist缺失直接失败，禁止测试内部build；默认测试入口保留现有按需build兼容行为 |
| `examples/vanilla/tests/fixtures/test-fixture.ts` | B4 Vanilla closure | 按公开`createJWordUi` seam装配live region、assistive mirror、heading outline与revisions hosts/plugins |
| `examples/vanilla/tests/gate2.e2e.ts` | B4 Vanilla closure | 消费共享53页Gate 2测试契约，不改变分页生产实现 |
| `examples/vanilla/tests/gate2.perf.e2e.ts` | B4 Vanilla closure | 消费共享53页Gate 2测试契约，保留现有性能阈值 |
| `examples/vanilla/tests/gate3-input-helpers.ts` | B4 Vanilla closure | 消费共享页数契约，并在计算pointer client point前把目标页滚入editor viewport |
| `examples/vanilla/tests/gate3-input-keyboard.e2e.ts` | B4 Vanilla closure | page whitespace键盘语义改用Alpha小样例，保持同一公开输入行为 |
| `examples/vanilla/tests/gate3-toolbar-helpers.ts` | B4 Vanilla closure | 提供专业toolbar tab与内建page preset共享测试辅助，不新增生产入口 |
| `examples/vanilla/tests/gate3-toolbar-paragraph.e2e.ts` | B4 Vanilla closure | 按当前内建page preset与专业toolbar tab验证段落/页面行为 |
| `examples/vanilla/tests/gate3.perf.e2e.ts` | B4 Vanilla closure | 消费共享53页Gate 2测试契约，阈值保持不变 |
| `examples/vanilla/tests/gate4-a11y.e2e.ts` | B4 Vanilla closure | 在真实tab显隐语义下验证table/comment/find控件与a11y |
| `examples/vanilla/tests/gate4-comments-link.e2e.ts` | B4 Vanilla closure | 切换真实insert tab，并保留链接overlay toggle public seam |
| `examples/vanilla/tests/gate4-header-footer.e2e.ts` | B4 Vanilla closure | 切换真实page tab后验证header/footer行为 |
| `examples/vanilla/tests/gate4-media.e2e.ts` | B4 Vanilla closure | 切换真实insert tab，并相对聚焦前实际host几何验证滚动稳定性 |
| `examples/vanilla/tests/gate4-readonly.e2e.ts` | B4 Vanilla closure | 使用当前fixture路由、toolbar selector与tab显隐验证readonly契约 |
| `examples/vanilla/tests/gate4-structure-find.e2e.ts` | B4 Vanilla closure | 使用当前outline sidebar与tools tab验证目录、查找替换 |
| `examples/vanilla/tests/gate4-table.e2e.ts` | B4 Vanilla closure | 使用真实table/home tab，并按viewport上限验证dialog宽度 |
| `examples/vanilla/tests/gate7-plugin-error.e2e.ts` | B4 Vanilla closure | 插件错误后通过共享内建page preset辅助验证UI仍可操作 |
| `examples/vanilla/tests/phase4-memory.perf.e2e.ts` | B4 Vanilla closure | 仅同步其在Phase 3 perf集合中消费的共享53页长文契约 |
| `packages/ui/src/link/controller.ts` | B4 Vanilla closure | 将链接anchor overlay视为内部交互，避免pointerdown关闭后click重新打开 |
| `packages/ui/src/selection-actions/controller.ts` | B4 Vanilla closure | 冻结浮动工具栏时与正常渲染统一使用`overlayHost`坐标系 |
| `docs/current-implementation/reviews/current-full-review/README.md` | B5 | 登记 15 号计划/实施证据与下一阶段边界 |
| `docs/current-implementation/reviews/current-full-review/01-current-conclusion.md` | B5 | artifact finding 状态和仍被外部门禁阻断的声明 |
| `docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md` | B5 | Phase 3 internal completion，不混淆 OEM Phase 3/Phase 6A |
| `docs/current-implementation/reviews/current-full-review/08-issues-register.md` | B5 | Phase 3 状态、evidence、Deferred/manual gates |
| `docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md` | B5 | Phase 3 状态/evidence；从 Phase 5 移除已 Closed 的 `CORE-05` |
| `docs/current-implementation/reviews/current-full-review/10-verification-plan.md` | B3/B5 | B3先把当前Gate 5/6/7命令改为显式manifest/binding；B5记录 clean SHA、artifactSetId、结果和未执行 manual gate |
| `docs/current-implementation/release-metadata-audit.md` | B3/B5 | B3修正third-party CLI/自行pack旧描述；B5用 canonical artifact证据替换旧 snapshot并保留真实publish阻断 |
| 本文件 | B0-B5 | 按批记录红绿、review finding、证据和最终状态 |

除表中批准文件外不得修改其他文件。若实现发现确需新增/改动文件，先停止、补写本节并重新完成双轴计划复审，不能在实施中口头扩 scope。

### 7.3 批准文件保护、注释与文件预算

- B0-B5只在第2.3节固定的implementation base上实施；不得从第2.2节历史dirty快照另行复制或覆盖文件。起始已staged计划和untracked执行提示词按bytes保护；B3文档、README、Gate 6/7 tests和既有script若已含相对base的非Phase 3 hunk，必须逐路径记录base/index/worktree bytes及patch hash并逐hunk保护。每批前后比较implementation base blob、此前批准Phase 3 patch和当前worktree/index差异，证明只新增本批表内hunks。
- 所有新增TypeScript文件必须通过仓库文件头和comment lint（`AGENTS.md:19-25`）。所有新增/修改`.mjs`、`.ts`中的命名函数、箭头函数和对象方法都必须在定义上方有规范中文注释；现有comment lint只检查其既定规则，不能完整证明逐方法注释（`tools/lint/check-comments.mjs:86-97`），所以每批Standards reviewer必须把函数列表与前置注释逐项核对并把结果写入ledger。
- 每批对所有新增/修改code/test文件运行`wc -l`并记录行数；任何文件达到1000行前必须按本表已有职责拆分。拆分若需要表外文件，立即停止并先修订/复审计划；同时遵守仓库“小文件、窄职责”要求（`AGENTS.md:19-25`）。
- 最少检查命令固定为：

```bash
wc -l <本批全部新增或修改的 code/test 文件>
rg -n '(^|[[:space:]])(async[[:space:]]+)?function|=>[[:space:]]*\{|^[[:space:]]*(async[[:space:]]+)?[A-Za-z_$][A-Za-z0-9_$]*\([^)]*\)[[:space:]]*\{' <本批全部新增或修改的 .mjs/.ts 文件>
```

命令只生成审查清单；Standards reviewer必须逐项给出`comment-pass`，不能把无finding的`rg`输出误当自动通过。

## 8. 批次计划

### P3-B0：发布分类与 artifact contract 冻结

**前置条件**

- 确认 Phase 2 全部Closed；按第2.3节使用用户明确授权的当前分支和implementation base `906ec700246a7020c7f82fd18c17fd50ee3fbcce`实施，仅修改本批批准文件并保护起始计划/执行提示词资产。
- 只允许本节 B0 文件；除repo外synthetic双tarballfixture外，不build runtime package、不pack JWord package。

**精确修改文件**

- 新增 `docs/current-implementation/release-artifact-contract.md`。
- 新增 `tools/release/package-artifact-contract.json`。
- 新增 `tests/architecture/phase3-package-artifact-contract.test.ts`。
- 新增 `tests/architecture/phase3-package-artifact-registry.test.ts`。
- 回写本文件 B0 evidence。

**最小红灯**

- `phase3-package-artifact-contract.test.ts`要求12个package恰好各出现一次、分类/交付/registry intent完整、Professional Editing明确absent、`collab-server`为Docker-only、非runtime workspace为forbidden；每个export必须恰好有一个非空环境集合，环境值只能来自第6节枚举，License根入口、UI CSS、三个worker子入口、Collab experimental和server入口必须精确匹配冻结标签。七个journey及其target必须与第6节表完全一致，每个target引用已声明的package/subpath/environment，runtime属于对应journey且满足固定environment/runtime映射，每个export/environment至少被一个target覆盖，同一journey内不得重复target；缺失target、悬空引用、runtime错配、未覆盖export或静默额外target都稳定失败。contract文件不存在、export未分类或同一subpath重复时稳定失败；同一test还要求第6节固定的8个size budget恰好各出现一次、source/limit和native baseline bytes/hash精确，空、缺失、额外或重复budget稳定失败。
- 同一contract test锁定native兼容资产决策：`packages/native/package.json`继续只声明`dist`、`fixtures`、`README.md`，package-local fixture只允许`fixtures/registry.json`；该文件必须继续与根native registry一致。任何第二个fixture路径、其他package fixture allowlist或把native registry移出contract都稳定失败。
- `phase3-package-artifact-registry.test.ts`在repo外生成scoped synthetic `leaf -> base@0.0.0` 两个tarball，并为npm/pnpm各自启动第6节约束的只读loopback registry；两个空项目以精确版本直接列出leaf和base，使用独立无凭据userconfig/cache/store和预先创建的临时目录安装。要求registry只服务这两个原始tarball且metadata/tarball `GET`均发生、无unexpected/write，保存canonical transcript及其引用的metadata/tarball raw response bytes，并从raw bytes重算metadata SHA-256/bytes、tarball SHA-1/SHA-512 SRI/SHA-256/bytes。npm fixture必须校验lock中的loopback `resolved`和SHA-512 integrity；pnpm v9 fixture只校验SHA-512 integrity并由`.npmrc`、transcript和registry evidence证明origin，禁止要求pnpm lock保存动态端口。依赖树只有一个base实体且realpath不在repo；额外证明hoisted布局、store预热或用户credential均未参与。该预检不涉及JWord runtime artifact。

**最小实现**

- 写入本文件第4/6节已经冻结的JSON contract和对应说明；contract必须按精确target映射计算每条journey的tuple、逐export期望集合和最小first-party依赖闭包，并把native唯一fixture例外记录为精确路径而非目录通配；同时写入8个固定size budget及第6节冻结的source，native baseline bytes/hash直接读取并绑定implementation base中的精确文件，不使用运行时生成的run-a结果反向抬高limit；不改任何source manifest。

**Focused 绿灯**

```bash
pnpm exec vitest run tests/architecture/phase3-package-artifact-contract.test.ts tests/architecture/phase3-package-artifact-registry.test.ts
```

**扩大验证**

```bash
pnpm typecheck
pnpm lint
```

这些命令在第2.3节定义的当前Phase 3 implementation checkout运行；相对implementation base只允许起始受保护资产和B0批准patch，任何范围外状态立即停止。

**Standards/Spec 复审**

- Standards：JSON/文档是否单一真源、分类无重复、无未经批准package/version/legal决策；contract test只承担分类/journey/native/size及后续scanner职责，registry test只承担synthetic npm/pnpm loopback closure和registry evidence，两个文件都低于1000行；完成第7.3节comment/line-count清单。
- Spec：逐项对照`docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md:141-160`、OEM mapping和release audit，确认Phase 3的version/metadata/registry/2FA/dist-tag/changeset/rehearsal均未丢失，且不混淆OEM Phase 3。

**完成条件**

- 12包和非runtime workspace均有唯一结论；npm/pnpm synthetic闭包预检通过；所有P3技术决策无“实施时再定”；相对implementation base只出现B0批准hunks，comment/line-count检查通过。

**下一批进入条件**

- B0 Standards/Spec均`PASS / 0 finding`后标记`Implementation Ready / final evidence pending`，contract hash记录到本文件。synthetic闭包任一包管理器失败时hard stop并先修订/复审本计划，禁止自动选择override、手工lockfile、workspace/link、全局store预热或外部真实registry。

### P3-B1：package manifest 和产物边界门禁

**前置条件**

- B0 `Implementation Ready / final evidence pending`；继续在第2.3节授权的当前Phase 3 implementation checkout实施，该checkout只允许起始受保护资产、已有B0批准patch和本批patch。其中属于B1的`tests/architecture/gate5-commercial-readiness.test.ts`、`tests/architecture/gate6-package-exports.test.ts`和`tools/release/check-gate5-commercial-pack.mjs`必须相对implementation base逐hunk保护，后续B3文档/tests/scripts遵循同一规则；scanner只能读取package source manifest、contract和显式tarball路径。

**精确修改文件**

- 新增 `tools/release/check-package-artifacts.mjs`。
- 修改四个现有 pack/dry-run script 和四个既有 architecture test，见 7.2；`packages/native/package.json`和`packages/native/fixtures/registry.json`只读，不修改。
- 扩充 `tests/architecture/phase3-package-artifact-contract.test.ts`；回写本文件。

**最小红灯**

- 先只加一个公开seam test调用尚不存在的统一scanner并稳定失败；随后用临时synthetic tarball逐项证明scanner对`src/`、`test/`、未批准fixture、非`.d.ts`的`.ts`、`.map`、`sourcesContent`、`sourceMappingURL`、lifecycle/build script、workspace/repo path和已知private-key/test-signer marker任一命中即失败。fixture用例必须同时证明native精确`fixtures/registry.json`通过，而同包第二个fixture、改名路径或其他package fixture失败。四个既有architecture test还必须在不设置Phase 3环境变量时分别调用native、Gate 5、Gate 6和Gate 7入口的default/source模式，通过可观测子进程记录证明每个入口对`npm pack`、`pnpm pack`和`npm pack --dry-run`的调用数均为0；当前默认路径仍会自行dry-run或pack JWord package，因此稳定红。

**最小实现**

- 保留native现有`files`和registry；统一scanner读取B0 contract并输出JSON，对该唯一fixture记录bytes/SHA-256、核对与根registry内容一致并执行大小、内容和秘密扫描，禁止目录通配或新增例外。
- scanner检查packed manifest name/version/private/access/exports/files/dependencies/peers/sideEffects；验证所有export实体和环境分类；拒绝源码、测试、未批准fixture、source map文件及`sourcesContent`/`sourceMappingURL`文本标记、构建脚本文件、private key/test signer/seed；商业包与Base使用同一强度。
- 现有native、Gate 5、Gate 6和Gate 7 script只保留领域特有检查，公共tarball逻辑委托scanner。四个入口的default/source模式只检查source manifest/contract、各自领域规则和test显式传入的repo外synthetic tarball；它们不读dirty dist、不自行生成tarball，也不执行任何pack子进程。

**Focused 绿灯**

```bash
pnpm exec vitest run tests/architecture/phase3-package-artifact-contract.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-release-readiness.test.ts
node tools/release/check-package-artifacts.mjs --check-source-manifests
```

**扩大验证**

```bash
pnpm test:types
pnpm typecheck
pnpm lint
```

本批不对checkout中的既有dist执行pack scanner；tarball集成绿灯由B4 final pipeline调用B2 builder后完成。

**Standards/Spec 复审**

- Standards：scanner是否单一、结构化解析、无secret回显、无复制fixture secret、无publish命令、native repo fixture未删除；逐文件证明全部重叠目标相对implementation base只含起始受保护hunk和批准Phase 3 hunks；完成第7.3节comment/line-count清单。
- Spec：Base/商业/Docker-only规则一致，商业包确实拒绝源码/测试/fixture/map/build artifact，法律字段缺失只阻断真实 release。

**完成条件**

- source contract绿；synthetic negative matrix绿；native、Gate 5、Gate 6和Gate 7的default/source路径全部绿，且每个入口的三类pack子进程调用数均为0；旧扫描逻辑无规则漂移；无package version/private/license/lockfile变化；相对implementation base只出现B0/B1批准hunks，comment/line-count检查通过。

**下一批进入条件**

- B1双轴`PASS / 0 finding`后状态为`Implementation Ready / final evidence pending`；B2只能继续实现和fixture验证，不能生成或宣称最终JWord artifact。

### P3-B2：统一 artifact build、inventory 和 hash

**前置条件**

- B1 `Implementation Ready / final evidence pending`；继续在第2.3节授权的当前checkout实施，只允许起始受保护资产和B0/B1批准patch。B2实现期不要求把未完成Phase 3代码提交，也不得生成最终JWord run-a。
- production/canonical模式必须要求clean SHA和repo外空output；但该模式只能在B4全部实现完成、用户另行授权形成clean commit后运行。agent不得自行commit。

**精确修改文件**

- 新增 `phase3-artifact-utils.mjs`、`build-phase3-artifacts.mjs`、`compare-phase3-artifacts.mjs`、`phase3-artifact-build.test.ts`。
- 修改第7.2节标记为B1/B2的四个pack/dry-run script与四个architecture test、根`package.json`和本文件。

**最小红灯**

- builder architecture test先在repo外临时Git fixture分别制造staged、unstaged和non-ignored untracked状态，要求production模式exit nonzero且不生成tarball；再用fixture命令在起始clean后修改tracked文件，分别覆盖source gate后、build后/pack前、pack后和direct command后检查，要求稳定失败且不得生成`source-report.json`、`test-report.json`或binding。对synthetic两包fixture要求inventory包含clean SHA/lock/env/source-report sidecar hash/tarball hash，并静态拒绝builder调用会触发`pretest`的精确根命令`pnpm test`。同一test用golden fixture锁定第6节`files -> payloadSha256`、`SHA256SUMS`排序/两个空格/LF/单尾随换行及`sha256SumsSha256`；对路径顺序、file bytes、CRLF、空格、尾随换行、checksum顺序逐项mutation必须失败，并对`tarballFile`=`.`、`..`、含`/`、含`\`、缺少`.tgz`后缀、前缀/后缀垃圾造成的部分匹配分别证明稳定失败。environment fixture必须锁定`os === process.platform`、`arch === process.arch`，并证明大小写转换、OS release/kernel值、runner标签或compare端重新归一化任一出现都会失败。`source-report.json.sha256`必须证明合法`<hash><LF>`通过，BOM、CRLF、前后空白、无尾随LF、多余空行、额外字段或文件名逐项稳定失败。test还必须从最终manifest重算ID，证明修改`runMetadata`不改ID、修改任一`artifactIdentity`字段会改ID、篡改`artifactSetId`会失败，并要求run-a根目录存在字段精确的`artifact-binding.json`。native、Gate 5、Gate 6和Gate 7的artifact/inventory回归还必须分别显式传入同一repo外synthetic artifact manifest，证明四个入口只读inventory，且每个入口的三类pack子进程调用数均为0。新入口不存在时红。

**最小实现**

1. `build-phase3-artifacts.mjs --purpose source-report`执行lint、typecheck和test:types；每条命令返回后及写report前都按第6节第21项重新检查clean，只写第6节第14项固定schema，其中`clean`必须为`true`且三条命令逐项记录command/exit/status。文件写完后计算raw bytes SHA-256到独立`source-report.json.sha256` sidecar。report内部不含自引用hash，也不含artifactSetId；任一命令污染仓库时不生成report或sidecar。
2. production builder校验branch/HEAD、第6节第21项定义的clean stdout完全为空、lock hash、Node/npm/pnpm、OS/arch和builder implementation hash，并校验source report及sidecar属于同SHA；实际`npm --version`必须与identity/source report一致后才可执行dry-run/pack。
3. production/canonical模式被B4 final pipeline调用时执行一次`pnpm build`；normalize check完成后、创建staging/pack前必须再次通过clean断言，再从clean dist和B0 contract创建12个staging package。每包先执行一次`npm pack --dry-run --json --ignore-scripts`并核对allowlist，再执行一次`npm pack --ignore-scripts`；不从source package直接pack。
4. production/canonical模式把每个tarball立即交给B1 scanner；全部12包dry-run/pack/scanner完成后再次通过clean断言，才按第6节第6/7项从regular file bytes生成`files`、payload、格式精确的`SHA256SUMS`、`sha256SumsSha256`、`artifact-manifest.json`及artifactSetId；写完后必须从最终manifest和checksum原始bytes重算一次并拒绝不一致。
5. production/canonical模式设置`JWORD_PHASE3_ARTIFACT_MANIFEST=<run-a manifest>`后，按第6节第14项顺序执行direct Vitest、Phase 3专属E2E、visual和Phase 3专属benchmark四条精确命令；B1-B3修改的release/architecture入口在该环境下必须只读run-a，禁止workspace dry-run/pack fallback。`pnpm test:e2e:phase3`必须保持三浏览器和`perf-chromium`，且只收集`examples/vanilla/tests`；`pnpm bench:phase3`必须只运行第6节第13项冻结的三个非JWL1 benchmark。根`pnpm test:e2e`与`pnpm bench`保持不变但不属于Phase 3 closure命令。B4按第7节修改visual runner，使该环境下跳过内部build；未设置时保持现有行为。native、Gate 5、Gate 6和Gate 7 architecture test必须在有该环境变量时把显式run-a manifest传给对应入口，在无该变量时保持B1 default/source模式；两种路径都禁止执行真实pack，真实JWord pack只存在本builder第3项的production/canonical staging pack入口（`tests/architecture/gate45-native-release.test.ts:7-37`、`tests/architecture/gate5-commercial-readiness.test.ts:36-67`、`package.json:17-25`、`tools/visual/run-visual.mjs:26-43`）。每条命令后都重新校验全部tarball checksum和第6节第21项clean状态，任一变化失败。
6. production/canonical模式只在四条命令全部通过，且写入前最后一次clean断言通过后生成test report和run-a根目录固定`artifact-binding.json`；字段、hash和验证规则严格使用第6节第14项。任一命令非零或clean失败时不生成二者、不允许上传run-a；中途失败只废弃本次repo外临时输出，不触碰或自动恢复repo。
7. B2实现期只在repo外synthetic Git/package fixture执行上述模式；禁止对JWord workspace运行canonical命令。compare脚本同样只用synthetic run-a/run-b证明tuple和raw mismatch规则。

**Focused 绿灯**

```bash
pnpm exec vitest run tests/architecture/phase3-artifact-build.test.ts tests/architecture/phase3-package-artifact-contract.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-release-readiness.test.ts
```

**扩大验证（implementation checkout，仅fixture）**

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/architecture/phase3-artifact-build.test.ts
```

test内部临时目录必须来自显式`mkdtemp`/`mktemp -d`且位于repo外；不得用仓库根、`~`、`$HOME`或未解析变量。本批没有JWord artifactSetId，也没有可交给B3/B4的run-a。

**Standards/Spec 复审**

- Standards：production clean检查覆盖staged/unstaged/non-ignored untracked，并在source三命令、build、pack、direct四命令后的固定节点重复执行；ignored输出不误报且没有额外exclude/自动restore；repo外输出；无force；source report使用sidecar raw hash；异常清理不删除宽路径；无`pnpm test`隐式第二次build；完成第7.3节comment/line-count清单。
- Spec：builder contract明确canonical run-a一次build/每包一次pack、root test body绑定run-a、12包分类、payload/checksum字节规范、环境/hash/binding字段、同SHA比较规则和真实publish禁用；本批没有冒充最终artifact evidence。

**完成条件**

- builder/scanner/hash/binding的synthetic fixture红绿通过；production模式在dirty输入fail closed；native、Gate 5、Gate 6和Gate 7的artifact/inventory回归全部绿，且每个入口的三类pack子进程调用数均为0；相对implementation base只出现B0-B2批准hunks，comment/line-count检查通过。状态只能记`Implementation Ready / final evidence pending`，不能记`Closed`。

**下一批进入条件**

- B2双轴`PASS / 0 finding`后进入B3实现；B3只复用synthetic fixture contract，不接收或生成JWord run-a。B2最终`Closed`要等B4同一clean SHA pipeline通过。

### P3-B3：空项目 third-party consumer matrix

**前置条件**

- B2 `Implementation Ready / final evidence pending`；继续在第2.3节授权的当前checkout实现。B3不接收JWord artifact manifest，只在repo外synthetic tarball fixture和静态contract上建立consumer runner反馈环。

**精确修改文件**

- 新增 `check-phase3-third-party-consumers.mjs`、`phase3-consumer-projects.mjs`、`phase3-third-party-consumers.test.ts`。
- 修改 Gate 5/6/7 third-party scripts、两个 License smoke、对应 Gate 5/6/7 architecture tests，以及第7.2节列出的SDK、current-implementation、OEM和README命令文档。
- 回写本文件。

**最小红灯**

- architecture test先要求 Phase 3 consumer source同时含 `--artifact-manifest`/`--binding`、npm、pnpm、只读loopback scoped registry、`createJWord`、React `createRoot`、Vue `createApp`、CSS export和 module Worker，并禁止 `pack`子进程、`overrides`、`workspace:`、repo source alias/fallback。install evidence fixture还必须锁定第6节第20项两个package-name字符串数组的ASCII排序、无重复、requested/closure不相交及并集完整性，以及无凭据registry config、served集合、method、request计数、write/unexpected/fallback为0；逐项证明非字符串、乱序、重复、交集、缺失/额外package、非loopback host、额外method、错误tarball hash、错误SHA-1/SRI、metadata raw bytes/hash不一致、缺失/乱序/重复transcript request、method/path/status/response hash错误、零GET请求、write/unexpected request或first-party外网fallback都会失败。lockfile fixture必须分别锁定npm `resolved`+integrity和pnpm v9 integrity+transcript origin，且证明要求pnpm lock保存动态端口的实现会失败。Gate 5/6/7兼容入口无参数时必须usage+非零退出，带两个显式参数时只委托inventory consumer且不pack。第7.2节所有当前命令文档和对应architecture断言必须包含第6节第22项的`PHASE3_RUN_A_ROOT` guard、两个完整参数及canonical run-a前置条件，并拒绝仍作为当前指引出现的无参数命令。当前 Gate 7 的 pack/override、仅类型 wrapper路径和公开无参数文档使测试稳定红。

**最小实现**

- runner的production模式要求`--artifact-manifest`与`--binding`同时显式提供且先按第6节第14项完成校验；npm/pnpm各自使用完全独立空项目、userconfig、cache/store和第6节第9项只读loopback registry。每条journey的package.json只把请求包、contract计算出的最小first-party传递闭包以精确版本列为direct dependencies，并列出精确外部peers；first-party scope只从本次registry解析到run-a tarball，外部依赖使用官方registry。不安装全量无关JWord包，无overrides/resolutions/workspace/file/alias；生成后把原始package manifest、对应lockfile、包管理器结构化dependency tree、无凭据`.npmrc`、registry evidence、canonical transcript及其全部metadata/tarball raw response bytes按第6节第20项的固定文件名复制到consumer handoff`raw/installs/<installId>/`，计算hash并登记到`install-evidence.json`。其中`requestedPackages`只写journey直接请求的first-party package，`firstPartyClosure`只写其余contract派生传递依赖，两个字符串数组分别ASCII排序、去重且不相交；npm/pnpm lockfile分别按第6节第9项的不同可执行字段校验，禁止要求pnpm v9 lock保存动态loopback origin。
- 安装后逐 package检查 packed manifest无 workspace、依赖树满足、resolved realpath在临时项目内且不在 repo；License single-runtime路径保持1个realpath，duplicate runtime保持fail closed。证据生成后必须从handoff副本重新解析manifest/lock/tree并复核同一结论，不能只复用安装阶段的内存布尔值。
- Node project严格按contract标签处理：只对`node` entry做ESM import，对`types` entry做类型解析；CSS和worker-only entry不能进入Node动态import，任何未分类、重复或被静默跳过的export都失败。`collab-server`只对`image-node/types` entry在独立 image-internal Node project检查，不出现在 browser package.json。所有生成的import/type/runtime probe source都复制到`raw/sources/<sourceId>/`；每个contract target的实际执行状态登记到`export-evidence.json`，不得只用journey级总状态代替。
- production browser matrix在同一套tarball上分别运行：Vanilla EditorShell+CSS、React真实mount/unmount、Vue真实mount/unmount、native/docx/pdf module Worker加载/安全失败、License runtime/identity；记录当前Chromium/Firefox/WebKit，最低版本列固定为`not-run/deferred`。每个实际bundle regular file复制到consumer handoff固定`bundles/<bundleId>/`并登记相对path、bytes和SHA-256，禁止只记录repo外临时项目路径。
- 每个子结果包含 artifactSetId、package manager/version、runtime、command、status；install/journey/export/bundle及consumer source集合必须与contract展开结果精确一致，任一 fallback/repack、未执行export、缺失原始install/source文件或bundle bytes即失败。
- Gate 5/6/7兼容入口统一解析第6节第22项两个必需参数并委托相同consumer/binding校验；不得保留无参自行pack兼容路径。同步更新第7.2节列出的全部当前可执行指引及其architecture tests；历史执行结果必须明确标成旧证据，不能与新的可执行命令混写。

**Focused 绿灯**

```bash
pnpm exec vitest run tests/architecture/phase3-third-party-consumers.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-release-readiness.test.ts tests/architecture/gate7-sdk-docs.test.ts
```

test在repo外生成最小synthetic tarball闭包和只读loopback registry，至少实际运行npm/pnpm install、Node ESM和一个最小browser mount；完整JWord journey只在B4 final run-a上运行。

**扩大验证**

```bash
pnpm test:types
pnpm typecheck
pnpm lint
```

本批不运行完整License或Gate 5/6 legacy业务smoke，因为尚无最终run-a。B4若为防回归另跑legacy smoke，必须用同一run-a manifest并在evidence写`legacy-non-gating`；JWL1/授权调用方失败只路由Phase 4，Collaboration deployment/admission或生产数据面失败只路由Phase 6，均不能在Phase 3修改。

**Standards/Spec 复审**

- Standards：真实空目录、无override/alias、最小显式tarball闭包、loopback only/只读/精确allowlist、端口动态分配、独立userconfig/cache/store、进程/临时目录清理、真实wrapper mount、无secret/token回显；全部公开命令可直接运行且参数占位一致，无参数兼容入口fail closed；完成第7.3节comment/line-count清单。
- Spec：七条用户旅程、逐export、Node/Vite/browser/worker/License、单 runtime和Docker-only边界全部覆盖；Gate 5/6/7文档、CLI和架构断言使用同一manifest/binding契约；当前 browser smoke未冒充 minimum certification。

**完成条件**

- synthetic npm/pnpm/loopback-registry/Node/browser feedback loop和静态完整matrix contract通过；生产模式禁止first-party外网fallback/repack/registry write，三个legacy入口无参数稳定失败，全部当前文档命令可运行，`collab-server`不进入客户browser consumer；相对implementation base只出现B0-B3批准hunks，comment/line-count检查通过。状态只能记`Implementation Ready / final evidence pending`。

**下一批进入条件**

- B3双轴`PASS / 0 finding`后进入B4；没有consumer evidence可提前关单，B3最终`Closed`依赖B4在最终run-a上完成完整matrix。

### P3-B4：CI、audit、provenance、SBOM 和 release rehearsal

**前置条件**

- B0-B3均为`Implementation Ready / final evidence pending`。B4代码/CI实现和synthetic focused检查可继续完成到检查点1；进入检查点2前，用户必须另行提供或明确授权形成包含B0-B4批准改动的clean commit，并把该精确SHA放到GitHub可读取的远端ref。agent不得仅凭本计划自行commit、push、创建PR或合并；缺少clean SHA或远端ref时在检查点1后hard stop，不把本地模拟记为B4绿灯。
- `.github/workflows/ci.yml`必须增加`workflow_dispatch`，但首次引入该trigger时不能假设未合并的workflow可从Actions UI直接dispatch。首次Phase 3最终run固定路径是：用户提供或授权clean commit和远端分支push，再由用户创建或明确授权创建指向`main`的PR，以现有`pull_request`事件运行该分支中的workflow；只有更新后的workflow已经存在于default branch时，才允许选择同一已验证ref执行`workflow_dispatch`复跑。无论入口为何，所有job必须记录并checkout同一个`github.sha`。用户未授权远端状态变更时，只报告所需ref/SHA和等待外部run，不自动扩大权限。
- B4是唯一生成JWord final run-a、consumer evidence、两套artifact assembly、audit/SBOM/provenance和run-b的批次；无真实registry凭据参与。

**精确修改文件**

- 新增B4十个artifact/CI文件：7个tool、`fixtures/release/rollback-state.json`、`fixtures/release/release-policy.json`和`tests/architecture/phase3-release-gates.test.ts`；修改`.github/workflows/ci.yml`、`package.json`、`vitest.config.ts`、`tools/release/phase3-artifact-utils.mjs`、`tools/release/build-phase3-artifacts.mjs`、`tools/release/compare-phase3-artifacts.mjs`、`tests/architecture/phase3-artifact-build.test.ts`、`tools/visual/run-visual.mjs`、`tests/gate2-fixture.test.ts`、`packages/core/src/shared/grapheme.ts`和本文件。Vanilla closure新增`examples/vanilla/tests/gate2-test-contract.ts`，并修改`examples/vanilla/tests/fixtures/test-fixture.ts`、`gate2.e2e.ts`、`gate2.perf.e2e.ts`、`gate3-input-helpers.ts`、`gate3-input-keyboard.e2e.ts`、`gate3-toolbar-helpers.ts`、`gate3-toolbar-paragraph.e2e.ts`、`gate3.perf.e2e.ts`、`gate4-a11y.e2e.ts`、`gate4-comments-link.e2e.ts`、`gate4-header-footer.e2e.ts`、`gate4-media.e2e.ts`、`gate4-readonly.e2e.ts`、`gate4-structure-find.e2e.ts`、`gate4-table.e2e.ts`、`gate7-plugin-error.e2e.ts`、`phase4-memory.perf.e2e.ts`及`packages/ui/src/link/controller.ts`、`packages/ui/src/selection-actions/controller.ts`；上述相对路径均位于`examples/vanilla/tests/`，除两个已写出完整路径的UI controller外，精确职责见第7.1/7.2节。`packages/core/test/editor/runtime.test.ts`只作为既有public seam读取和执行，不纳入修改范围。

**最小红灯**

- 单个architecture test要求CI声明`workflow_dispatch`并存在source/artifact/consumer/audit/reproducibility/final job依赖；每个job都checkout同一`github.sha`、setup同一Node/npm/pnpm并各自执行`pnpm install --frozen-lockfile`，逐项断言实际版本与source report/run-a identity一致；`artifact-build`和`artifact-consumers`分别执行`pnpm exec playwright install --with-deps chromium firefox webkit`。test必须通过`testCommandDefinitions()`断言builder与final verifier共享的命令定义按`direct-vitest/e2e/visual/bench`顺序恰好为第6节第14项四条精确命令，E2E与benchmark command恰好为`pnpm test:e2e:phase3`和`pnpm bench:phase3`；同时读取`package.json`断言E2E script精确限定`examples/vanilla/tests`并按Chromium/Firefox、WebKit、`perf-chromium`三段执行，WebKit仅在该Phase 3命令上追加`--workers=1 --timeout=60000`，`perf-chromium`仅追加`--workers=1`，benchmark script只按序运行第6节第13项三个文件，既有`pnpm test:e2e`与`pnpm bench`值不变；还必须锁定`playwright.config.ts`的`perf-chromium`项目不含项目级worker覆盖，且实现未修改`playwright.config.ts`、`tools/bench/run-bench.mjs`、`examples/docx/**`、`examples/collab/**`、`benchmarks/gate5-interop-benchmark.mjs`、`benchmarks/gate6-collab-benchmark.mjs`或License trust/token。visual的Phase 3模式不调用build；fixture command在任一顶层命令后修改tracked文件时clean断言稳定失败，不写`test-report.json`/binding/evidence、不上传对应handoff且B4保持open（`package.json:17-25`、`.github/workflows/ci.yml:41-57`、`playwright.config.ts:31-64`、`tools/visual/run-visual.mjs:26-43`）。`source-report`、run-a、`consumer-evidence`、`audit-evidence`、`reproducibility-evidence`和`final-evidence`各上传一次；run-a是唯一可被consumer/audit使用的package-artifact handoff，reproducibility handoff额外包含受限的12个run-b原始tarball且只有final job下载，consumer/audit/compare命令必须显式传binding。test还必须逐个篡改binding字段、manifest（包括`tarballFile`为`.`、`..`、含路径分隔符、非`.tgz`或仅部分匹配）、checksums、source/test report、三类summary、consumer原始manifest/lock/tree/registry config/registry evidence/registry transcript/metadata与tarball raw response/source/export/bundle、customer/server任一assembly manifest/lock/registry config/registry evidence/registry transcript/metadata与tarball raw response/audit/list、size budget和provenance `_type`/`predicateType`/subject/`buildDefinition.resolvedDependencies`/`runDetails`，覆盖空、缺失、额外、重复或错误映射集合，并针对install的`requestedPackages`/`firstPartyClosure`逐项覆盖非字符串、乱序、重复、交集、缺失或额外package，针对registry逐项覆盖非loopback host、额外method、错误served集合/hash、metadata SHA-256/bytes或tarball SHA-1/SHA-512 SRI/SHA-256/bytes不一致、transcript order/method/path/status/response kind/path/hash/bytes错误、缺少metadata或tarball `GET`、write/unexpected request及first-party外网fallback；lockfile mutation必须分别证明npm拒绝错误loopback `resolved`或SHA-512 integrity、pnpm v9拒绝错误SHA-512 integrity且不要求保存动态端口。再篡改readiness/rollback的owner/status/action/target/execution；`final-verification.json.sha256`还必须按第6节第14项逐项覆盖BOM、CRLF、前后空白、无尾随LF、多余空行、额外字段或文件名，不能用`trim()`接受非canonical sidecar。每次同步更新对应`evidence-manifest.json`后仍须语义失败。reproducibility mutation必须同步改写comparison、run-b manifest和run-b checksum后再篡改原始run-b tarball，证明final verifier从bytes重算；另分别增加、删除、替换文件或symlink证明root contract失败。release scripts不得包含publish/dist-tag/git tag/push，workflow不得自行创建commit、push或PR。当前单job CI和缺失脚本稳定红。
- 同一architecture test必须读取`tests/gate2-fixture.test.ts`并锁定测试内部build边界：设置`JWORD_PHASE3_ARTIFACT_MANIFEST`时，`packages/core/dist/index.js`缺失必须直接失败且不得执行`pnpm build`；未设置该变量时继续保留当前按需build兼容行为。门禁同时静态拒绝Phase 3 direct Vitest可达路径中的其他build/pack fallback，并对native、Gate 5、Gate 6和Gate 7在无环境变量default/source及有环境变量artifact/inventory两条路径都断言三类pack子进程调用数为0；不能只检查根`pretest`或visual runner。
- 既有`packages/core/test/editor/runtime.test.ts`是本次Core反例的唯一红绿public seam；在`node:20.19.0-bookworm`、`NODE_OPTIONS=--max-old-space-size=2048`、单worker和真实run-a manifest环境下，`先同步重绘当前脏页，再异步执行后续 deferred chunks`在原实现稳定以`Intl.Segmenter`/`JSSegmentIterator::Next`堆OOM失败，首轮流式投影后转绿；同文件`mounted 查询 getLayout 不会同步吃完整个 deferred continuation`与`mounted 命中与 rect 查询只按需续排并保留 deferred continuation`随后分别稳定以约15.4秒和42.9秒超过5秒timeout。不得缩小其6000/3000等既有repeat fixture、排除测试、提高heap或timeout掩盖失败，也不得修改冻结direct Vitest命令。
- 同一`phase3-artifact-build.test.ts`必须通过真实synthetic builder CLI seam覆盖两个case：第一，fake `pnpm`仅在`direct-vitest`命令分别向stdout/stderr写出两个不同的固定非秘密sentinel并以固定非零状态退出，且不得修改fixture repository；当前builder把两个子进程流全部吞掉，所以外层结果只含通用`direct-vitest command failed`且看不到任一sentinel，测试先稳定红。回归必须断言修复后stdout sentinel只出现在父stdout、stderr sentinel只出现在父stderr，安全摘要包含command id、status、signal和spawn error code，且仍不生成`test-report.json`、`artifact-binding.json`或可上传run-a。第二，同一fake failure同时修改既有tracked fixture文件；回归必须断言既有clean错误仍优先，两个sentinel均不转发，且同样不生成失败产物。禁止用生产源码字符串匹配代替CLI seam，摘要也不得额外拼接环境变量、文件内容、token或完整命令参数。已捕获文本按对应父流原样转发，其内容继续受现有no-secret回归约束，builder不得自行读取或添加敏感值。
- 同一冻结direct Vitest命令在CI全量241 files / 1275 tests下必须保持不变；现有`vitest.config.ts`的`maxWorkers: 4`在GitHub run `29991174376` attempt 1中使3个5秒测试超时，attempt 2使4个测试超时且失败集合漂移，两个partial run-a均不得作为证据。repo外Linux Node `20.19.0`、2 CPU synthetic seam用同一4文件集合复现默认4 workers红灯；只把`maxWorkers`设为2后15/15通过，最慢测试3.63秒，1 worker也通过但总时长更高。修订回归必须锁定`maxWorkers: 2`，不得提高任何测试timeout、缩小fixture、排除测试、改变heap/worker以外的命令参数或替换direct gate；完整direct Vitest仍须在同一固定命令下复跑。

**最小实现**

- 所有B4 jobs先checkout触发workflow的精确`github.sha`并把event/ref/SHA写入job summary；`workflow_dispatch`只能运行远端已存在的ref，不接受未经校验的任意SHA字符串输入。随后使用workflow冻结的同一精确Node和pnpm设置；source job记录该Node自带的精确npm版本，其他job分别执行`node --version`、`npm --version`、`pnpm --version`并要求三者与source report/run-a identity逐字一致，再执行`pnpm install --frozen-lockfile`并立即通过第6节第21项clean断言。job间不缓存或传递`node_modules`。`artifact-build`和`artifact-consumers`在各自frozen install后分别执行`pnpm exec playwright install --with-deps chromium firefox webkit`，其他job不得把现有单一`verify` job的浏览器缓存当作前置条件；每个job在顶层runner返回后和handoff上传前再次检查clean。
- CI `source-gates`在frozen install后执行`build-phase3-artifacts.mjs --purpose source-report`，由该模式运行lint、typecheck和`test:types`并在每条命令后复查clean；不执行会触发pretest build的`pnpm test`，不build/pack。该job只有在上传前最终clean检查通过时，才把不可变source report与raw-hash sidecar作为命名`source-report` handoff上传且只上传一次。
- `artifact-build`只在source绿后下载并校验`source-report`，再调用B2实现的canonical builder；builder内部build/pack run-a一次，设置`JWORD_PHASE3_ARTIFACT_MANIFEST=<run-a manifest>`后依次执行`pnpm exec vitest run --passWithNoTests`、`pnpm test:e2e:phase3`、`pnpm test:visual`、`pnpm bench:phase3`。Phase 3 E2E只收集`examples/vanilla/tests`，按Chromium/Firefox、WebKit单worker、`perf-chromium`单worker三段执行；这些worker覆盖仅存在于Phase 3脚本，不改变根Playwright项目和后续Phase并发语义。Phase 3 benchmark只运行第6节第13项三个非JWL1入口；二者是已完成能力的examples/dev-server与性能回归，不冒充tarball consumer evidence。根`pnpm test:e2e`、`pnpm bench`及DOCX/PDF/Collaboration测试/benchmark保持原样并留给OEM Phase 4迁移后恢复全仓blocking。visual runner在该环境变量存在时先校验manifest/checksum并直接读取本次canonical dist，跳过其当前内部`pnpm build`，未设置时保持原入口不变；`tests/gate2-fixture.test.ts`的`ensureBuiltCore()`在该变量存在且Core dist缺失时必须直接抛错，禁止执行当前按需`pnpm build`，未设置时保持原兼容入口。除隔离run-b外，四条命令及其可达测试/工具不得触发任何build fallback。四者与artifactSetId一起写入同一test report，但不得替代B3空项目consumer matrix。每条命令后复核run-a checksum，四条全绿后才按固定schema写`test-report.json`并生成binding；任一非零立即失败，不生成test report/binding、不上传run-a，B4不得关闭。`artifact-consumers`、`artifact-audit`和`artifact-reproducibility`只下载并校验同一run-a binding/checksum/ID，不运行run-a build/pack。
- `segmentGraphemes()`保持现有返回字段、顺序和UTF-16边界计算。若整个输入的每个UTF-16单元都落在可打印ASCII `U+0020..U+007E`、CJK Extension A `U+3400..U+4DBF`或BMP CJK Unified Ideograph `U+4E00..U+9FFF`，则每个单元都可证明为独立grapheme，直接线性投影四个字段；只要出现CR/LF、surrogate、combining mark、ZWJ、variation selector或任何集合外单元，整段输入仍交给`Intl.Segmenter`单次流式迭代并立即复制所需字段。禁止spread、`Array.from()`或其他方式物化全部原生`SegmentData`；不得增加依赖、缓存、环境分支、新公开API或扩大安全字符集合。三个既有runtime public seam必须在2GB heap下转绿，复杂emoji/组合附加符位置测试保持通过，随后完整direct Vitest仍使用冻结命令复核。
- `phase3-artifact-utils.mjs`中的唯一`TEST_COMMANDS`定义保持`direct-vitest/e2e/visual/bench`顺序，只把E2E与benchmark值分别从`pnpm test:e2e`、`pnpm bench`改为第6节冻结的`pnpm test:e2e:phase3`、`pnpm bench:phase3`；`testCommandDefinitions()`与`validateTestReport()`继续共同消费该常量，使builder执行和final verifier校验不会漂移。`build-phase3-artifacts.mjs`本轮不修改：`runFixedCommand()`继续保持`spawnSync`、调用方环境、既有post-command clean断言位置/优先级、成功report schema与失败诊断语义。clean断言通过后若结果非零，才把已捕获stdout/stderr分别原样写回父进程对应流，再抛出只含command id、数值status或`null`、signal或`none`、spawn error code或`none`的安全错误。若命令同时污染repository，仍由既有clean失败优先阻断；成功路径不新增输出。builder不得自行追加环境变量、token、manifest/tarball内容或任意文件bytes，不得新增/调整`maxBuffer`、heap、timeout、worker数或再次改变四条direct命令；失败路径仍须fail closed且禁止写test report/binding。本轮只修订Phase 3 gate定义，不改变既有失败可观测性。
- `vitest.config.ts`仅把全仓`test.maxWorkers`从4调整为2，保留同一include、setup、environment、fake-timer语义和冻结direct命令；这是针对Linux 2 CPU反馈环中全量worker/子进程争用的最小配置修复，不修改业务源码、测试fixture、单测timeout、heap、命令顺序或artifact schema。若完整direct Vitest仍暴露真实业务失败，必须重新按public seam判断，不得把worker配置当作通用豁免。
- 独立`artifact-reproducibility` job依赖`source-gates`和`artifact-build`，下载只读run-a，在同SHA的第二个clean checkout和repo外目录执行`build-phase3-artifacts.mjs --purpose reproducibility`生成run-b，再比较run-a/run-b。该job是唯一允许第二次build/pack的位置；build、pack和compare后均须clean。run-b不得上传为独立package artifact、consumer输入或替换run-a，但其12个原始tarball必须复制进reproducibility handoff，供final verifier独立重算。
- `artifact-consumers`只从下载的run-a执行完整消费矩阵；每个install启动第6节第9项的独立只读loopback registry，first-party scope只服务contract派生集合的run-a bytes。按第6节第20项写固定summary、journey、install、export、bundle payload，复制全部原始manifest/lock/tree、无凭据registry config/evidence、canonical registry transcript及其引用的metadata/tarball raw response bytes、consumer source和实际bundle regular file后生成覆盖完整root的`evidence-manifest.json`，把该root作为命名`consumer-evidence` handoff上传且只上传一次；不创建audit job依赖的隐式本地目录。
- `artifact-audit`下载并校验run-a与`consumer-evidence`后，要求调用方分别传入repo外空目录`customer-assembly-dir`和`server-assembly-dir`。客户目录通过独立只读loopback registry安装run-a inventory中的11个npm-delivery package闭包及外部production dependencies；server目录通过另一个独立registry只安装`collab-server`及contract计算的image-internal first-party闭包和外部production dependencies。两者都禁止workspace/link/override/file/alias和first-party外网fallback，分别生成并冻结manifest、lockfile、无凭据registry config/evidence、canonical registry transcript及其引用的metadata/tarball raw response bytes、dependency realpath与hash，并各自在自己的目录执行`pnpm audit --prod --audit-level high --json`和`pnpm list --prod --depth Infinity --json`。两份assembly evidence分别绑定`registryTranscriptSha256`；脚本按第6节第9/16/20项保存、解析并分类两套原始结果，生成两份assembly evidence后才生成总`evidence-manifest.json`，把完整root作为命名`audit-evidence`上传一次；禁止在仓库根运行这些命令。任一assembly的high/critical、registry异常、workspace/link依赖、集合串线或外部服务不可用都阻断内部closure。
- size gate只读run-a tarball内实际文件和consumer handoff内实际bundle，按contract精确生成8个budget；逐项重算`sourceSha256`和bytes，limit只读contract，禁止用观测值反向修改阈值，也不调用当前会build的`pnpm size`。
- SBOM生成单一SPDX 2.3 JSON，包含全部first-party tarball SHA，并从customer/server两份list建立两个不同assembly root及各自关系；把两套assembly lockfile/list hash分别写入external refs，禁止合并、缺省server关系或手写解析repo lockfile，未知法律字段为`NOASSERTION`。
- provenance按第6节第15项生成未包裹DSSE的in-toto Statement/SLSA v1 predicate：12项subject绑定tarball，`buildDefinition.resolvedDependencies`四项绑定Git、lockfile、contract和builder composite hash，`runDetails`绑定固定builder、execution run和manifest/checksum byproducts。Statement不得出现非标准`signed`或signature字段；audit summary固定写`provenanceAttestationStatus: unsigned`，readiness继续把正式signed provenance列为`blocked-as-expected`。final verifier逐字段重算并拒绝空、缺失、额外、重复或digest不一致。
- compare在同一clean runner做第二个独立repo外build，只用于reproducibility；它不能替换B3/B4已消费的run-a artifact。tuple相同的raw tarball hash必须一致；compare把12个run-b tarball按原始bytes复制到`run-b-tarballs/`，再从这些副本生成右侧manifest/checksum/comparison和覆盖全部payload的`evidence-manifest.json`。该root作为`reproducibility-evidence`上传一次，不另行上传run-b package artifact。
- `artifact-reproducibility`只生成第6节第20项列出的summary、comparison、run-b manifest/checksum、12个受限run-b tarball和`evidence-manifest.json`；consumer/audit jobs不得下载该handoff，final job必须下载且不能只信摘要。
- `artifact-final`依赖consumer、audit和reproducibility，下载`source-report`、run-a及三类evidence共五个输入handoff后运行`verify-phase3-final-evidence.mjs`，并生成第六个`final-evidence` handoff。verifier校验source/run-a固定root，重算binding raw SHA-256、manifest raw hash/artifactSetId、第6节字节规范的`SHA256SUMS`、全部run-a tarball/payload及source/test report hash，并语义校验source report的`clean`、`environment`和三条source命令，以及test report的`gitSha`、`artifactSetId`和四条test命令，所有集合、顺序、command、exit/status均须精确；各job和每条命令后的外部clean checkpoint按第6节第21项复查。再对三类root按第6节第20项拒绝缺失/额外/symlink，重算每个payload及`evidence-manifest.json`，直接读取reproducibility root内12个run-b tarball bytes重算右侧tarball hash、files/payload及checksum并与comparison/manifest逐项交叉校验，从contract派生并核对完整install/journey/export/bundle和repro package集合，解析consumer原始manifest/lock/tree/registry config/registry evidence/registry transcript及全部metadata/tarball raw response/source、重算实际bundle bytes/hash，逐bytes绑定customer/server两套assembly manifest、lockfile、registry config、registry evidence、registry transcript、metadata/tarball raw response、audit和list，重算metadata SHA-256/bytes及tarball SHA-1/SHA-512 SRI/SHA-256/bytes，按npm/pnpm分支校验lockfile，校验所有loopback/allowlist/request/hash/fallback约束、两份assembly evidence、双root SBOM、8个size budget、SLSA v1 Statement、summary、readiness和rollback的全部固定字段。输出固定`final-verification.json`及`final-verification.json.sha256`；record字段恰好为`schemaVersion`、`gitSha`、`lockfileSha256`、`artifactSetId`、`bindingSha256`、`artifactManifestSha256`、`sha256SumsSha256`、`sourceReportSha256`、`testReportSha256`、`consumerEvidenceManifestSha256`、`auditEvidenceManifestSha256`、`reproducibilityEvidenceManifestSha256`和`status: passed`，自身raw hash只写sidecar，不自引用。
- rollback脚本用 fixture prior channel+当前 candidate hash在临时目录演练第6节冻结的五个`simulation-only` action，health gate固定失败后pointer回到prior；输出实际三个state hash、`reason: simulated-health-check-failure`、`ownerStatus: deferred`和`realRegistryOperations: disabled`，绝不访问registry。
- release-readiness先用synthetic `1.2.3` fixture验证11包lockstep changeset、public/restricted/docker-only分层、2FA required、`next -> latest`、signed provenance requirement和rollback command plan；随后对真实candidate固定报告`private:true`、`0.0.0`、legal license、approved changeset/version、registry access、2FA、signed provenance、dist-tag approval、minimum browser certification等失败项。evidence必须固定`registryOperations: not-run`、`ownerStatus: deferred`及第6节六个`execution: not-run` action，不能用环境变量绕过。

**Focused 绿灯**

```bash
pnpm exec vitest run tests/architecture/phase3-release-gates.test.ts tests/architecture/phase3-artifact-build.test.ts
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run packages/core/test/editor/runtime.test.ts -t '先同步重绘当前脏页，再异步执行后续 deferred chunks' --maxWorkers 1 --passWithNoTests
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run packages/core/test/editor/runtime.test.ts --maxWorkers 1 --passWithNoTests
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run packages/core/test/model/position.test.ts packages/core/test/layout/text-segments.test.ts --maxWorkers 1 --passWithNoTests
```

后3条命令固定在`node:20.19.0-bookworm`、真实run-a manifest环境执行，且不修改既有测试：第二条保留原OOM红绿反馈环，第三条锁定完整runtime文件及新增超时反例，第四条锁定复杂grapheme fallback语义。其余Focused阶段只验证B4脚本/CI contract的synthetic fixture，不要求尚未生成的JWord artifact manifest；`check-phase3-release-gates.mjs`真实candidate模式只在下述最终expanded pipeline运行。

**扩大验证（clean CI/checkout，按 job 顺序）**

每个job都有独立clean checkout和文件系统；任何shell变量都只在本job内定义，不跨job复用。每个job在业务命令前都必须完成“checkout同一SHA -> setup同一Node/npm/pnpm并核对版本 -> `pnpm install --frozen-lockfile` -> clean断言”，`artifact-build`和`artifact-consumers`再分别安装Chromium/Firefox/WebKit；任一步失败即本job失败。每个顶层runner后和handoff上传前再次按第6节第21项检查。workflow随后校验`RUNNER_TEMP`为仓库外绝对路径，并把命名handoff下载到下面固定后缀。`source-gates`先执行且不触发build，随后把整个输出目录作为`source-report`上传一次：

```bash
PHASE3_SOURCE_EXPORT="${RUNNER_TEMP:?}/jword-phase3-source-report"
node tools/release/build-phase3-artifacts.mjs --purpose source-report --out-dir "$PHASE3_SOURCE_EXPORT"
```

`artifact-build`通过workflow action把`source-report`下载到本job的`PHASE3_SOURCE_DOWNLOAD`，校验report/sidecar后调用B2实现的canonical入口。该入口执行唯一run-a build、dry-run/pack，再依次运行direct Vitest、Phase 3专属`pnpm test:e2e:phase3`（只收集`examples/vanilla/tests`，含三浏览器和`perf-chromium`）、读取canonical dist的visual及Phase 3专属`pnpm bench:phase3`（只运行第6节第13项三个非JWL1入口）；四条结果与同一SHA/artifactSetId绑定但不冒充B3 tarball consumer evidence。四条全绿、test report和binding生成后，整个run-a目录才作为`run-a`上传一次：

```bash
PHASE3_SOURCE_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-source-report"
PHASE3_RUN_A_EXPORT="${RUNNER_TEMP:?}/jword-phase3-run-a"
node tools/release/build-phase3-artifacts.mjs --purpose canonical --source-report "$PHASE3_SOURCE_DOWNLOAD/source-report.json" --source-report-sha256 "$PHASE3_SOURCE_DOWNLOAD/source-report.json.sha256" --out-dir "$PHASE3_RUN_A_EXPORT"
```

`artifact-consumers`通过workflow action把run-a下载到本job的`PHASE3_RUN_A_DOWNLOAD`，运行完整matrix；固定summary、journey、install、export、bundle payload、原始manifest/lock/tree、无凭据registry config/evidence、consumer source和实际bundle文件及`evidence-manifest.json`写入独立目录并作为`consumer-evidence`上传一次：

```bash
PHASE3_RUN_A_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-run-a"
PHASE3_CONSUMER_EXPORT="${RUNNER_TEMP:?}/jword-phase3-consumer-evidence"
node tools/release/check-phase3-third-party-consumers.mjs --artifact-manifest "$PHASE3_RUN_A_DOWNLOAD/artifact-manifest.json" --binding "$PHASE3_RUN_A_DOWNLOAD/artifact-binding.json" --evidence-dir "$PHASE3_CONSUMER_EXPORT"
```

`artifact-audit`分别下载run-a和`consumer-evidence`到本job局部目录，由release-gate入口在两个显式repo外目录经独立只读loopback registry创建customer/server assembly，保存两套无凭据config/evidence，再分别在对应目录执行audit/list并生成双root SBOM/readiness；`PHASE3_AUDIT_OUT`作为`audit-evidence`上传一次，不改变run-a或consumer evidence：

```bash
PHASE3_RUN_A_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-run-a"
PHASE3_CONSUMER_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-consumer-evidence"
PHASE3_CUSTOMER_ASSEMBLY_OUT="${RUNNER_TEMP:?}/jword-phase3-customer-assembly"
PHASE3_SERVER_ASSEMBLY_OUT="${RUNNER_TEMP:?}/jword-phase3-server-assembly"
PHASE3_AUDIT_OUT="${RUNNER_TEMP:?}/jword-phase3-audit-evidence"
node tools/release/check-phase3-release-gates.mjs --artifact-manifest "$PHASE3_RUN_A_DOWNLOAD/artifact-manifest.json" --binding "$PHASE3_RUN_A_DOWNLOAD/artifact-binding.json" --consumer-root "$PHASE3_CONSUMER_DOWNLOAD" --customer-assembly-dir "$PHASE3_CUSTOMER_ASSEMBLY_OUT" --server-assembly-dir "$PHASE3_SERVER_ASSEMBLY_OUT" --evidence-dir "$PHASE3_AUDIT_OUT"
```

`artifact-reproducibility`在第二个clean checkout分别下载`source-report`和run-a到本job局部目录，生成只供比较的run-b；compare按第6节第20项把12个run-b原始tarball复制进受限root，再生成summary、manifest、checksum和evidence manifest，并把该完整目录作为`reproducibility-evidence`上传一次。该handoff不得被consumer/audit下载，也不得注册为package artifact：

```bash
PHASE3_SOURCE_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-source-report"
PHASE3_RUN_A_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-run-a"
PHASE3_RUN_B_OUT="${RUNNER_TEMP:?}/jword-phase3-run-b"
PHASE3_REPRO_OUT="${RUNNER_TEMP:?}/jword-phase3-reproducibility-evidence"
node tools/release/build-phase3-artifacts.mjs --purpose reproducibility --source-report "$PHASE3_SOURCE_DOWNLOAD/source-report.json" --source-report-sha256 "$PHASE3_SOURCE_DOWNLOAD/source-report.json.sha256" --out-dir "$PHASE3_RUN_B_OUT"
node tools/release/normalize-dist-relative-imports.mjs --check
node tools/release/compare-phase3-artifacts.mjs --left "$PHASE3_RUN_A_DOWNLOAD/artifact-manifest.json" --left-binding "$PHASE3_RUN_A_DOWNLOAD/artifact-binding.json" --right "$PHASE3_RUN_B_OUT/artifact-manifest.json" --evidence-dir "$PHASE3_REPRO_OUT"
```

`artifact-final`下载source-report、run-a和三类evidence到job局部目录，显式传入全部文件并把唯一输出目录作为`final-evidence`上传一次：

```bash
PHASE3_SOURCE_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-source-report"
PHASE3_RUN_A_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-run-a"
PHASE3_CONSUMER_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-consumer-evidence"
PHASE3_AUDIT_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-audit-evidence"
PHASE3_REPRO_DOWNLOAD="${RUNNER_TEMP:?}/jword-phase3-reproducibility-evidence"
PHASE3_FINAL_OUT="${RUNNER_TEMP:?}/jword-phase3-final-evidence"
node tools/release/verify-phase3-final-evidence.mjs --source-root "$PHASE3_SOURCE_DOWNLOAD" --run-a-root "$PHASE3_RUN_A_DOWNLOAD" --consumer-root "$PHASE3_CONSUMER_DOWNLOAD" --audit-root "$PHASE3_AUDIT_DOWNLOAD" --reproducibility-root "$PHASE3_REPRO_DOWNLOAD" --out-dir "$PHASE3_FINAL_OUT"
```

consumer/audit/reproducibility/final jobs都禁止生成或重新pack run-a。run-b只随reproducibility handoff上传为final verifier原始证据，不是任何消费或发布输入。CI workflow本身必须由用户授权的远端分支PR首次触发；更新后的workflow已在default branch时，可用`workflow_dispatch`对同一已验证ref复跑。只有GitHub以同一`github.sha`完成clean checkout，并在第6节固定节点持续保持clean，才算B4绿；本地模拟不能代替workflow handoff。创建clean commit、把ref推到远端、创建PR及触发/重跑都需要用户明确授权或由用户执行，缺任一步时B4停在`Implementation Ready / final evidence pending`，不得自动commit/push/PR。两套`pnpm audit`都属于自动但依赖外部registry的gate，任一失败/不可达时记录真实失败并保持B4 open。

**Standards/Spec 复审**

- Standards：least permissions、无secrets、无publish、六个命名handoff各上传一次；run-a是唯一consumer/audit可用package artifact，first-party registry只绑定loopback且只读/精确allowlist/无凭据，run-b只作为受限reproducibility原始证据且只有final读取；每个job局部路径、固定节点clean检查与下游checksum验证、`pnpm test:e2e:phase3`/`pnpm test:visual`/`pnpm bench:phase3`未被consumer matrix替代、visual和Gate 2 fixture的Phase 3模式都不二次build、final verifier fail closed、rollback只临时状态；完成第7.3节comment/line-count清单。
- Spec：lint/type/direct-test/E2E/visual/bench/build/audit/size/SBOM/provenance/reproducibility/version/metadata/registry/2FA/dist-tag/changeset/rollback/final record均绑定同SHA/binding/ID；final verifier从run-b原始bytes独立重算，payload/SHA256SUMS字节规范和clean断言可由mutation稳定证明；人工门禁没有被自动证据伪装关闭。

**完成条件**

- 检查点1，B4实现完成：B4文件级实现、synthetic focused红绿、scope/comment/line-count检查及实现patch双轴复审通过后，只能标记`Implementation Ready / final evidence pending`；此时B0-B4均不得标`Closed`，也不得把synthetic evidence冒充JWord artifact evidence。
- 检查点2，B4最终pipeline完成：用户另行提供或授权形成包含B0-B4全部批准改动的clean commit、远端分支和指向`main`的PR，由`pull_request`首次触发；若该workflow已在default branch，则也可由用户对同一已验证ref执行`workflow_dispatch`复跑。在同一最终`github.sha`上完成source-report sidecar、唯一run-a、inventory-only direct Vitest、`pnpm test:e2e:phase3`（含`perf-chromium`）、`pnpm test:visual`、`pnpm bench:phase3`、完整B3 matrix、repo外customer/server两套loopback-registry assembly及config/evidence、audit/list、双root SBOM、size/provenance/readiness/rollback、含12个受限原始tarball的隔离run-b compare及final verifier；每个固定节点clean，direct Vitest、visual及其他run-a下游没有触发测试内部或工具内部build fallback，first-party无外网fallback/registry write，final verifier从24个原始tarball重算的raw/payload/checksum hashes一致，四命令test report完整，release-candidate按预期fail closed，`final-verification.json`及sidecar生成且六个handoff绑定一致，comment/line-count检查通过。只有该检查点及最终evidence双轴复审通过，B0-B4才可一起标`Closed`。

**下一批进入条件**

- B4最终pipeline及其evidence双轴`PASS / 0 finding`；此时回溯把B0-B4一起标`Closed`，全部automatic evidence来自同一final SHA/run-a且manual/external状态明确，才可进入B5。仅检查点1的实现patch复审通过不得进入B5。

### P3-B5：完整验证、双轴复审和文档关单

**前置条件**

- B0-B4 Closed；同一clean SHA/artifactSetId的六个命名handoff、`final-verification.json`及其sidecar齐全；没有未分类失败或skipped gate。

**精确修改文件**

- 只修改第 7.2 所列8个文档，不再修改源码、测试、CI或script。

**最小红灯**

- 先对B4保存输入和final record运行verifier的`--check-record`模式；任一binding字段、manifest/checksum/source/test bytes、三类evidence关联或record/sidecar不一致时稳定红，B4 architecture mutation fixture锁定这些失败路径。文档只读检查再要求本文件存在唯一authoritative ledger，README/01/07/08/09/10/release audit各有且只有一个固定ledger引用、没有复制ledger块，也没有在ledger块外复制`artifactSetId:`或`finalVerificationSha256:`独占行，并按职责说明内部完成状态、真实publish禁用和manual/Deferred清单；同时要求`09` Phase 5不再列`CORE-05`。对两个禁止字段分别构造一份含正确marker/link但在块外插入该独占行的内存文本mutation，两者都必须稳定红；当前evidence或文档链不满足时红。

**最小实现**

- 按实际证据回写，不复制计划命令为“已通过”；记录每条命令、exit、artifactSetId、finalVerificationSha256、artifact/evidence路径和未执行项。
- 只有本文件新增独占标题行`### Phase 3 authoritative ledger`，并写恰好一个由独占行`<!-- PHASE3_LEDGER_START -->`和`<!-- PHASE3_LEDGER_END -->`包围的ledger块；块内恰好五行：`phase3Status: Completed for internal progression`、非空`artifactSetId: <sha256>`、非空`finalVerificationSha256: <sha256>`、`realPublish: blocked`、`manualGates: Deferred`。其余七份文档不得复制这些字段，只各写恰好一个固定引用marker：`<!-- PHASE3_LEDGER_REF: docs/current-implementation/reviews/current-full-review/15-phase3-artifact-and-third-party-consumption-plan.md -->`，并使用固定可读链接标签`Phase 3 authoritative ledger`：current-full-review内六份文档链接`15-phase3-artifact-and-third-party-consumption-plan.md#phase-3-authoritative-ledger`，`release-metadata-audit.md`链接`reviews/current-full-review/15-phase3-artifact-and-third-party-consumption-plan.md#phase-3-authoritative-ledger`。这样artifactSetId和finalVerificationSha256只有一个机器可读真源。
- B0-B5各自状态改为 Closed；Phase 3改为 `Completed for internal progression`；public/commercial release继续blocked。
- 独立 Standards/Spec reviewer检查最终 patch；发现finding只在批准文件内最小修订并复跑相关focused gate，直到双方 `PASS / 0 finding`。

**Focused 绿灯**

```bash
: "${PHASE3_SOURCE_DOWNLOAD:?must point to saved source-report handoff}"
: "${PHASE3_RUN_A_DOWNLOAD:?must point to saved run-a handoff}"
: "${PHASE3_CONSUMER_DOWNLOAD:?must point to saved consumer-evidence handoff}"
: "${PHASE3_AUDIT_DOWNLOAD:?must point to saved audit-evidence handoff}"
: "${PHASE3_REPRO_DOWNLOAD:?must point to saved reproducibility-evidence handoff}"
: "${PHASE3_FINAL_DOWNLOAD:?must point to saved final-evidence handoff}"
PHASE3_FINAL_RECORD="$PHASE3_FINAL_DOWNLOAD/final-verification.json"
PHASE3_FINAL_RECORD_SHA256="$PHASE3_FINAL_DOWNLOAD/final-verification.json.sha256"
node tools/release/verify-phase3-final-evidence.mjs --source-root "$PHASE3_SOURCE_DOWNLOAD" --run-a-root "$PHASE3_RUN_A_DOWNLOAD" --consumer-root "$PHASE3_CONSUMER_DOWNLOAD" --audit-root "$PHASE3_AUDIT_DOWNLOAD" --reproducibility-root "$PHASE3_REPRO_DOWNLOAD" --check-record "$PHASE3_FINAL_RECORD" --check-record-sha256 "$PHASE3_FINAL_RECORD_SHA256"
node --input-type=module - "$PHASE3_FINAL_RECORD" "$PHASE3_FINAL_RECORD_SHA256" <<'NODE'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const files = [
  'docs/current-implementation/reviews/current-full-review/README.md',
  'docs/current-implementation/reviews/current-full-review/01-current-conclusion.md',
  'docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md',
  'docs/current-implementation/reviews/current-full-review/08-issues-register.md',
  'docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md',
  'docs/current-implementation/reviews/current-full-review/10-verification-plan.md',
  'docs/current-implementation/release-metadata-audit.md',
  'docs/current-implementation/reviews/current-full-review/15-phase3-artifact-and-third-party-consumption-plan.md'
]
const canonicalFile = files.at(-1)
if (canonicalFile === undefined) throw new Error('Missing canonical Phase 3 ledger file')
const referenceFiles = files.slice(0, -1)
const ledgerReference = '<!-- PHASE3_LEDGER_REF: docs/current-implementation/reviews/current-full-review/15-phase3-artifact-and-third-party-consumption-plan.md -->'
const reviewLedgerLink = '[Phase 3 authoritative ledger](15-phase3-artifact-and-third-party-consumption-plan.md#phase-3-authoritative-ledger)'
const releaseAuditLedgerLink = '[Phase 3 authoritative ledger](reviews/current-full-review/15-phase3-artifact-and-third-party-consumption-plan.md#phase-3-authoritative-ledger)'
const blockPattern = /^<!-- PHASE3_LEDGER_START -->\r?\n([\s\S]*?)\r?\n<!-- PHASE3_LEDGER_END -->$/gmu
const copiedLedgerFieldPattern = /^(?:artifactSetId|finalVerificationSha256):[^\r\n]*$/mu

// 校验权威账本的唯一性、字段集合与哈希格式。
function validateCanonicalLedger(text, file) {
  const ledgerHeadingPattern = /^### Phase 3 authoritative ledger$/gmu
  if ([...text.matchAll(ledgerHeadingPattern)].length !== 1) throw new Error(`${file}: expected one authoritative ledger heading`)
  const blocks = [...text.matchAll(blockPattern)]
  if (blocks.length !== 1) throw new Error(`${file}: expected one authoritative Phase 3 ledger`)
  const block = blocks[0]
  if (block.index === undefined) throw new Error(`${file}: missing authoritative Phase 3 ledger offset`)
  const outsideLedger = `${text.slice(0, block.index)}${text.slice(block.index + block[0].length)}`
  if (copiedLedgerFieldPattern.test(outsideLedger)) throw new Error(`${file}: copied authoritative Phase 3 ledger field outside ledger`)
  const lines = block[1].split(/\r?\n/u)
  if (lines.length !== 5) throw new Error(`${file}: expected five ledger fields`)
  const fields = new Map()
  for (const line of lines) {
    const separator = line.indexOf(': ')
    if (separator < 1) throw new Error(`${file}: invalid ledger field`)
    fields.set(line.slice(0, separator), line.slice(separator + 2))
  }
  if (fields.size !== 5) throw new Error(`${file}: duplicate ledger field`)
  if (fields.get('phase3Status') !== 'Completed for internal progression') throw new Error(`${file}: invalid phase3Status`)
  if (fields.get('realPublish') !== 'blocked') throw new Error(`${file}: invalid realPublish`)
  if (fields.get('manualGates') !== 'Deferred') throw new Error(`${file}: invalid manualGates`)
  const artifactSetId = fields.get('artifactSetId') ?? ''
  if (!/^[a-f0-9]{64}$/u.test(artifactSetId)) throw new Error(`${file}: invalid artifactSetId`)
  const finalVerificationSha256 = fields.get('finalVerificationSha256') ?? ''
  if (!/^[a-f0-9]{64}$/u.test(finalVerificationSha256)) throw new Error(`${file}: invalid finalVerificationSha256`)
  return fields
}

for (const file of referenceFiles) {
  const text = readFileSync(file, 'utf8')
  if ([...text.matchAll(blockPattern)].length !== 0) throw new Error(`${file}: duplicated authoritative Phase 3 ledger`)
  if (copiedLedgerFieldPattern.test(text)) throw new Error(`${file}: copied authoritative Phase 3 ledger field`)
  if (text.split(ledgerReference).length !== 2) throw new Error(`${file}: expected one Phase 3 ledger reference`)
  const ledgerLink = file.endsWith('release-metadata-audit.md') ? releaseAuditLedgerLink : reviewLedgerLink
  if (text.split(ledgerLink).length !== 2) throw new Error(`${file}: expected one readable Phase 3 ledger link`)
}
const canonicalText = readFileSync(canonicalFile, 'utf8')
const fields = validateCanonicalLedger(canonicalText, canonicalFile)
for (const field of ['artifactSetId', 'finalVerificationSha256']) {
  const mutation = `${canonicalText}\n${field}: ${'a'.repeat(64)}\n`
  let rejected = false
  try {
    validateCanonicalLedger(mutation, `${canonicalFile} mutation`)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error(`Phase 3 ledger mutation was not rejected: ${field}`)
}
const artifactSetId = fields.get('artifactSetId') ?? ''
const ledgerFinalSha256 = fields.get('finalVerificationSha256') ?? ''
const finalBytes = readFileSync(process.argv[2])
const finalSha256 = createHash('sha256').update(finalBytes).digest('hex')
const sidecarBytes = readFileSync(process.argv[3])
const sidecarText = sidecarBytes.toString('utf8')
if (!/^[a-f0-9]{64}\n$/u.test(sidecarText)) throw new Error('Invalid final verification sidecar bytes')
const sidecarSha256 = sidecarText.slice(0, -1)
if (finalSha256 !== sidecarSha256) throw new Error('Final verification sidecar mismatch')
const finalVerification = JSON.parse(finalBytes.toString('utf8'))
if (finalVerification.artifactSetId !== artifactSetId) throw new Error('Final verification artifactSetId mismatch')
if (finalVerification.status !== 'passed') throw new Error('Final verification did not pass')
if (ledgerFinalSha256 !== finalSha256) throw new Error('Ledger finalVerificationSha256 mismatch')
const roadmap = readFileSync(files[4], 'utf8')
let phase5
for (const section of roadmap.split(/(?=^## )/mu)) {
  if (/^## .*(?:Phase|阶段) 5/mu.test(section)) phase5 = section
}
if (!phase5 || phase5.includes('CORE-05')) throw new Error('Phase 5 CORE-05 state is invalid')
NODE
```

该focused gate先以final verifier只读重验六个保存handoff及final record，再只读检查B5八份文档；不重新build、pack、install、audit或运行consumer。B0-B4的五个architecture test已覆盖生成端和mutation fail-closed，B5不重复运行。

**扩大验证**

保存上述final verifier命令及exit 0，并确认本文件唯一authoritative ledger绑定final record raw SHA-256、其余七份文档各只有一个固定引用且没有复制ledger。B5不重新执行direct Vitest、`pnpm build`、pack或consumer；需要重跑source gate时必须废弃旧artifact并从B4 final pipeline的`source-gates`重新开始完整链。随后只执行工作区检查：

```bash
git diff --check
git diff --cached --check
git status --porcelain=v1 -z
```

对本阶段新增untracked文件逐一使用`git diff --no-index --check /dev/null <file>`；exit 1且无输出只表示存在预期内容差异，任何whitespace diagnostic都失败。除范围外status/path fingerprint外，还必须逐个比较implementation base blob、此前批准Phase 3 patch与当前新增hunks，证明只出现批准改动；起始计划/执行提示词按bytes保护，也禁止以“批准文件已排除”代替检查。

**Standards/Spec 复审**

- Standards：AGENTS、scope、批准文件既有patch保护、命令安全、最小改动、第7.3节注释/文件预算和可执行性。
- Spec：对照08/09/10、release audit、OEM文档逐项确认目标、退出标准、Phase 4/6/7边界和Deferred状态。

**完成条件**

- final verifier `--check-record`、ledger只读gate、whitespace/scope均通过；两个独立reviewer最终均明确输出`PASS / 0 finding`；文档状态无夸大。

**下一批进入条件**

- 无自动进入。报告Phase 3内部完成和外部门禁后立即停止；Phase 4必须由用户另行批准。

## 9. 最少测试与完整验证矩阵

### 9.1 最少新增测试

只新增5个 architecture test文件，每个文件覆盖一个稳定public seam：contract/scanner、synthetic registry closure、builder/inventory、consumer、CI/release evidence。业务行为不新增重复unit test；React/Vue/Worker/License的真实行为放在一个由inventory驱动的consumer matrix。任何新增失败用例一次只引入一个关键红灯，再写最小实现转绿。

### 9.2 验证矩阵

| Gate | 类型 | 输入/命令 | 通过标准 | Phase 3状态 |
| --- | --- | --- | --- | --- |
| GitHub trigger | 外部授权/clean | 首次：用户提供或授权clean commit、远端分支和PR；后续：default branch已有新workflow时可`workflow_dispatch`同一ref | workflow记录的ref与全部job `github.sha`一致；agent未越权commit/push/PR | B4最终closure必须；缺授权时停在pending |
| CI job setup | 自动/clean | 每job同SHA、同一精确Node/npm/pnpm + frozen install；consumer加Playwright三浏览器安装 | 三个版本与source report/run-a identity逐字一致、install exit 0、install后clean、无跨job `node_modules`假设 | 必须 |
| lint | 自动/本地 | `pnpm lint` | exit 0 | 必须 |
| typecheck | 自动/本地 | `pnpm typecheck` | exit 0 | 必须 |
| public types | 自动/本地 | `pnpm test:types` | exit 0 | 必须 |
| unit/architecture | 自动/artifact-build | run-a pack后注入manifest执行`pnpm exec vitest run --passWithNoTests`；focused阶段执行5个新增test | exit 0，无skipped/fallback；不触发pretest或测试内部的任何build；测试前后checksum一致 | 必须 |
| source/test evidence | 自动/artifact | 固定source/test report和binding | source report的`clean: true`、environment及三条source命令，test report的`gitSha`、`artifactSetId`及四条test命令集合、顺序、command、exit/status精确且raw hash绑定；每条命令后及写report/binding前按第6节第21项复查外部clean | 必须 |
| canonical build | 自动/clean | B4 `artifact-build`调用B2 builder的`--purpose canonical` | clean SHA，run-a一次build/每包一次pack；build后/pack前及pack后clean | 必须 |
| ESM normalization | 自动/clean | normalize `--check` | 不改文件，exit 0 | 必须 |
| pack/manifest/content | 自动/artifact | B1 scanner | 12包全绿，无source/test/未批准fixture/map/script/secret；native只允许精确registry并记录bytes/hash | 必须 |
| inventory/checksum | 自动/artifact | B4 final run-a manifest/SHA256SUMS | `files -> payloadSha256`唯一preimage、tarballFile ASCII排序、两个空格、LF与单尾随换行精确；全部bytes/hash/ID一致 | 必须 |
| legacy third-party CLI/docs | 自动/artifact | Gate 5/6/7兼容入口及第7.2节当前命令文档 | 无参数usage+非零；显式manifest/binding只读同一run-a，文档命令与architecture断言一致 | 必须 |
| Node ESM | 自动/artifact | B3 Node consumer | 只动态import标记`node`的exports；标记`types`的入口全部解析；CSS/worker-only不误入Node；realpath不在repo | 必须 |
| npm empty project | 自动/artifact+外网依赖 | B3请求包+最小first-party tarball闭包+只读loopback scoped registry | 无override/alias/workspace/file；first-party名称/版本只解析到run-a bytes，registry config/evidence绿，依赖树绿 | 必须；外部依赖registry不可达则blocked |
| pnpm empty project | 自动/artifact+外网依赖 | B3请求包+最小first-party tarball闭包+只读loopback scoped registry | 同上，单runtime | 必须；外部依赖registry不可达则blocked |
| Vanilla/EditorShell/CSS | 自动/browser | B3 current browser projects | 真实mount/ready/destroy，CSS解析 | 必须 |
| React | 自动/browser | B3 React project | createRoot真实mount/unmount | 必须 |
| Vue | 自动/browser | B3 Vue project | createApp真实mount/unmount | 必须 |
| Worker | 自动/browser | B3 module Worker | native/docx/pdf export装载和安全失败 | 必须 |
| License runtime/identity | 自动/Node+browser | inventory模式smoke | golden token、worker、single/duplicate identity绿 | 必须 |
| collab-server assembly | 自动/Node | 独立`server-image` consumer/audit | Node import/依赖树绿，不进browser project；独立manifest/lock/registry config/evidence/audit/list和assembly evidence齐全 | 必须 |
| Phase 3 browser E2E | 自动/runner | `pnpm test:e2e:phase3`：只收集`examples/vanilla/tests`，覆盖Chromium/Firefox/WebKit及`perf-chromium` | Phase 3命令全绿且写入test report；根`pnpm test:e2e`值与全仓集合保持不变，DOCX/Collaboration JWL1 happy path不进入本阶段关单 | 必须，但不是最低认证 |
| visual regression | 自动/runner | `pnpm test:visual`读取canonical dist/run-a manifest | 不二次build，baseline/visual project全绿并写入test report | 必须 |
| Phase 3 benchmark | 自动/runner | `pnpm bench:phase3`：按序运行Gate 4.5 native、Gate 2 render和输入热路径三个非JWL1入口 | exit 0并写入test report；根`pnpm bench`值与全仓集合保持不变，Gate 5/6 JWL1 benchmark不进入本阶段关单 | 必须 |
| customer production assembly | 自动/artifact+外部registry | repo外经只读loopback scoped registry安装11包run-a闭包，冻结customer manifest/lock/config/registry evidence | 无workspace/link/override/file；first-party只解析到run-a，realpath不在repo；全部hash留证 | 必须；外部依赖服务不可用则blocked |
| server image assembly | 自动/artifact+外部registry | 独立repo外经只读loopback scoped registry安装`collab-server`及image-internal闭包，冻结server manifest/lock/config/registry evidence | 不混入客户项目；无workspace/link/override/file；first-party只解析到run-a，realpath不在repo；全部hash留证 | 必须；外部依赖服务不可用则blocked |
| production dependency audit | 自动/外部registry | 两个assembly目录分别执行`pnpm audit --prod --audit-level high --json` | 有效JSON且exit 0，customer/server各自high/critical为0，两套原始report/hash留证；外部错误与漏洞失败分开分类 | 必须；任一服务不可用则blocked |
| artifact/bundle size | 自动/artifact | B4 size script | contract固定8项预算全部存在且从run-a/consumer实际文件重算，空/缺失/额外/重复均失败，不重build | 必须 |
| reproducibility | 自动/clean | B4独立job生成run-b并compare | comparable tuple相同且raw hash相同；12个run-b原始tarball只进入受限reproducibility handoff，不成为消费/发布输入 | 必须 |
| final evidence binding | 自动/artifact | B4 final verifier读取五个固定root并生成第六个final-evidence | source/run-a无额外文件；三份evidence-manifest完整重算全部payload和registry证据；从run-a/run-b 24个原始tarball重算raw/payload/checksum；同SHA/lock/ID/hash；record/sidecar一致 | 必须 |
| SPDX SBOM | 自动/artifact | 两个assembly目录各自`pnpm list --prod --depth Infinity --json` + B4 generator | schema、两个assembly root、各自relationships、tarball和两套lock/list checksum完整 | 必须 |
| provenance predicate | 自动/artifact | B4 generator | in-toto `_type`、SLSA v1 `predicateType`、subject、`buildDefinition.resolvedDependencies`、`runDetails`与artifact identity一致；audit wrapper标记`unsigned` | 必须 |
| rollback rehearsal | 自动/离线 | B4 temporary state | 五个固定simulation-only action；health失败后pointer恢复prior hash；owner deferred、真实registry disabled | 必须 |
| version/changeset policy | 自动/离线 | synthetic `1.2.3` lockstep rehearsal | 11个npm包同步、Docker tag映射、draft完整 | Phase 3必须 |
| registry/2FA/dist-tag policy | 自动/离线 | synthetic public/restricted state | 2FA required；`next -> latest -> rollback`状态正确 | Phase 3必须 |
| approved version/changeset | 人工/外部 | 真实release input | 当前预期fail closed | Deferred，阻断真实publish |
| legal license | 人工/外部 | `LIC-013` | 法律批准并给出真实metadata | Deferred，阻断真实publish/商业GA |
| registry access/2FA | 人工/外部 | public/private registry账户 | access、2FA、token最小权限确认 | Deferred，阻断真实publish |
| signed provenance/attestation | 人工+外部 | registry/CI trust流程 | 签名可验证 | Deferred，阻断可信发布声明 |
| dist-tag/rollback owner | 人工/外部 | 发布runbook审批 | owner/previous version/命令批准 | Deferred，阻断真实publish |
| minimum browser | 人工/真实环境 | Chrome100/Edge100/Firefox128/Safari16.4 | `LIC-107B2`全矩阵证据 | Deferred，只阻断兼容声明/商业GA |
| real publish | 人工/禁止 | npm/private registry | 本阶段不运行 | Hard stop |

### 9.3 同一 SHA / artifact evidence 规则

- source report只写第6节第14项冻结的schema，包括`schemaVersion`、`clean`、`gitSha`、`lockfileSha256`、`environment`和commands/results；写完后计算raw file SHA-256到独立sidecar。artifactSetId尚未生成，不得预写或后改。
- artifact-build在run-a根目录生成固定`artifact-binding.json`，写入第6节第14项的精确字段。consumer、audit和compare必须通过显式CLI参数读取它并先验证binding、manifest重算ID和checksum；final verification从固定run-a sibling路径读取。所有下游record必须同时写`gitSha`、`lockfileSha256`、`artifactSetId`和binding raw bytes SHA-256。
- `artifact-final`逐bytes绑定source/test、manifest/checksum、binding及三份evidence-manifest列出的全部payload，拒绝五个输入root中的缺失/额外/symlink，生成固定schema的`final-verification.json`及raw-hash sidecar；B5必须用同一verifier的`--check-record`模式重验原始roots，本文件唯一authoritative ledger绑定artifactSetId和finalVerificationSha256，其余七份文档只保存固定引用。
- lint/typecheck/test:types是同一clean SHA的source gates；每条source命令、canonical build、pack以及注入run-a manifest后的direct Vitest/E2E/visual/bench命令均在返回后重新执行固定clean断言。不能声称source commands“从tarball运行”，但必须通过binding与同SHA/run-a关联。
- consumer/audit/size/SBOM/provenance只能读B4最终run-a；consumer与customer/server assembly的first-party解析只能通过第6节第9项只读loopback registry并保存config/evidence。audit/SBOM的依赖图只来自repo外两套assembly及各自冻结manifest/lockfile/registry evidence/list，不得读取repo workspace图或把两套结果合并为一个未分类集合。任何mtime变化、checksum mismatch、registry异常、缺包、assembly串线或重新pack立即终止。
- run-b只用于bit-for-bit reproducibility，不替换已被consumer验证的run-a，也不能在run-a失败后偷偷作为新基线；其原始tarball只保存在reproducibility handoff中供final verifier重算，consumer/audit/size/SBOM/provenance不得下载或读取。

## 10. External/manual gate 与自动 gate

### 10.1 自动且可在仓库/CI关闭

package contract、clean worktree、build/pack、inventory/hash、tarball/source/secret扫描、Node/npm/pnpm consumer、当前browser matrix、License identity、prod audit、size、SPDX、未签provenance predicate、rebuild compare、final evidence binding、synthetic version/changeset/registry/2FA/dist-tag readiness和offline rollback rehearsal。

其中 npm/pnpm install与audit依赖外部registry服务，但判定仍是自动的；audit按第6节第16项区分漏洞`failed`与服务/JSON `blocked`，服务不可用不是manual PASS。

### 10.2 必须保留人工或外部完成

- 法律`license`值和`LIC-013`；
- public/private registry实际access、organization policy、2FA和最小权限token；
- 正式version/changeset/changelog和package解除private的批准；Phase 3内部必须已有policy/rehearsal evidence，但真实输入保持blocked；
- signed provenance/registry attestation、dist-tag owner和真实rollback目标；
- 正式publish/交付和最低浏览器人工认证。

这些真实外部操作不阻断Phase 3内部实施或后续内部Phase 4/5/6，但Phase 3的对应policy、校验器、synthetic rehearsal和预期fail-closed evidence必须先Closed；任一真实项未完成都阻断publish，不得在B5把真实项标`Closed`或`Verified`。

### 10.3 Phase 3 内部关单所需的外部执行授权

- B0-B4实现和focused验证不授权agent创建commit、push、PR或修改远端；可连续执行到B4检查点1。
- B4检查点2必须有包含全部批准改动的clean commit、GitHub可读取的远端分支和用户执行或明确授权的PR；只有新workflow已存在于default branch时，`workflow_dispatch`才可作为同一ref的替代复跑入口。所需入口缺失会阻断Phase 3内部关单，与真实publish凭据无关。
- 用户只提供已有SHA/ref/run时，agent可以只读核对GitHub evidence；用户明确要求agent执行commit、push、PR或触发workflow时，权限也只扩展到该次明确操作，不包含publish、tag、dist-tag或合并。
- 远端workflow失败时按真实失败修复批准范围并重新形成新的clean SHA/run；禁止复用旧run-a或把本地模拟补写为GitHub handoff。

## 11. Rollback rehearsal 方案

1. B4 final run-a tarball按hash immutable，rehearsal不修改tarball。
2. fixture提供`latest -> priorVersion/priorArtifactSetId`和空`next`；临时candidate以synthetic `1.2.3`及当前Phase 3 artifactSetId进入`next`。
3. rehearsal依次校验prior/candidate manifest与checksum、将candidate从`next`提升到`latest`、模拟health gate失败、以原子写临时JSON把`latest`恢复到prior并清理candidate pointer。
4. 输出实际before/promoted/rolledBack三个state hash、固定`reason: simulated-health-check-failure`、`ownerStatus: deferred`和`realRegistryOperations: disabled`；不写虚构负责人或批准状态。
5. architecture test静态拒绝`npm publish`、`pnpm publish`、`dist-tag add/rm`、`git tag/push`和网络client；运行时使用repo外`mktemp -d`。
6. 没有真实previous registry version、owner、access、2FA和法律批准时，只能称offline rehearsal。真实registry runbook必须在这些人工输入获批后另行执行，本计划不指定执行阶段或自动启动。

## 12. 风险、Deferred 与硬停止条件

| 风险/条件 | 处理 |
| --- | --- |
| 历史203项dirty快照与当前implementation checkout混淆 | 第2.2节只保留历史观测；用户已明确授权在当前分支以`906ec700246a7020c7f82fd18c17fd50ee3fbcce`为base实施到B4检查点1。每批只允许批准patch并保护起始计划/提示词；该例外不授权commit/远端操作，也不替代B4检查点2的clean SHA/远端ref/PR |
| 批准文件已有用户staged hunks | 记录HEAD/index/worktree bytes及staged/unstaged patch hash；旧hunks逐byte保持，禁止整文件覆盖或仅靠范围外fingerprint验收 |
| source manifest与packed manifest分叉 | 单一contract生成packed manifest并把两者hash写inventory；scanner同时校验 |
| `0.0.0`依赖在npm/pnpm解析差异 | direct `file:`根闭包已实证为npm通过、pnpm 9.14.2对传递SemVer走registry并404；B0/B3改用本计划冻结的只读loopback scoped registry映射同一tarball bytes。任一失败停止并修订计划，不加override、手工lockfile、workspace/link、全局store预热或外部真实registry |
| npm/pnpm lockfile的registry origin证据不同 | npm lock校验loopback`resolved`和SHA-512 integrity；pnpm v9 lock只校验SHA-512 integrity，动态origin由无凭据`.npmrc`、canonical transcript、raw response和registry evidence共同证明。禁止要求pnpm lock保存动态端口，也禁止把metadata SHA-1误写成lockfile字段 |
| tarball raw hash非确定 | comparable tuple下直接失败；payload diff定位mtime/header或内容，不降级通过 |
| payload/checksum编码由实现自行解释 | 第6节冻结路径归一化、regular file集合、canonical payload preimage、ASCII tarball名、排序、两个空格、LF和单尾随换行；golden/mutation逐项锁定 |
| run-b摘要被一致改写 | reproducibility handoff保存12个原始run-b tarball；final verifier从bytes重算right raw/payload/checksum，摘要不能单独证明通过 |
| CI jobs重建不同产物 | artifact-build唯一上传run-a；consumer/audit禁止build/pack。只有reproducibility job可生成隔离run-b，且run-b禁止成为消费输入 |
| build/test修改tracked source或manifest | source、build、pack、direct Vitest/E2E/visual/bench及各job上传前执行统一porcelain clean断言；污染时不生成report/binding/evidence，不自动restore |
| public docs保留无参数third-party命令 | B3同步第7.2节全部文档和架构断言；无参数CLI稳定失败，当前命令必须显式manifest/binding且说明run-a前置条件 |
| direct Vitest测试内部按需build | `JWORD_PHASE3_ARTIFACT_MANIFEST`存在时Gate 2 fixture缺dist直接失败；architecture gate拒绝其他可达build fallback。普通测试入口保留现有兼容行为 |
| 缺少GitHub远端分支或PR触发授权 | B4实现可到检查点1；检查点2保持`Implementation Ready / final evidence pending`。agent不自行commit/push/PR，等待用户提供或授权clean SHA、远端分支和PR；新workflow已在default branch时才可改用`workflow_dispatch`复跑 |
| secret scanner泄漏marker | 只输出marker label和文件路径，不输出token/key/seed值 |
| native fixture被误删或例外扩大 | 保留现有manifest和tarball内精确`fixtures/registry.json`；contract/scanner核对根registry一致性、bytes/hash/预算/秘密扫描，其他fixture全部拒绝 |
| wrapper/worker失败暴露Phase 5/4问题 | 只在Phase 3允许的装载/生命周期seam修；需要业务迁移即硬停并路由后续阶段 |
| collab-server被当客户npm包 | contract/consumer test硬拒绝；只进入独立`server-image` assembly和对应audit/list/evidence，不混入customer assembly |
| audit registry不可用 | customer/server任一audit不可达都使B4保持open/blocked，不接受缓存、另一套结果或口头豁免 |
| SBOM first-party license未知 | SPDX `NOASSERTION`，真实发布继续blocked，不猜许可证 |
| provenance未签 | Statement保持标准SLSA v1结构，未签状态只写audit/readiness外层证据；不宣传trusted provenance |
| `LIC-107B2`未运行 | 保持Deferred，不阻断内部Phase 3；阻断最低版本声明和商业GA |
| Phase 3触碰LIC-200+、JWL1、Formats、Collab admission | 立即停止；不得扩大scope |
| 实现需要表外文件 | 立即停止，先修订计划并重新双轴复审 |
| 任一focused/full gate失败 | 不关单、不进入下一批；记录真实失败和归属 |
| reviewer非0 finding | 仅修批准范围，复跑受影响gate并重新独立复审 |

## 13. 文档回写清单与状态规则

### 13.1 每批回写

本文件为批次ledger；当前实施轮固定implementation base并记录起始计划/执行提示词bytes。每批只记录：implementation base SHA、base blob与当前Phase 3 patch hash、范围外fingerprint、修改文件、红灯命令/失败、最小实现、focused/expanded命令与exit、artifactSetId和finalVerificationSha256（最终run-a/final verifier后）、两个reviewer结论和未执行项。计划文本不能预先写成实施证据。

#### P3-B0 执行证据（2026-07-22）

- implementation base：`906ec700246a7020c7f82fd18c17fd50ee3fbcce`，branch：`feature/review_questions`。用户已明确授权在当前分支实施，覆盖 B0 前置的 clean-checkout 启动阻断；未授权 commit、push、PR、tag 或 publish。起始受保护资产仍为已 staged 的本计划和 untracked 的执行提示词；本批未改写这两项范围外资产。
- B0 允许文件：新增 `docs/current-implementation/release-artifact-contract.md`、`tools/release/package-artifact-contract.json`、`tests/architecture/phase3-package-artifact-contract.test.ts`、`tests/architecture/phase3-package-artifact-registry.test.ts`，以及本节 evidence。实施完成bytes SHA-256依次为`e28dd69c9be78b2f00d2619abca87c0018223634fade4742f41fae2aef4edc3c`、`b4502539977099cbe341fa5c1b6e5f2afa4a1d40dfa5da88a74c8a893a81a00b`、`c6459d1f412deae4969d1423c8268ab280533228e50486ae70e07846ee101a48`、`ee1beace7d3b508fd7e839074d63a0bbdd1decc386355a8e223c329572ed568c`；contract hash为`b4502539977099cbe341fa5c1b6e5f2afa4a1d40dfa5da88a74c8a893a81a00b`。起始执行提示词保持SHA-256 `7043b6854d27f104008bec162a70743e35402e7fd7eb6ef5c2876e8f1dbcf0e5`，未被改写。
- 红灯 1：`pnpm exec vitest run tests/architecture/phase3-package-artifact-contract.test.ts --reporter=verbose`，exit `1`；在 contract 尚不存在时按预期以 `ENOENT tools/release/package-artifact-contract.json` 失败。
- 最小实现：写入上述机器 contract 和人类可读 contract；未修改 source manifest、runtime source 或现有 release script。
- focused 红灯 2：同一命令，exit `1`。`npm 11.9.0` synthetic `leaf -> base@0.0.0` 显式 `file:` 闭包先通过；`pnpm 9.14.2` 随后在安装 leaf 的传递依赖 `jword-phase3-base@0.0.0` 时访问 `https://registry.npmjs.org/jword-phase3-base` 并返回 `ERR_PNPM_FETCH_404`。该失败说明当前“npm 与 pnpm 均以两个 direct file tarball 证明 semver 传递闭包”的 B0 机制不能成立。
- 原计划 hard stop：当时不得用 `overrides`、`resolutions`、alias、workspace/link 或未规划的local registry改写预检。`pnpm typecheck`、`pnpm lint`、B0 scope/comment/line-count 双轴复审、B1 及后续批次均未执行；`artifactSetId`、`finalVerificationSha256` 和 reviewer 结论均为 `not-generated / not-run`。B0 因此进入`Blocked / plan revision required`；本次修订只允许第6节第9项已冻结、可留证的只读loopback scoped registry，其他绕过仍禁止。
- 只读诊断：保持相同两个tarball和packed `base@0.0.0` dependency时，pnpm baseline、`node-linker=hoisted`、隔离store预热和`pnpm import`均exit `1`；独立进程的只读loopback registry probe使npm/pnpm均exit `0`，两者root/leaf均解析到同一仓库外base realpath。由此按第6节第9项修订B0/B3/B4 consumer/assembly机制；实现继续保持hard stop，直到修订稿 Standards/Spec 对同一SHA均为`PASS / 0 finding`。
- 修订稿复审第20轮：Standards对SHA-256 `ba03a87c60598c4a8bf92bfe1e57b86987b7eb32c71f5441340f206f4f23a2b9`回报`REQUEST CHANGES / 1 finding`，指出文档头错误保留“implementation not started/PASS”状态；Spec对同一SHA回报`REQUEST CHANGES / 2 findings`，指出registry evidence缺少可独立重算的metadata/transcript/raw response，以及npm/pnpm lockfile origin字段被错误统一。本轮已把头部改为B0 blocked/pending，冻结metadata/tarball raw bytes、canonical transcript及SHA-1/SRI重算，并按npm `resolved`+integrity与pnpm v9 integrity+transcript origin分支校验；当前仍保持blocked，等待新冻结SHA的独立双轴`PASS / 0 finding`。
- 修订稿复审第21轮：Standards与Spec均对SHA-256 `0b1c2d0f5ae07ae61b8a7b1f31a443a2da187244259a195fabb6f4e490a37e27`回报`REQUEST CHANGES / 1 finding`，共同指出可选HEAD的header校验没有对应transcript字段且与“只按method/path/status留证”冲突。本轮删除header证据要求，冻结为完整transcript条目加canonical空response raw bytes，payload identity只由必需GET证明；当前仍保持blocked，等待新冻结SHA的独立双轴`PASS / 0 finding`。
- 修订稿复审第22轮：Standards对SHA-256 `6992579fff8fe981629532de9a427ecee00d6c394e29eb1d95a1586f52aea729`回报`REQUEST CHANGES / 3 findings`，指出头部状态落后、动态端口与metadata raw bytes约束冲突、旧dirty hard stop与当前授权冲突；Spec对同一SHA回报`REQUEST CHANGES / 1 finding`，同样指出头部状态落后。本轮同步第23轮pending状态，明确动态端口只禁入静态contract/golden而允许进入运行时metadata证据，并把当前分支授权限定为implementation base上的批准patch和B4检查点1；当前仍保持blocked，等待新冻结SHA的独立双轴`PASS / 0 finding`。
- 修订稿复审第23轮：Standards对SHA-256 `115c86283b0479d8a2787a82a5cd7e5b857a3f6496961091a3588329ce3aa8f3`回报`REQUEST CHANGES / 1 finding`，指出B2/B3前置和计划编制完成清单仍用独立checkout/当前workspace阻断旧措辞；Spec对同一SHA回报`PASS / 0 finding`。本轮统一为第2.3节授权的当前checkout可连续实施至B4检查点1，仍只允许起始受保护资产和批准patch；当前保持blocked，等待第24轮冻结SHA的独立双轴`PASS / 0 finding`。
- 修订稿复审第24轮：Standards与Spec均对SHA-256 `3d21bcde1df06429c3e8ae20dd82c59d2ca4a128a34ff938c4a49665c1150976`回报`PASS / 0 finding`，B0据此恢复实施。随后新增精确`registryPolicy`断言先以contract缺字段稳定红；补入字段后，旧direct `file:`实现再次证明npm通过而pnpm为传递`base@0.0.0`请求公网并404，且子进程继承了用户registry credential环境，虽输出隐藏值仍违反无凭据约束。迁入同进程loopback registry的实现继续推进时，focused test以未预创建`consumer-pnpm/tmp`导致的`ENOENT`失败；这是尚未修复的实现细节，不是新的contract结论。
- 第25轮scope/file-budget hard stop：上述loopback registry、隔离环境、registry transcript/raw response和npm/pnpm lock分支校验使`phase3-package-artifact-contract.test.ts`达到1152行，违反第7.3节“达到1000行前必须拆分”。因此在修复`TMPDIR`前停止实现，新增单一职责`phase3-package-artifact-registry.test.ts`并把synthetic registry closure完整迁入；contract test保留机器contract中的`registryPolicy`精确断言。当时B0继续blocked，直到计划对同一新SHA完成Standards/Spec双轴`PASS / 0 finding`。
- 修订稿复审第25轮：Standards对SHA-256 `ad8f9d4f2e768218243f473260b501d4621c05bd4282c37b50a577458f9d8e92`回报`REQUEST CHANGES / 1 finding`，指出9.2仍把focused阶段新增test总数写为4；Spec对同一SHA回报`PASS / 0 finding`。第26轮只把9.2及B5同类旧计数统一为5，其他scope、contract和状态迁移保持不变；当时继续blocked，等待同一新SHA的独立双轴`PASS / 0 finding`。
- 修订稿复审第26轮：Standards与Spec均对SHA-256 `f9b4a5e0b6bc3793495d1509f97fad334a3370e80014ff9b5e3bc6db2d72a6bc`回报`PASS / 0 finding`，行数998且首尾无漂移；B0据此恢复实现。
- 拆分后focused红灯：`pnpm exec vitest run tests/architecture/phase3-package-artifact-contract.test.ts tests/architecture/phase3-package-artifact-registry.test.ts --reporter=verbose`，exit `1`；contract test通过，registry test以pnpm对未预创建`consumer-pnpm/tmp`执行`realpath`时`ENOENT`失败。预创建独立`TMPDIR`后，同一命令仍exit `1`，证明pnpm 9.14.2当前会在lockfile `tarball`字段保存loopback URL；删除“必须不含动态端口”的过度断言，只保留计划要求的integrity与独立origin证据后，同一命令exit `0`。
- registry evidence红绿：在同一registry test加入读取侧断言但尚未写入evidence时，focused命令exit `1`并以`ENOENT consumer-npm/registry-evidence.json`失败；最小实现把动态origin写入canonical transcript，并保存精确policy、served package、metadata/tarball raw response hash/bytes、SHA-1、SHA-512 SRI、SHA-256、请求计数和unexpected/write计数。最终复跑同一focused命令exit `0`，2个test/2个test通过；npm lock按loopback `resolved`+integrity校验，pnpm v9按integrity校验并由无凭据`.npmrc`、transcript、raw response与registry evidence证明origin，root/leaf只解析到一个repo外realpath。
- expanded验证：`pnpm typecheck` exit `0`。`pnpm lint`首次exit `1`，只报告registry test一个无效初值和三个TypeScript内联对象成员分隔符；精确修正后复跑完整`pnpm lint` exit `0`，ESLint、package version、boundary和comment lint全部通过；随后再次复跑focused命令exit `0`。
- 实现patch首轮复审：Standards对计划SHA-256 `7ea046e8e81483cbdae05d7de276a0ecd2715526af895d86256dc4a53f56d3b9`冻结的B0文件回报`REQUEST CHANGES / 2 findings`，指出npm/pnpm复用可变session计数且读取侧未从落盘raw response独立重算，以及synthetic `npm pack`继承用户环境；Spec对同一快照回报`REQUEST CHANGES / 1 finding`，同样阻断跨install累计计数。其余scope、职责、注释、loopback只读边界与pnpm动态端口语义通过。
- blocker修复：每次启动registry先重置metadata path与两类请求计数；读取侧从持久化transcript逐项打开metadata/tarball raw response，精确重算当前install的GET计数、SHA-1、SHA-512 SRI、SHA-256和bytes，再与registry evidence比较。synthetic pack改用只含`PATH/HOME/TMPDIR/LANG/CI/NPM_CONFIG_USERCONFIG/NPM_CONFIG_CACHE`的最小环境、独立目录和无凭据userconfig；npm/pnpm install环境也用精确key集合断言防止credential回流。
- blocker回归：同一focused命令exit `0`，2个test/2个test通过；`pnpm typecheck` exit `0`。`pnpm lint`首次因三处`NodeJS`全局类型触发`no-undef`而exit `1`，收窄为`Record<string, string>`后复跑完整lint exit `0`；随后并行复跑focused与typecheck均exit `0`。
- scope/comment/file-budget：`phase3-package-artifact-contract.test.ts`为749行，`phase3-package-artifact-registry.test.ts`为642行；函数清单及两个registry session getter均逐项`comment-pass`。`git diff --check`与`git diff --cached --check`均exit `0`；四个B0新文件分别执行`git diff --no-index --check /dev/null <file>`均exit `1`且无diagnostic，仅表示新文件差异。`git status --short`只含起始计划/执行提示词及四个B0新增文件，没有范围外路径。
- B0实现复审：Standards与Spec均只读核对1007行、SHA-256 `29ec01324d4dcce6a7aa72ede4b22a03669064c9b1c3d68c3a88ec78f8b70b24`的同一冻结快照并回报`PASS / 0 finding`。Standards确认每次registry session计数隔离、落盘transcript/raw response独立重算、pack/install精确无凭据环境、全部函数中文注释、749/642行文件预算和scope/whitespace均通过；Spec确认synthetic `leaf -> base` npm/pnpm闭包及证据满足B0 contract。
- 当前状态：B0为`Implementation Ready / final evidence pending`并允许进入B1；`artifactSetId`与`finalVerificationSha256`仍为`not-generated`，`LIC-107B2`仍为`Deferred/not-run`，未执行build、JWord pack、publish、commit、push、PR或tag。

#### P3-B1 执行证据（2026-07-22）

- 最小红灯：只在`phase3-package-artifact-contract.test.ts`加入统一scanner公开CLI seam，执行该单文件focused命令exit `1`，contract测试通过而scanner以`MODULE_NOT_FOUND tools/release/check-package-artifacts.mjs`稳定失败。
- 最小实现：新增`tools/release/check-package-artifacts.mjs`，以结构化JSON校验source manifest、显式synthetic tarball及artifact manifest；统一拒绝source/test/非批准fixture/非声明TypeScript/map/source map marker/build script/repo依赖/private key/test或production signer，并只输出标签与路径。native只允许精确`fixtures/registry.json`且bytes必须与根registry一致。四个既有native/Gate 5/Gate 6/Gate 7入口改为default/source与显式artifact/synthetic两类只读模式，公共规则委托scanner，领域规则保留，任何模式均无build/pack/publish fallback。
- scanner回归：仓库外synthetic tarball在同一test内证明Core有效包通过，逐项mutation稳定失败，native精确registry通过而第二个/改名/其他package fixture失败；有效tar root目录项修复后同一seam转绿。四个既有architecture test在`PATH`前置npm/pnpm命令trap运行各入口，均返回`mode: source`、`packCommands: 0`且可观测调用日志为空。
- focused绿灯：计划固定的5文件Vitest命令exit `0`，5 files / 27 tests通过；`node tools/release/check-package-artifacts.mjs --check-source-manifests` exit `0`并报告12包。expanded：`pnpm test:types`、`pnpm typecheck`均exit `0`；`pnpm lint`先因scanner正则三个多余转义、随后因四个文件头英文命令串被comment lint拒绝而exit `1`，精确修正后完整lint exit `0`，再复跑focused仍exit `0`。
- scope/comment/file-budget：scanner 616行；四个script为67/181/83/60行；contract/native/Gate5/Gate6/Gate7 test为956/86/325/442/147行。新增/修改命名函数均有前置中文注释，十个文件均低于1000行；重叠文件相对implementation base无预存hunk，当前仅含B1批准patch。`git diff --check`与`git diff --cached --check`均exit `0`。
- 首轮实现复审：Standards对1017行、SHA-256 `1c76ae8646b22c5532ae4f36eca62994987dbd0b2ce96719ea6c4a4536cdda6c`的冻结快照回报`REQUEST CHANGES / 4 findings`，指出嵌套test/spec和`.tsx`路径、全regular-file signer/private-key/source-map bytes扫描、点名回调中文注释及三处无效逻辑；Spec对同一快照回报`REQUEST CHANGES / 2 findings`，指出source/packed manifest未锁定`type: module`且contract声明的`README.md`未被要求实际入包。其余B1 scope、三种scanner模式、native registry bytes、四入口无pack、文件预算与既有focused结果通过。
- blocker修复与回归：scanner现在拒绝任意层级test/spec/snapshot路径和所有非declaration TypeScript扩展，对全部regular file bytes扫描source-map、通用/RSA/EC/OpenSSH private key及test/production signer marker；source与packed manifest都锁定`type: module`，声明`README.md`的包必须实际包含该文件。contract test加入最少nested test、`.tsx`、HTML source-map/RSA key、missing README与missing type mutation；删除丢弃结果、恒真分支和重复三元表达式，并为reviewer点名回调补中文注释。原5文件focused命令复跑exit `0`，仍为5 files / 27 tests；source scanner报告12包且exit `0`，`pnpm test:types`与`pnpm typecheck`均exit `0`。完整`pnpm lint`首次只因误删仍被路径边界使用的`isAbsolute` import而exit `1`，恢复import后完整lint及focused并行复跑均exit `0`。当前scanner/contract test为635/974行，四个既有test为89/328/445/151行；`git diff --check`与`git diff --cached --check`均exit `0`。
- 第二轮复审：Spec对1019行、SHA-256 `4bfafa659b44bcc505e084c34892b955a3f6fe0bc75fd2c320d3920522b1a201`回报`PASS / 0 finding`；Standards回报`REQUEST CHANGES / 1 finding`，指出tarball `package.json`在marker扫描前触发的原生`JSON.parse`错误会回显signer/seed前缀。scanner现把tarball、contract、source manifest和artifact manifest的JSON解析错误统一收敛为固定label，不透传解析器message；新增包含`createInsecureTestOnlyJWordLicenseSignature`前缀的malformed package.json mutation并断言连`createInse`片段也不输出。原5文件focused、source scanner、`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`均再次exit `0`；scanner/contract test为647/978行，两类diff check均exit `0`。
- B1最终实现复审：Standards与Spec均对1020行、SHA-256 `91416414d3c3a5205cf01af58c7af6ac5f20d256eca7ff2c63142822206ac5ad`的同一冻结快照回报`PASS / 0 finding`。Standards确认全部JSON解析诊断不回显parser message或signer/seed片段、前两轮finding保持关闭、十个code/test文件均低于1000行且scope/comment/whitespace/无pack通过；Spec确认`type: module`、required README、scanner三模式和四入口只读contract无回归。
- 当前状态：B1为`Implementation Ready / final evidence pending`并允许进入B2。未执行JWord build/pack、publish、commit、push、PR、tag；`artifactSetId`与`finalVerificationSha256`仍为`not-generated`，`LIC-107B2`仍为`Deferred/not-run`。

#### P3-B2 执行证据（2026-07-22）

- implementation base仍为`906ec700246a7020c7f82fd18c17fd50ee3fbcce`。本批只新增`phase3-artifact-utils.mjs`、`build-phase3-artifacts.mjs`、`compare-phase3-artifacts.mjs`、`phase3-artifact-build.test.ts`，修改第7.2节批准的四个release入口、四个architecture test、根`package.json`和本ledger；未修改表外文件。受保护执行提示词保持SHA-256 `7043b6854d27f104008bec162a70743e35402e7fd7eb6ef5c2876e8f1dbcf0e5`。
- 初始红灯：`pnpm exec vitest run tests/architecture/phase3-artifact-build.test.ts --reporter=verbose`因三个B2入口不存在而exit `1`。最小实现加入共享canonical/hash/environment/clean/path工具、source/canonical/repro builder、compare入口和两个根script；全部production输出只接受repo外空目录，本实施checkout未运行JWord build/pack。
- synthetic public seam覆盖：repo外Git/package fixture证明staged、unstaged、non-ignored untracked、source/build/pack/direct污染均fail closed；canonical为一次build、两包各一次dry-run/pack/scanner，生成精确source/test report、sidecar、inventory、checksum、artifactSetId和binding；逐项覆盖files/checksum/sidecar/tarball filename/environment/identity/runMetadata/tuple/raw mismatch mutation。十二包集中式inventory在npm/pnpm PATH trap下依次调用native/Gate 5/Gate 6/Gate 7，四入口均为`mode: artifact`、`packCommands: 0`且trap为空。
- 初次绿灯与扩大验证：B2单文件7 tests通过；计划固定6文件focused为6 files / 34 tests通过；`pnpm typecheck`、`pnpm lint`、`git diff --check`和`git diff --cached --check`均exit `0`。过程中只修正测试`.mjs`声明、`unknown`收窄、中文文件头与两个隐式`any`，同一gate均复跑转绿。
- 首轮实现复审：Standards回报`REQUEST CHANGES / 1 finding`，实测repo外父目录symlink可把builder输出写回repo内ignored目录。Spec回报`REQUEST CHANGES / 6 findings`：除ledger缺失外，指出compare未从handoff副本重建run-b manifest/checksum、跨OS/arch manifest在tuple前被当前进程拒绝、未记录binding raw hash、Node版本未执行`--version`、同一symlink路径问题。
- blocker红绿：先只改测试，复跑`-t 'fails closed for staged|builds and compares'`稳定exit `1`，分别观测builder错误exit `0`和缺失`reproducibility-evidence.json`；共享path helper随后在首次创建前解析最深现存父目录物理路径，builder/compare均拒绝实际repo内目标。compare使用不重探测平台的严格schema校验，使foreign OS进入tuple并返回`not-comparable`；从复制后的run-b bytes重算tarball hash/bytes、checksum和manifest，写入binding raw SHA-256 summary；Node版本改为当前Node executable的`--version`单行输出。同一targeted命令转为2 passed / 5 skipped，完整B2单文件再次7/7通过。
- blocker后focused/expanded：计划固定6文件focused再次6 files / 34 tests通过；`pnpm typecheck`、完整`pnpm lint`、两类diff check再次exit `0`。全部B2 code/test行数为609/668/221/962、76/190/92/69、94/333/450/156，均低于1000；新增/修改函数清单已逐项具备前置中文注释。四个新B2文件当前bytes SHA-256依次为`70e857819a81274fe75060769e3045d7aeee29db10d961c86901db36a9d35916`、`1d35cfec5ad05d4eebdc61afbf79545b659a5654e8c14cc941deb13e24bb63a9`、`5b02060066b03dcf5307fdcd932fefac3ee2bb950d68fc8459699826b0b0393d`、`0e862cb92a1bfbc562b24aca11607a6fcecb12a0b63a8d9c9c8f63753153ffaf`。
- B2最终实现复审：Standards与Spec均对1032行、SHA-256 `c6f26987bf92f7fe48bb79ee4e58678ba7e794e40758671e234147effc52a41e`的同一冻结快照回报`PASS / 0 finding`。Standards确认物理路径、focused/expanded gate、文件预算、中文注释、dirty保护和repo外synthetic边界无回归；Spec确认compare副本重建、跨平台tuple、binding raw hash、Node版本、symlink fail-closed和ledger证据均闭合。
- 当前状态：B2为`Implementation Ready / final evidence pending`并允许进入B3；本批没有JWord run-a、JWord `artifactSetId`或`finalVerificationSha256`，均为`not-generated`。未执行JWord build/pack、publish、commit、push、PR、tag；`LIC-107B2`保持`Deferred/not-run`。

#### P3-B3 执行证据（2026-07-22）

- implementation base仍为`906ec700246a7020c7f82fd18c17fd50ee3fbcce`。本批只新增`check-phase3-third-party-consumers.mjs`、`phase3-consumer-projects.mjs`和`phase3-third-party-consumers.test.ts`，修改第7.2节批准的Gate 5/6/7、License、architecture test、SDK/current-implementation/OEM/README文档与本ledger；未修改表外文件。
- synthetic feedback loop红灯：`pnpm exec vitest run tests/architecture/phase3-third-party-consumers.test.ts`首先为1 passed / 1 failed，Node types probe的`tsc` exit `1`；实现收敛后的同一公开CLI seam又曾因source evidence缺少`files`字段返回`Cannot convert undefined or null to object`而为1 passed / 1 failed。最小修复统一types/source输入并把完整source file集写入handoff；同一单文件命令随后2/2通过。
- 最小实现：npm/pnpm每个journey使用独立空目录、无凭据config/cache/store和只读loopback registry；从contract派生requested/closure、逐export Node/types/browser/Worker/License源码和固定tuple。registry evidence锁定精确schema、allowlist、GET/HEAD、request计数、metadata/tarball raw bytes及SHA-1/SHA-512 SRI/SHA-256；npm校验loopback `resolved`+integrity，pnpm v9只校验integrity并由config/transcript/raw response证明origin。Gate 5/6/7与两个License入口不再冒充runtime证据，显式输出`legacy-non-gating`与`delegated-to-phase3-consumer`。
- mutation与文档收紧：最少4个test在同一architecture文件内覆盖contract raw bytes、install固定路径、闭包集合/排序、registry/transcript/raw response、npm/pnpm lockfile、双runtime bundle tuple、真实wrapper/EditorShell/Worker源码和repo内`TMPDIR`拒绝；第7.2节当前命令均使用`PHASE3_RUN_A_ROOT` guard与manifest/binding。10号验证计划已明确Phase 3 License兼容入口本身不执行runtime语义；历史`check-license-minimum-node.mjs`/`--node-only`路径不属于B3绿灯，本批未执行或改写，`LIC-107B2`仍按`Deferred/not-run`边界解释。
- 首轮实现复审：Standards回报`REQUEST CHANGES / 2 findings`，指出React/Vue生成源码导入不存在的`JWordEditor`，以及`tmpdir()`未验证物理repo外边界；Spec回报`REQUEST CHANGES / 4 findings`，另指出Vanilla及native/DOCX/PDF根export未直接消费、Vanilla错误等待不存在的`editor.ready`且CSS证据不足、production runner缺少clean checkpoint。两轴均未把历史`LIC-107B2 --node-only`路径计入B3 finding。
- blocker红绿：先只扩展同一architecture public seam，单文件为2 passed / 2 failed，稳定观测错误wrapper导出与repo内`TMPDIR`未在创建前fail closed。最小实现改用`JWordReactEditor`/`JWordVueEditor`并断言真实wrapper DOM；Vanilla按contract直接import core/UI/devtools、断言EditorShell DOM及`.jw-toolbar` computed style后destroy；module-worker journey直接import native/DOCX/PDF根入口，并把`vite-browser`/`dedicated-worker`拆为各自实际build/serve/browser执行和bundle bytes；正式contract路径在每个install、顶层runner及handoff写入前后执行精确clean checkpoint，synthetic contract不能冒充正式JWord证据；temp root在创建前按物理路径拒绝repo内目标。同一单文件随后4/4通过。
- blocker后最终focused：计划固定7文件命令exit `0`，7 files / 41 tests通过。expanded：`pnpm test:types`、`pnpm typecheck`与完整`pnpm lint`均exit `0`；`git diff --check`和`git diff --cached --check`通过，全部untracked no-index whitespace检查在最终冻结前重新执行。此前lint曾只因consumer runner文件头的英文模块名和新增测试三处双引号规则失败，均按仓库规则最小修正并复跑转绿。
- 第二轮Standards复审回报`REQUEST CHANGES / 2 findings`：License `vite-browser`的辅助`license-worker.js`只进入临时project、没有复制到consumer handoff，以及B4文件表遗漏`phase3-artifact-build.test.ts`的`B2/B4`归属。先在source handoff公开函数上加入最小断言，依次稳定红为`writeConsumerSources is not a function`和辅助文件`ENOENT`；只导出现有writer并把`sourceRecord.files`写入同一`raw/sources/<sourceId>/`后，同一targeted test转绿。第7.1/7.2节同时补齐compare与architecture test的B4职责，未扩大到其他文件。
- blocker后计划固定7文件focused再次exit `0`，仍为7 files / 41 tests；`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`均exit `0`。当前B3三个新文件为998/386/812行，bytes SHA-256依次为`b5feb7c918a9d279870d4d644dfdb7615cf5427d36ebe1186c652fe22f3fb668`、`328a3027aaaa6e82349b7b96b8c76aa7bef211314230db8814202c04d064f6ef`、`20df930975dc1c179df330a1b0f961e2b1e68d1259c05857081ee9adb4d722b5`；新增/修改的独立函数具备中文前置注释，全部code/test文件仍低于1000行。本批没有JWord run-a、`artifactSetId`或`finalVerificationSha256`，未执行JWord build/pack、publish、commit、push、PR或tag；当前状态仍为`In Progress / implementation re-review pending`，只有B3双轴`PASS / 0 finding`后才能进入B4检查点1。
- 第三轮Spec复审回报`REQUEST CHANGES / 3 findings`：native module Worker入口只导出binder而未在worker global注册监听；License `dedicated-worker`错误地把worker源码作为页面入口，无法建立ready证据；`docs/sdk/public-api.md`把legacy Gate 7 CLI误述为实际安装、Vite和浏览器验证。最小修复新增通过公开`@4xian/jword-native/worker`调用`bindJWordNativeWorkerRuntime(globalThis)`的`native-worker.js`，License页面probe改为启动同一source handoff内的`license-worker.js`，并把legacy CLI明确限定为`legacy-non-gating` binding检查、真实矩阵由Phase 3 consumer runner执行。定向`defines|generates`测试先因旧断言仍要求主页面直接包含native worker specifier而失败；断言改为检查wrapper文件的specifier与bind调用后，同一命令2/2通过。随后计划固定7文件focused重新为7 files / 41 tests，`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`均exit `0`。当前B3三个新文件为998/396/836行，bytes SHA-256依次为`b5feb7c918a9d279870d4d644dfdb7615cf5427d36ebe1186c652fe22f3fb668`、`83e5b33b3d86391b04556be401270b1252c39550a54bfcb589f123ca5416dba5`、`42fc602e2c9d526c621a9d91382f18cb39e43bf0a55d4b361835125dadea4572`；同步修改的`docs/sdk/public-api.md`为608行、bytes SHA-256 `88aa37a8d60f36d874cb983d6a31a428bac78a34a67ee40aa37fb498eacb848c`。全部code/test文件仍低于1000行；当前状态继续为`In Progress / implementation re-review pending`，等待最新冻结快照双轴`PASS / 0 finding`。
- 随后的Spec复审回报`PASS / 0 finding`；Standards复审回报`REQUEST CHANGES / 1 finding`，指出License Node probe把含production golden token的完整源码作为`node --eval`参数，任一子进程失败都可能由`execFile`错误消息把源码和token回显到CI stderr。最小回归先锁定runner不得包含`--eval`并稳定1/1失败；实现改为在repo外install目录写`phase3-node.mjs`，License源码只从`JWORD_PHASE3_LICENSE_TOKEN`读取token，runner仅向该Node子进程环境注入值。新增实际失败probe断言父进程错误消息不含sentinel token，定向`defines|does not expose`为2/2通过。完整计划固定7文件focused随后两次均为7 files / 42 tests，`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`两次均exit `0`；第一次复跑后还把runner从1007行收敛至999行并再次验证。当前B3三个新文件为999/398/856行，bytes SHA-256依次为`42ff12a54b8ee5802848c65f6e6bb7765463304eadb796737a28459522853ece`、`6bee7e86c283fb657a953e1967a8280872c1aaa9bce8b9c9df92c562fda12498`、`7d057642149b7c5b6dbabc49451de450080acde5eb22092520af69e6fad280ca`；全部code/test文件低于1000行，等待同一最新冻结快照最终双轴复审。
- B3最终冻结快照为本计划1052行、SHA-256 `65ad7c61f19e173786cad5a58b0d8e7db76723fece00c6aa686d1282dca7880e`。Standards与Spec均回报`PASS / 0 finding`：前者确认token泄漏链、文件预算、中文注释、scope及whitespace全部关闭，后者确认Node双runtime参数、golden token语义、source/evidence绑定及先前三项Spec blocker均保持关闭。B3状态更新为`Implementation Ready / final evidence pending`，正式允许进入B4检查点1；仍未生成JWord run-a或最终artifact evidence。

#### P3-B4 进入前范围修订（2026-07-22）

- 实现前核对发现第6节第20项、第8节B4最小实现和expanded命令均要求compare生成覆盖受限reproducibility root的`evidence-manifest.json`，但B2 compare尚未生成，且原第7节没有批准B4修改compare/test。按第7.2节hard stop规则先修订范围，把`compare-phase3-artifacts.mjs`和`phase3-artifact-build.test.ts`明确标为`B2/B4`并加入B4精确修改清单；该修订不把B3标绿，也不表示已进入B4检查点1。
- 预先锁定的compare CLI seam先因缺失`evidence-manifest.json`稳定exit `1`；最小实现递归枚举regular file、拒绝symlink、排除manifest自列，按POSIX path排序写固定`{ schemaVersion, evidenceType, files }`。同一targeted test转绿，B2单文件完整7/7、B3单文件4/4、`pnpm test:types`、`pnpm typecheck`和`pnpm lint`均exit `0`。compare/test当前为255/977行，bytes SHA-256分别为`79c35f31db07a268f9f6148166f1e37e00506ecc4065d9698452e2379123b75e`、`88f8a8b7c48672a9d7587be9117553d2a94a4e1d51c78a4b34d9e4d07f792a2d`；等待修订范围与B3实现双轴复审通过后才正式进入B4。

#### P3-B4 检查点1执行证据（2026-07-22）

- implementation base仍为`906ec700246a7020c7f82fd18c17fd50ee3fbcce`。B4按第7节批准范围新增release gate/final verifier、size、SBOM、provenance、rollback fixture与architecture test，修改CI、package scripts、compare、artifact-build test、visual、Gate 2和本ledger；相对base的其余差异仍是B0-B3批准patch或起始受保护的执行提示词，`node-compile-cache/`保持未处理。没有reset、checkout、restore、clean、`git add`、commit、push、PR、tag、publish或dist-tag。
- B4最小实现把CI拆为source、唯一run-a artifact、consumer、双assembly audit、隔离run-b reproducibility和final六段handoff；final verifier逐bytes绑定source/run-a/consumer/audit/reproducibility，重算run-a/run-b tarball、consumer source/bundle、assembly manifest/registry raw bytes、size、SBOM、provenance、readiness和rollback。release runner使用无凭据子进程环境，并在执行audit前调用完整`validateConsumerRoot`，不再只信consumer summary；customer/server dependency realpath必须通过`realpathSync`落在仓库外。readiness/rollback validator已拆至`phase3-release-policy-utils.mjs`，从contract与`release-policy.json`重新派生17个check、candidate版本、registry分层和6步command plan，并要求health failure、candidate清理及prior pointer hash恢复。
- 红绿证据均在synthetic seam完成：consumer source与assembly manifest同步hash mutation先红后绿；错误job Git SHA稳定失败后转绿；无凭据环境结构断言先因缺少`createCleanConsumerEnvironment`稳定失败，再以同一test达到1 passed / 10 skipped；完整consumer handoff结构断言先因仍调用`validateConsumerInput`失败，接入`validateConsumerRoot`后同一test转绿；assembly registry公开校验入口先以`validateAssemblyRegistry is not a function`稳定失败，最小导出现有函数后，同一test证明served顺序、非allowlist transcript path、目标错误而后续无关block保留原integrity、错误integrity、第二条GET响应替换及同步改写metadata raw bytes/hash均稳定拒绝；readiness policy分层交换及缺失/重复/未知check、rollback health/candidate、repo内symlink也稳定拒绝。
- 首轮focused红灯为4项：consumer/audit上传缺少隐藏文件、SBOM无first-party checksum、assembly允许空dependencies、Tarball校验入口缺失；按同一public seam修复后，`pnpm exec vitest run tests/architecture/phase3-release-gates.test.ts`为13/13，组合命令`pnpm exec vitest run tests/architecture/phase3-release-gates.test.ts tests/architecture/phase3-artifact-build.test.ts`为2 files / 20 tests通过。随后收紧job-scoped CI/no-build断言，并补充symlink/hardlink archive拒绝、物理realpath、lockfile package/version绑定和逐GET raw bytes重算。`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`均exit `0`；未运行会触发build的根`pnpm test`。
- `--check-environment`用repo外临时source report实测通过，返回Node `v24.14.0`、npm `11.9.0`、pnpm `9.14.2`、`darwin/arm64`，并同时绑定当前Git SHA与lockfile hash。`git diff --check`、`git diff --cached --check`通过；当前dirty workspace中的既有范围外文件与`node-compile-cache/`均未处理，未执行cleanup、stage、commit或远端操作。
- Spec复审首先发现final verifier用canonical reader读取缩进的静态`release-policy.json`，会在readiness语义前稳定失败；该单一P1已把读取方式收敛为与rollback fixture一致的`readJsonFile`，policy字段/集合仍由独立validator严格重算。修复后focused 13/13、组合2 files / 20 tests、`pnpm test:types`、`pnpm typecheck`和完整`pnpm lint`再次全部exit `0`。
- B4新增/修改核心文件当前行数与SHA-256为：`check-phase3-release-gates.mjs` 560 / `05cec68039d889e6df00b498cc778a4b2e3b7d1a81207b88827b72db1e67bf84`；`verify-phase3-final-evidence.mjs` 983 / `5bb301f56cc8233b6459750eedfed4ee177d320832c97020ae721bff0c9d39cd`；`phase3-release-policy-utils.mjs` 149 / `4cee0326a280912d035690f317149fb302c708797677b351ebd2a680593ecd0c`；`check-phase3-artifact-size.mjs` 78 / `4076e108e2519825083b69b3df2505d47d25c537f9a20b549389689b1ea268ca`；`generate-phase3-sbom.mjs` 138 / `c87b1c776e0d5b4ec9dd14b47413241c927a745bbca8dc726eb64ce44459a0ae`；`generate-phase3-provenance.mjs` 77 / `0756edc26063f9704caa13a0b3a8184675511f1e8265384f35f814423aa2ea4c`；`rehearse-phase3-rollback.mjs` 117 / `7fda4e6c745049c5823370b7e5b1de4e17deb46a341cbd4591c7c417c7dc1a47`；`fixtures/release/rollback-state.json` 5 / `cde7872a1cea4036dc78b29fc44b55e163ba2e84ad9e9c6fcfab40dffa726229`；`fixtures/release/release-policy.json` 59 / `25920f26f8d0b3cdd251177b0e584a3b393190914f3018bcfd2cb089633c0df8`；`tests/architecture/phase3-release-gates.test.ts` 975 / `3108da4e22b0f923c83071fdb4694a76e9c2bb755032e33052af6d33052a9cf6`；`tests/architecture/phase3-artifact-build.test.ts` 977 / `88f8a8b7c48672a9d7587be9117553d2a94a4e1d51c78a4b34d9e4d07f792a2d`；`.github/workflows/ci.yml` 352 / `e480f76a6544a5d6961145c8faa7e39fcb7c6da5d3b621e66c92921c646cee6c`。全部低于1000行，新增/导出的独立函数均有中文前置注释。
- 本轮没有生成JWord run-a、run-b、`artifactSetId`或`finalVerificationSha256`，没有运行canonical build/pack、真实assembly audit或final pipeline；`LIC-107B2`继续为`Deferred/not-run`。Standards与Spec已对冻结 SHA `a70c6e3f2e90ec6a83c6531263cbc5b6c2e8e460cf2f5842bc9dfd087f3cbfca`分别回报`PASS / 0 finding`，因此B4检查点1状态更新为`Implementation Ready / final evidence pending`并在此hard stop；不得进入检查点2或B5。

#### P3-B4 检查点2 CI反例与Core scope修订（2026-07-23）

- 用户授权在clean SHA `a331b312396f24da5b61bdc793b01f135a907b7e`继续B4检查点2，并已由远端分支PR触发GitHub Actions run `29974521471`。`source-gates`通过，`artifact-build`在canonical run-a后的`direct-vitest`失败，依赖它的consumer、reproducibility、audit和final均未执行；本次不得把partial run-a或跳过的handoff记为B4证据。
- 在精确`node:20.19.0-bookworm`和同一run-a manifest下，`packages/core/test/editor/runtime.test.ts`中的`uses the layout schedule to avoid rerendering unchanged retained pages`单独为1 passed / 17 skipped，证伪原先对第五个用例的定位；紧邻的`先同步重绘当前脏页，再异步执行后续 deferred chunks`单独稳定在`editor.executeCommand()`内以`Intl.Segmenter`/`JSSegmentIterator::Next`堆OOM失败。4GB与6GB heap都会继续增长直至OOM，降低worker数不能修复。
- 最小纯Node 20对照使用相同51,000字符输入：当前`[...segmenter.segment(text)].map(...)`在256MB heap下约0.87秒OOM；单次`for...of`逐项复制相同字段约1.07秒完成51,000项，`heapUsed`约13.7MB。由此确认根因是`packages/core/src/shared/grapheme.ts`先物化全部原生`SegmentData`造成近似二次方存活内存，而不是builder、CI、License平台差异、Vitest worker数或测试fixture。
- 用户已明确批准把`packages/core/src/shared/grapheme.ts`作为唯一新增B4修改文件；不修改`runtime.test.ts`，不改变冻结direct Vitest命令，也不以缩小fixture或提高heap绕过。实施前先冻结本次计划修订并由独立Standards/Spec reviewer对同一SHA取得`PASS / 0 finding`；通过后复跑上述2GB Linux public seam红灯，只做流式投影最小实现并复跑同一seam转绿，再扩大到完整direct Vitest和B4 gates。
- 首轮Core scope修订冻结快照为1077行、SHA-256 `cc3ff0ea8bd2d16ace0c5c370c150e4d8926fdec4a92c02eae7d6e4cd0a31c26`，Standards与Spec均回报`PASS / 0 finding`。同一2GB Linux public seam随后在未修改源码时约15秒OOM；只把spread改为`for...of`流式投影后，同一命令为1 passed / 17 skipped、exit `0`，约4.19秒，证明原OOM已关闭。
- 扩大到完整`runtime.test.ts`后为16 passed / 2 failed：`mounted 查询 getLayout 不会同步吃完整个 deferred continuation`和`mounted 命中与 rect 查询只按需续排并保留 deferred continuation`分别同步阻塞约15.9秒与46.2秒并超过5秒timeout；两者单独运行仍分别约15.4秒与42.9秒，排除测试顺序或fake timer污染。CPU profile约12478个sample落在`segmentGraphemes`、1671个落在GC，其他布局函数只有几十个sample；临时带标签探针确认调用链重复对41,999、68,999/74,999和尾片段长文本分段，探针随后已全部撤销。
- 相同Node 20纯内存基准中，42,000字符完整投影约323ms，82,500字符完整投影约4.64秒，只计数仍约4.59秒，而提前寻找第2000个边界约103ms；因此只减少JS对象分配不能关闭超时。诊断原型把只含可打印ASCII、CJK Extension A和BMP CJK Unified Ideograph的文本按单UTF-16单元线性投影后，两个超时用例降为约466ms/423ms，完整runtime、复杂emoji/组合附加符position与layout focused合计3 files / 26 tests全绿。原型已撤回，未把未复审路径冒充实现证据。
- Node 20差分检查把上述三个安全区间的全部27,679个UTF-16单元拼接后，与`Intl.Segmenter`逐项结果完全一致；CRLF、`e + combining acute`、surrogate emoji、ZWJ family和CJK variation selector均不进入快路径并各由`Intl.Segmenter`保持单grapheme。第二轮修订只允许在同一`grapheme.ts`加入该精确等价快路径，不新增缓存、依赖、环境分支、API或测试文件，不修改`runtime.test.ts`。
- 第二轮Core scope修订冻结快照为1083行、SHA-256 `eebdd94aa952d69eb0e68a34435381aa8ac94ba4d9382990a3664f53447d5c0d`，Standards与Spec均回报`PASS / 0 finding`；实现据此在唯一批准文件`packages/core/src/shared/grapheme.ts`加入第6节冻结的严格安全快路径，并保留任一集合外单元整段回落`Intl.Segmenter`流式迭代。未修改既有test/fixture、公开API、依赖或环境分支；该文件最终为145行、bytes SHA-256 `ddc541eeaa7ebbd7bf3390dac91ac0a3de6f4a1095dc590d328a4b8767acc7bd`，无诊断探针或DEBUG残留。
- 精确Linux反馈环在`node:20.19.0-bookworm`、`pnpm 9.14.2`、2GB heap、单worker和同一真实run-a manifest下复跑：原OOM seam为1 passed / 17 skipped、约368ms；完整`runtime.test.ts`为18/18且两个新增反例均亚秒级；`position.test.ts`与`text-segments.test.ts`为2 files / 8 tests。补齐Git worktree元数据与Playwright Chromium/Firefox/WebKit缓存后，冻结direct Vitest命令最终为241 files / 1275 tests、exit `0`、103.03s；此前4个容器环境失败不记为源码回归。
- 本地扩大验证：B4 architecture focused为2 files / 20 tests、Core package为73 files / 371 tests，`pnpm typecheck`与完整`pnpm lint`均exit `0`；`git diff --check`、`git diff --cached --check`通过，tracked差异仅本文件与`packages/core/src/shared/grapheme.ts`，cached为空。受保护执行提示词保持15950 bytes、SHA-256 `7043b6854d27f104008bec162a70743e35402e7fd7eb6ef5c2876e8f1dbcf0e5`，`node-compile-cache/`保持未处理且不纳入提交。
- 实现/evidence回写冻结快照为1086行、SHA-256 `5f81ed8ce941626b8c5aacf8b828e7118a6b065943ba0096f2d1f0c909f3436f`，最终Standards与Spec均回报`PASS / 0 finding`。当前状态为`Implementation Ready / final evidence pending`；本地结果不生成或替换GitHub run的run-a、`artifactSetId`或`finalVerificationSha256`，`LIC-107B2`继续为`Deferred/not-run`。只有形成并推送新clean SHA且六个handoff与final verifier全部转绿后，B4才可关闭并进入B5。

#### P3-B4 检查点2 direct Vitest诊断范围修订（2026-07-23）

- clean head `0cd8128514bce2de6ff4d3b22dfac1c63848dd25`已推送到PR #1；`pull_request` workflow实际checkout的`github.sha`及source-report identity是merge SHA `2e94add9e796c019b50ce4dd0097e7762deae4cc`。该merge commit的tree与head完全相同，base `a8534dc0d265d99868761f1990ba3237978db97a`是分支祖先，因此不能把失败归因于merge ref注入额外文件；后续CI evidence必须继续记录真实`github.sha`，不能用head SHA冒充。
- GitHub Actions run `29980786861` attempt 1的`source-gates`通过，`artifact-build`在`Build unique run-a`内返回`direct-vitest command failed`；attempt 2对同一run执行failed-jobs rerun后再次在同一步失败，job总耗时3分26秒，consumer、reproducibility、audit和final仍全部跳过。两次partial run-a均不得上传或作为B4证据，B5继续禁止进入。
- repo外干净副本在merge SHA、`linux/x64`、Node `v20.19.0`、npm `10.8.2`、pnpm `9.14.2`、`CI=true`及attempt 1 source-report下精确通过environment/identity校验，并复现同一builder通用失败。直接探针返回`status: 1`、`signal: null`、`error: null`、stdout 60303 bytes、stderr 33962 bytes，显式32MiB buffer仍为真实测试非零，已证伪默认`spawnSync` buffer或`ENOBUFS`假设；Docker Corepack和缺浏览器造成的8个环境假失败在改用standalone pnpm 9.14.2与安装Chromium后，focused consumer seam为5/5通过。
- Apple Silicon上的`linux/amd64` QEMU全量只剩7个5至15秒timeout，其中子进程型单文件仍可超过5秒，不能作为GitHub原生x64源码失败证据，也不得据此提高timeout或修改这些测试。由于两次真实CI仍被builder吞掉stdout/stderr，当前没有正确的具体失败seam；按hard stop先把`build-phase3-artifacts.mjs`和既有`phase3-artifact-build.test.ts`的失败诊断CLI seam加入B4范围，冻结本修订并重做Standards/Spec双轴复审，未双绿前不改生产脚本。
- 上一轮direct Vitest诊断范围修订不改变当时的四条direct gate、artifact identity、builder composite hash规则、test report/binding schema、clean/fail-closed语义、`maxBuffer`、heap/timeout/worker或任何既有业务test fixture，也不授权修改下一次CI暴露的具体失败文件。实现只允许在既有post-command clean断言通过后转发失败子进程已捕获的两个文本流及安全退出元数据；取得真实失败后必须重新按public seam判断是否仍在批准范围内，超出范围继续先修订计划。
- 诊断范围首轮复审冻结稿为1096行、SHA-256 `c0e48154be6d1bb5557e3c6afc2f2597472c21a1ccac9feb2243e667ba24e23c`：Standards为`PASS / 0 finding`，Spec为`REQUEST CHANGES / 2 findings`，要求分别锁定stdout/stderr及nonzero与tracked污染同时发生时的clean优先级。收紧两个case后的同为1096行、SHA-256 `fd4f1407c6eabbb0993ed95149a029f4edbb038600416e309dff920e178c98fb`，Standards、Spec均为`PASS / 0 finding`，随后才修改production builder。
- 诊断红绿：首次新test运行因fixture shell `case`模式未引用而语法失败，不作为production红灯；修正fixture后，同一targeted命令稳定exit `1`，1 failed / 7 skipped，精确失败为父stdout缺少`direct-stdout-sentinel`。`runFixedCommand()`最小修改保持post-command clean在前，clean通过且command非零时才把捕获文本写回对应父流，并抛出只含command id、status、signal与spawn error code的摘要；同一targeted命令转为1 passed / 7 skipped。测试同时证明nonzero加tracked污染仍由clean错误优先且两个sentinel均不转发，失败路径不写test report/binding。
- 文件预算与扩大验证：test review阶段把两个case并入既有CLI lifecycle/dirty-checkpoint seam并提取重复canonical参数，最终`tests/architecture/phase3-artifact-build.test.ts`为985行、SHA-256 `4ba2ddde21e81fb5a441c1650c15f51688fee0960be40ab208d595dc5207754b`；`tools/release/build-phase3-artifacts.mjs`为676行、SHA-256 `fefb2c991b91676d1b18dedd578bfb23468689f17f3258dc7a871f3ccbe69a35`。恢复既有`e2e` checkpoint并新增`direct-vitest`后，完整artifact-build单文件为7/7，B4 focused为2 files / 20 tests，`pnpm typecheck`与完整`pnpm lint`均exit `0`；两类diff check通过。受保护执行提示词仍为SHA-256 `7043b6854d27f104008bec162a70743e35402e7fd7eb6ef5c2876e8f1dbcf0e5`，`node-compile-cache/`未处理。
- 最终实现复审首轮以计划SHA-256 `a3cc49ae2b10eff2ffb4c3f0d008ab861f71fe965d918d087e24954f01124d85`、测试SHA-256 `cb28a3e149ac1e7e8216e3ddc5364ce5d110b6778be6d6cbd712314ac64a765c`、builder SHA-256 `fefb2c991b91676d1b18dedd578bfb23468689f17f3258dc7a871f3ccbe69a35`冻结；Standards为`PASS / 0 finding`，Spec为`REQUEST CHANGES / 1 finding`，指出为加入direct-vitest污染case而替换了既有e2e clean checkpoint。修复已保留e2e并额外覆盖direct-vitest；当前测试哈希为`4ba2ddde21e81fb5a441c1650c15f51688fee0960be40ab208d595dc5207754b`，上述2 files / 20 tests、typecheck、lint和diff checks均在修复后复跑通过，等待当前最终exact SHA双轴复审。
- 当前状态为`Implementation Ready / final evidence pending`；本地结果不生成或替换GitHub run-a、`artifactSetId`或`finalVerificationSha256`，`LIC-107B2`继续为`Deferred/not-run`。当前实现快照的Standards与Spec均为`PASS / 0 finding`，可继续到形成并推送新clean SHA及运行远端final pipeline；下一次CI暴露具体direct Vitest失败后重新按public seam判断范围，六个handoff与final verifier全绿前禁止进入B5。

#### P3-B4 检查点2 worker争用范围修订（2026-07-23）

- clean commit `47122eb8f2ec9b4c1ac91cfe4d7c99f502bab7ef`已推送到PR #1，GitHub Actions run `29991174376` attempt 1的`source-gates`通过，`artifact-build`仍在固定direct Vitest返回非零；attempt 2对同一run的failed-jobs rerun再次失败。两次partial run-a均不得上传或作为B4证据，consumer、reproducibility、audit和final继续跳过。
- attempt 1为241 files / 1275 tests中3个5秒测试超时：`tests/architecture/gate7-public-api-docs.test.ts:126`、`packages/core/test/editor/mounted-render-hotpath.test.ts:21`和`packages/core/test/editor/mounted-text-mirror.test.ts:21`；attempt 2失败集合漂移为4个，新增`tests/architecture/gate6-package-exports.test.ts:291`，总计237 passed files / 1271 passed tests。漂移证明不是固定单一业务反例；builder已正确转发完整Vitest输出，安全摘要为`status: 1, signal: none, spawn error code: none`。
- repo外Linux Node `20.19.0`、2 CPU、同一47122eb tree和四文件最小反馈环在默认`maxWorkers: 4`下稳定使Gate 7类型程序测试超时（约6.76秒），两个mounted测试接近4.3-4.5秒；同一命令只改`--maxWorkers=2`后15/15通过，最慢3.63秒，总时长约9.08秒；`--maxWorkers=1`也通过但总时长约11.94秒。单文件和本机Node 20.19.3三文件合跑均快速通过，故根因收敛为受限Linux CPU下全量worker/子进程争用。
- 本次计划修订只新增`vitest.config.ts`到B4精确修改范围，把`test.maxWorkers`从4改为2；不改变冻结direct命令、测试timeout、heap、fixture、worker之外的参数、业务源码、artifact schema或失败语义。修订后必须对同一计划exact SHA完成独立Standards/Spec `PASS / 0 finding`，再以同一clean SHA复跑B4 focused、typecheck、lint和完整direct Vitest；若仍出现具体业务失败，按public seam重新判定，不能把worker配置当作豁免。
- 范围修订冻结快照为1112行、SHA-256 `b8f584589cbde10baf26cfb88ddbc2b4794c12f04984932d9d9ddd136c091b47`，Standards与Spec均回报`PASS / 0 finding`，正式允许实施`vitest.config.ts`的单行worker配置修改。
- 最小实现只把`vitest.config.ts`的`test.maxWorkers`从4改为2；文件仍为51行、SHA-256 `b8b8031f76efdac26d1ed88c1baf61144552893ef49fb7afed0482dd2c56fc33`，相对HEAD的zero-context diff只有这一行，没有修改timeout、fixture、heap、direct命令、业务源码或其他Vitest配置。
- 同一repo外Linux Node `20.19.0`、2 CPU四文件反馈环不带CLI worker覆盖转绿为4 files / 15 tests，最慢3.72秒，总时长9.29秒；验证后已还原临时仓库中的测试补丁，`47122eb8f2ec9b4c1ac91cfe4d7c99f502bab7ef`复现仓库重新clean。该临时仓库没有canonical build/dist且配置验证时会变dirty，因此其完整suite不满足Phase 3 direct gate前置，已停止且不计作证据。
- 本地扩大验证：B4 focused为2 files / 20 tests、50.14秒，`pnpm typecheck`与完整`pnpm lint`均exit `0`。首次冻结direct命令在宿主Node 24下仅`phase3-package-artifact-contract.test.ts`内容扫描case于15秒timeout失败，单文件立即3/3通过且目标case为9.27秒；未修改该测试或timeout，随后原样复跑完整direct命令为241 files / 1275 tests、106.23秒且exit `0`，没有固定业务反例。
- `git diff --check`与`git diff --cached --check`均exit `0`；tracked差异仅本文件与`vitest.config.ts`，cached为空。受保护执行提示词保持15950 bytes、SHA-256 `7043b6854d27f104008bec162a70743e35402e7fd7eb6ef5c2876e8f1dbcf0e5`，`node-compile-cache/`保持未处理且不纳入提交。
- implementation/evidence冻结快照为1117行、SHA-256 `088ca8ed9c8b9118febecaa6725c2b43450804497a39c9587f1d6de48a9b9836`；code-review Standards与Spec均回报`PASS / 0 finding`，确认worker-only scope、验证链、文件保护及B5 hard stop。
- 当前状态：`Implementation Ready / final evidence pending`；`artifactSetId`与`finalVerificationSha256`仍为`not-generated`，`LIC-107B2`仍为`Deferred/not-run`，只有新的clean SHA远端final pipeline通过后才可进入B5。

#### P3-B4 检查点2 License E2E hard stop（2026-07-23）

- worker配置修复后的clean commit `fdfd4c7e694a23b70227fd79ef5a90be7f2781f3`已推送到PR #1，GitHub Actions run `29997464492`的`source-gates`通过；`artifact-build`在`Build unique run-a`内完成固定direct Vitest后，于既有`pnpm test:e2e`返回非零。`artifact-consumers`、`artifact-reproducibility`、`artifact-audit`和`artifact-final`全部跳过，本次没有生成可用run-a、`artifactSetId`、`finalVerificationSha256`或任何可作为B4证据的下游handoff。
- 远端首个Collab public seam表现为`[data-jword-collab-status]`实际为`error`而非`synced`。本地复跑同一最小反馈环`pnpm exec playwright test examples/collab/tests/collab-auto-insert-concurrency.e2e.ts --project=chromium --grep='anchor 流式插入' --reporter=line`稳定为1 failed；页面debug snapshot记录`connected: false`、`lastEvent: error`与`JWORD_LICENSE_SIGNATURE_INVALID`。DOCX E2E在同一完整run中也以`JWordLicenseError: JWORD_LICENSE_SIGNATURE_INVALID: docx.import`失败。
- 根因不是端口冲突或Vitest worker争用：`examples/collab/src/main.ts`与`examples/docx/src/main.ts`仍把固定`INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN`装配给旧raw entitlement，而production入口按LIC-106契约拒绝JWL1 Ed25519 token。远端末尾的`status: null`、`signal: SIGTERM`和`spawn error code: ENOBUFS`发生在大量E2E失败输出之后，只是builder子进程缓冲区的二次症状，不得通过扩大buffer、timeout或临时排除失败用例绕过。
- 仓库已有固定production trust key，但唯一production golden token是2026-01-31到期且仅含`formats`的验签向量，不含`collaboration`；当前环境没有`JWORD_LICENSE_*`、Phase 3 token、外部私钥路径或key文件。生成新production token需要未提供且不得写入仓库的受批准生产私钥；LIC-110测试trust/token只允许License focused test隔离使用，不能注入当前browser E2E或替代production trust root。
- 该失败暴露计划内部边界冲突：第6节第13项与B3已把旧Gate 5/6业务smoke列为`legacy-non-gating`，其中JWL1/授权调用方失败应路由Phase 4，Collaboration deployment/admission或生产数据面失败应路由Phase 6；但B4固定blocking命令`pnpm test:e2e`仍包含旧JWL1 happy path。2026-07-23用户明确要求“每个Phase只做本Phase的事”，授权本轮只修订B4 gate分类；不提前迁移JWL1/DOCX/PDF/Collaboration调用方，也不修改计划表外的examples/E2E/License文件。
- focused审计还确认根`pnpm bench`按序包含Gate 5/6 benchmark；两者都装配同一旧JWL1 fixture。最小命令`node benchmarks/gate5-interop-benchmark.mjs`已稳定以`JWORD_LICENSE_SIGNATURE_INVALID: docx.export`退出1，证明若只修E2E，B4会在后续benchmark再次被同一跨阶段依赖阻断；Gate 6同样存在静态fixture引用，但因根runner先在Gate 5停止，本轮不重复运行耗时Gate 6。
- 修订后的唯一B4路径是：在既有批准文件`package.json`新增精确`test:e2e:phase3`与`bench:phase3` script；在既有`phase3-artifact-utils.mjs`的唯一`TEST_COMMANDS`常量把E2E/benchmark command改为对应Phase 3 script，使`testCommandDefinitions()`生成端与`validateTestReport()`校验端共同生效；在既有`phase3-artifact-build.test.ts`锁定四条command、script允许集合、根入口不变和后续阶段文件零修改。`build-phase3-artifacts.mjs`与`verify-phase3-final-evidence.mjs`继续消费共享定义，本轮不修改。DOCX/PDF/Collaboration旧JWL1 happy path及Gate 5/6 benchmark保留原失败语义并路由OEM Phase 4 `LIC-400`至`LIC-404`，不成为Phase 3关单条件；不得修改测试信任根、启用`allowInsecureFixtureLicense`或生成测试/临时/伪production token。
- 当时状态改为`In Progress / B4 gate revision review pending`：新计划exact SHA必须先取得Standards/Spec `PASS / 0 finding`，再实施上述`package.json`、`phase3-artifact-utils.mjs`和`phase3-artifact-build.test.ts`三个既有B4文件的最小差异并复跑focused、Phase 3 E2E与完整final pipeline。`artifactSetId`与`finalVerificationSha256`仍为`not-generated`，`LIC-107B2`继续为`Deferred/not-run`，B5继续hard stop。
- hard stop evidence首轮冻结快照为1127行、SHA-256 `f54936ecb01392040a0f0bef535579c569a3fb9b4ee4fd07eda8cc48b0629928`；Spec回报`PASS / 0 finding`，Standards回报`REQUEST CHANGES / 1 finding`，指出状态规则把`Implementation Ready / final evidence pending`错误限定为“尚未运行pipeline”。修正为最终pipeline尚未成功完成（未运行、失败或blocked）后，1127行、SHA-256 `d438d6320c5ed3cd55e9338d8da8653a87f0f5d811476d740d88cfdb826ef5f2`的同一证据快照取得Standards、Spec `PASS / 0 finding`；确认失败归属、secret边界、Phase 3 scope、B5 hard stop和状态语义无剩余finding。

#### P3-B4 gate修订实现与Vanilla E2E hard stop（2026-07-23）

- 最小实现只修改`package.json`、`tools/release/phase3-artifact-utils.mjs`和`tests/architecture/phase3-artifact-build.test.ts`：新增`test:e2e:phase3`与`bench:phase3`，共享`TEST_COMMANDS`切换至两个Phase 3专属入口，architecture seam锁定四条command、新旧script精确值并同步fake `pnpm`的E2E checkpoint。根`test:e2e`、根`bench`、builder、final verifier、JWL1、DOCX、PDF、Collaboration及后续Phase文件均未修改。
- 红绿证据：修改共享命令前，targeted architecture test以旧`pnpm test:e2e`精确红灯；最小实现后同一targeted seam为1 passed / 6 skipped，完整`phase3-artifact-build.test.ts`为1 file / 7 tests全绿。`pnpm typecheck`、`pnpm lint`、`pnpm bench:phase3`、`git diff --check`与`git diff --cached --check`均exit `0`；三段Phase 3 benchmark全部`status: ok`，其中Gate 2权威benchmark固定报告`pageCount: 53`。
- `pnpm test:e2e:phase3`只收集Vanilla：Chromium/Firefox/WebKit为24 files / 210 tests，首段实际结果为60 passed、86 failed、7 skipped、57 did not run并exit `1`，因此未进入后续`perf-chromium`；单独list确认`perf-chromium`只收集同目录4 files / 4 tests，没有重新引入DOCX或Collaboration。
- 两条最小反馈环稳定区分出至少两个既有Vanilla问题：`gate2.e2e.ts`的50页夹具硬编码期望67页，浏览器实际为53页，且Gate 2权威benchmark也以53页通过；`gate3-toolbar-panels.e2e.ts`期望默认文本镜像长度大于100，实际为0。当前三文件diff不在任一浏览器运行时路径内，本批不授权修改这些Gate 2/Gate 3测试、fixture、Core或UI实现，也不得通过排除用例降低Phase 3门禁。
- implementation/evidence code-review对`HEAD fdfd4c7e694a23b70227fd79ef5a90be7f2781f3`后的三文件diff给出Standards、Spec `PASS / 0 finding`。按用户决定，简单状态回写不重复双轴确认。当前状态为`Implementation Ready / final evidence pending`且本地Phase 3 E2E blocked；不得重跑远端final pipeline、生成或填写`artifactSetId`/`finalVerificationSha256`、进入B5或迁移JWL1调用方，直到另批关闭Vanilla红灯并重跑完整Phase 3 gate。

#### P3-B4 Vanilla Gate 2/Gate 3 scoped closure（2026-07-23）

- 本批事实源严格限定为`packages/*`当前生产实现：`packages/core`现有页面几何、字体度量和分页链路保持不变，Gate 2权威benchmark在当前实现上固定报告`pageCount: 53`；`packages/ui/src/ui-lifecycle.ts`仅在宿主显式传入`liveRegionHost`与`assistiveMirrorHost`时装配live region和文本镜像。由此判定`67`是测试侧陈旧页数基线，Gate 3失败是Vanilla测试fixture漏接公开host参数，不修改生产包迎合旧测试。
- 最小修改只涉及六个测试消费文件：`examples/vanilla/tests/fixtures/test-fixture.ts`恢复`liveRegionHost: statusHost`与`assistiveMirrorHost`公开参数装配；`gate2.e2e.ts`、`gate2.perf.e2e.ts`、`gate3-input-helpers.ts`、`gate3.perf.e2e.ts`和`phase4-memory.perf.e2e.ts`把既有`expectedGate2PageCount`从`67`同步为`53`。未修改Core、UI、JWL1、DOCX、PDF、Collaboration、B5或远端pipeline定义，也未排除测试。
- focused反馈环已关闭原两项红灯：Gate 3初始assistive text mirror为1/1通过，Gate 2 focused为2/2通过；完整`phase3-artifact-build.test.ts`为7/7通过，`pnpm bench:phase3`三段均为`status: ok`且Gate 2报告53页，`pnpm typecheck`、`pnpm lint`、`git diff --check`与`git diff --cached --check`均exit `0`。
- 修复后完整`pnpm test:e2e:phase3`结果为99 passed、65 failed、7 skipped、39 did not run并exit `1`；Gate 2与Gate 3 toolbar用例在Chromium、Firefox、WebKit三浏览器矩阵中均已通过。首段仍失败，因此`perf-chromium`未运行；其余失败主要来自仍假定fixture启用page preset plugin、heading outline、revisions、初始可见table toolbar等旧前提的Vanilla用例，以及旧指针坐标断言。上述65项不得由本批顺手修改，必须另开范围并继续以`packages/*`真实代码判断测试是否陈旧。
- 对固定点`fdfd4c7e694a23b70227fd79ef5a90be7f2781f3`后的本批六文件diff，只读implementation/evidence review给出Standards、Spec `PASS / 0 finding`。按用户决定，简单状态回写不重复双轴确认；本批到此停止，仍不得重跑远端final pipeline、生成或填写`artifactSetId`/`finalVerificationSha256`、进入B5或迁移JWL1调用方。

#### P3-B4 Vanilla完整closure（2026-07-24）

- 本批继续以`packages/*`当前生产实现为唯一事实源。Vanilla fixture按公开`createJWordUi` seam显式装配`liveRegionHost`、`assistiveMirrorHost`、`headingOutline`与`revisions`；测试统一切换真实专业工具栏tab、内建`document.pagePreset`、当前readonly路由/selector、已挂载但按tab显隐的panel以及当前host几何，不恢复已被生产实现替换的旧plugin菜单、旧默认可见状态或旧DOM前提。
- Gate 2的53页基线来自当前`packages/core`分页结果与权威benchmark，现集中到`gate2-test-contract.ts`供五个同夹具浏览器回归共同消费；Gate 3 pointer probe在计算client point前先把目标页滚入editor viewport，keyboard whitespace用例改用足以验证同一公开输入行为的Alpha小样例，避免把WebKit大夹具约27秒耗时当成功能语义。
- 两个真实public seam暴露生产缺陷并做最小修复：`packages/ui/src/selection-actions/controller.ts`冻结浮动选区工具栏位置时与正常渲染统一使用`overlayHost`，关闭94px跳动；`packages/ui/src/link/controller.ts`把链接anchor overlay视为内部交互，避免`pointerdown`关闭后同一`click`重新打开。两项均由既有Vanilla真实浏览器用例覆盖，没有新增私有测试入口。
- 首轮最终review指出`playwright.config.ts`项目级`workers: 1`会影响根`pnpm test:e2e`及后续Phase，并指出53页值分散。修复后Playwright配置恢复为HEAD原值；结合后续远端worker争用证据，只有`test:e2e:phase3`的WebKit与`perf-chromium`子命令使用`--workers=1`。architecture seam同时锁定Phase 3三段式脚本精确值、根脚本不变和配置内无项目级worker覆盖，共享页数契约消除五处同步修改。
- 当前完整验证：`pnpm test:e2e:phase3`功能矩阵203 passed / 7 skipped / 0 failed，随后`perf-chromium`单worker矩阵4 passed / 0 failed；Gate 3 `largeDocumentInsertP95Ms`为35.2ms，原50ms阈值未放宽。`pnpm --filter @4xian/jword-ui test`为42 files / 184 tests通过，`phase3-artifact-build.test.ts`为7/7通过，`pnpm typecheck`、`pnpm lint`、`pnpm bench:phase3`和两类diff check均exit `0`，三段benchmark均为`status: ok`。
- 当前tracked差异没有`playwright.config.ts`、JWL1、DOCX、PDF、Collaboration、License trust/token或B5文件；`artifactSetId`与`finalVerificationSha256`仍为`not-generated`。本地closure不能替代新clean SHA的远端six-handoff final pipeline，未经用户授权不得commit、push、创建PR或进入B5。

#### P3-B4 remote WebKit worker争用修复（2026-07-24）

- clean SHA `b40855d6f7912b3d0d820c9422866ae806be533b`已推送到PR #1并触发run `30064167651`。`source-gates`在job `89391720878`通过；`artifact-build` job `89391884277`的环境校验通过，随后`pnpm test:e2e:phase3`在`Running 210 tests using 2 workers`下得到197 passed / 7 skipped / 6 failed，六项均为WebKit 30秒超时，下游consumer、reproducibility、audit与final按依赖跳过。失败没有涉及JWL1、artifact schema、direct Vitest或生产包断言。
- 六个失败用例分别位于Gate 2两项50页分页回归、Gate 3 clipboard、keyboard两项和selection。Linux日志显示重试仍卡在`locator.evaluate`、`page.evaluate`或“加载 Alpha 样例”按钮稳定性；本机同一六项2 workers为6/6通过，说明测试逻辑并非跨环境稳定错误。改为单worker后同一六项6/6通过，完整WebKit段中对应重型用例单项耗时约13.3至17.6秒，与2-worker下跨过30秒总timeout的资源争用机制一致。
- 最小红灯先只修改`phase3-artifact-build.test.ts`的公开CLI contract，要求Phase 3把Chromium/Firefox与WebKit拆成两个子命令并仅对WebKit使用`--workers=1`；targeted test精确以旧script红。最小实现只同步`package.json`的`test:e2e:phase3`，根`test:e2e`、`playwright.config.ts`、测试timeout、retries和生产代码均不修改；同一targeted architecture seam转为1 passed / 6 skipped，完整architecture为7/7通过。
- 修复后完整`pnpm test:e2e:phase3`为Chromium/Firefox 136 passed / 4 skipped、WebKit单worker 67 passed / 3 skipped、`perf-chromium`单worker 4 passed；Gate 3 `largeDocumentInsertP95Ms`为34.5ms，原50ms阈值未放宽。该本地证据只解除本轮remediation的提交前门禁；必须形成并推送新的clean SHA、重跑同一six-handoff pipeline并取得有效final record/sidecar后，才可进入B5。

#### P3-B4 remote UI测试生命周期修复（2026-07-24）

- clean SHA `485ae9edd7f49c8c09233e15e5fd2ad2eaadbae7`触发run `30066059710`。`source-gates` job `89397163860`通过；`artifact-build` job `89397323991`完成环境校验，direct Vitest的241个文件与1275项测试断言全部通过，但最终报告1个异步错误：`create-ui-heading-outline.test.ts`结束后，遗留的状态栏完整性定时器在jsdom teardown期间调用已不可用的`getComputedStyle`。下游consumer、reproducibility、audit与final按依赖跳过，没有生成可用于B4 closure的handoff或最终ID。
- 真实`packages/ui`实现已经在`ui.destroy()`路径清理该定时器；失败测试的`createHarness()`同时创建editor与UI，却只销毁editor和DOM。最小回归通过公开harness销毁路径等待550ms，修复前稳定报告销毁后仍有3次`getComputedStyle`调用；最小实现只在同一测试文件的harness中补齐`ui.destroy()`，不修改生产controller、浏览器兼容矩阵、JWL1、DOCX、PDF、Collaboration或B5文件。
- 同一目标文件由1 failed / 7 passed转为8/8通过，`pnpm --filter @4xian/jword-ui test`为42 files / 184 tests通过；`pnpm typecheck`、`pnpm lint`、`git diff --check`与`git diff --cached --check`均exit `0`。子代理接口不可用后由主进程按同一Standards/Spec清单完成只读fallback review，两节均为`PASS / 0 finding`；按用户决定，简单状态回写不重复双轴确认。该证据只关闭本次测试生命周期泄漏，仍须形成并推送新clean SHA后重跑完整six-handoff pipeline。

#### P3-B4 remote WebKit单测预算修复（2026-07-24）

- UI生命周期修复的clean SHA `b9b13110a6b5a7829135d583acb2f05c3e668e24`触发run `30066733479`。`source-gates` job `89399064762`通过；`artifact-build` job `89399232993`越过direct Vitest，Chromium/Firefox功能矩阵为136 passed / 4 skipped。WebKit已按上一轮契约使用1 worker，仍以61 passed / 3 skipped / 6 failed结束，六项全部是默认`30000ms` timeout；下游consumer、reproducibility、audit与final均跳过，没有有效run-a handoff、`artifactSetId`或`finalVerificationSha256`。
- 远端事实证伪“仅将WebKit改为单worker即可关闭争用”的旧判断。六项仍是Gate 2两项50页分页、Gate 3 clipboard、keyboard两项和selection，日志没有新的产品断言差异；因此本批不修改`packages/*`当前生产实现、浏览器测试、fixture或Playwright全局配置，只把Phase 3专属WebKit子命令的单测预算固定为60秒。Chromium/Firefox继续使用默认worker/timeout，`perf-chromium`继续只使用单worker，根`test:e2e`及后续Phase不受影响。
- 红绿反馈环先把architecture公开CLI contract改为要求`--workers=1 --timeout=60000`，在script仍为旧值时稳定为1 failed / 6 skipped；只同步`package.json`后，同一focused seam为1 passed / 6 skipped。本轮续接复跑完整`phase3-artifact-build.test.ts`为7/7，本地完整WebKit命令为67 passed / 3 skipped并exit `0`，原六项全部通过；`pnpm typecheck`、`pnpm lint`、`git diff --check`与`git diff --cached --check`均exit `0`。
- 单reviewer编排接口返回`unsupported call: spawn_agent`后，主进程按同一code-review Standards/Spec清单完成只读fallback；Standards与Spec均为`PASS / 0 finding`。审查确认差异只包含约定三文件，architecture文件仍为998行，精确命令重复属于计划要求的可执行contract而非新增抽象或越界实现；按用户决定，本条简单状态回写不重复双轴确认。
- 以上仅完成新契约的本地实现门禁。仍须把约定三文件形成并推送新clean SHA，再由远端同一six-handoff pipeline验证Linux WebKit 60秒预算；远端全绿并下载六份handoff、执行final verifier且核验两个最终ID前，B5与JWL1迁移继续hard stop。

### 13.2 B5文档链

- 前七个文件各加入一次第8节冻结的`PHASE3_LEDGER_REF` marker和可读链接，不复制ledger块、artifactSetId或finalVerificationSha256；本文件是这些值的唯一真源。
- `docs/current-implementation/reviews/current-full-review/README.md`：加入15号和Phase 3最终evidence入口。
- `docs/current-implementation/reviews/current-full-review/01-current-conclusion.md`：从“artifact未完成”改为精确的内部artifact状态；GA仍不可宣称。
- `docs/current-implementation/reviews/current-full-review/07-oem-and-system-mapping.md`：统一Phase 3完成，不改变OEM Phase 3=Phase 6A。
- `docs/current-implementation/reviews/current-full-review/08-issues-register.md`：登记Phase 3状态与manual/Deferred blocker；`SEC-06`不误关。
- `docs/current-implementation/reviews/current-full-review/09-remediation-roadmap.md`：记录Phase 3 exit并删除Phase 5过期`CORE-05`项；不改Phase 4顺序。
- `docs/current-implementation/reviews/current-full-review/10-verification-plan.md`：追加真实clean SHA、lock hash、commands/results、manual not-run和authoritative ledger链接，不复制两个最终ID。
- `docs/current-implementation/release-metadata-audit.md`：旧2026-07-07 snapshot改为最新canonical artifact证据入口；真实publish清单保留，不复制两个最终ID。
- 本文件：B0-B5最终ledger、review、artifactSetId、finalVerificationSha256和状态。

### 13.3 状态更新规则

- `In Progress`：任一批开始修改但未满足该批全部gate/review。
- `Implementation Ready / final evidence pending`：B0-B4实现及focused fixture红绿、scope和双轴review通过，但最终同SHA/run-a pipeline尚未成功完成（未运行、失败或blocked）；不得写`Closed`。B4代码完成与B4最终pipeline执行是同一批的两个检查点。
- `Closed`：B4最终pipeline及final verifier通过、record/sidecar保存后，B0-B4可一起关闭；B5在本文件authoritative ledger绑定finalVerificationSha256、其余七份文档引用该ledger、完成文档关单、scope/whitespace和最终双轴review后单独关闭。
- `Completed for internal progression`：B0-B5全部Closed、canonical artifact基线完成；不等于外部发布。
- `Deferred`：明确外部/人工事项并有进入条件；`LIC-107B2`、legal、真实registry access/2FA、signed provenance、正式changeset/version/dist-tag操作保持此状态，但各自Phase 3 policy/rehearsal必须Closed。
- `Verified`：Phase 3不得使用；只有对应外部/人工证据全部完成后才可能使用。

文档链若缺少实际命令/exit/clean SHA/review结果、本文件authoritative ledger中的artifactSetId/finalVerificationSha256，或其余七份文档任一固定引用，就不能把B0-B5标Closed（`docs/current-implementation/reviews/current-full-review/01-current-conclusion.md:46-56`）。

## 14. 本轮计划编制完成标准

- [x] 已只读调查并记录branch、HEAD、dirty边界、数量和fingerprint。
- [x] 已枚举并分类12个runtime package及非发布workspace。
- [x] 已调查Gate 5/6/7、License、Node/Vite/browser、wrapper、CSS、Worker和examples边界。
- [x] 已冻结artifact reproducibility、inventory/hash、consumer和CI/release决策。
- [x] 已给出B0-B5精确文件、红绿、扩大验证、复审、完成/进入条件。
- [x] 已分离自动、外部自动和manual gate。
- [x] 已保留真实publish、法律、最低browser和后续Phase边界。
- [x] 原始计划稿 Standards reviewer：最终稿为`PASS / 0 finding`；2026-07-22 closure机制修订后必须由新reviewer在外部结论中回报当前实际SHA-256，复审后不得再修改本文件。
- [x] 原始计划稿 Spec reviewer：最终稿为`PASS / 0 finding`；2026-07-22 closure机制修订后必须由新reviewer对同一当前SHA回报`PASS / 0 finding`，才能恢复B0实现。
- [x] 原始计划编制轮的`git diff --check`、`git diff --cached --check`和新增文档whitespace检查通过（`git diff --no-index --check` exit 1且无diagnostic，仅表示新增内容）；当时scope限定为只写本文件。第2.2节的未归因index迁移不记为本任务成果；当前实施授权及保护边界已由第2.3节和本ledger另行冻结。
- [x] 已把2026-07-23旧JWL1失败收敛为B4跨阶段gate编排问题，并按用户决定冻结Phase 3专属E2E/benchmark命令、后续Phase归属和禁止绕过项。
- [x] 本轮B4 gate修订首轮1134行、SHA-256 `abb7b02f2062e2c746c75c270d81dfa6d5777d0b6070dc5a960c1da4c17ddb93`由Standards、Spec各回报1项修改要求，分别指出两处旧全仓gate表述与共享`TEST_COMMANDS`修改面遗漏；修正后的1134行、SHA-256 `12b0c2eb53fb94d398eb36d1c99d131574dfd4948549833b9cfc87a5e3881216`取得Standards、Spec `PASS / 0 finding`。用户随后明确简单修改无需重复双轴确认；三文件最小实现已完成并通过一次独立implementation/evidence code-review，当时完整Phase 3 E2E仍blocked，后续Vanilla closure证据见第13.1节2026-07-24 ledger。
- [x] 2026-07-24 Vanilla完整closure已关闭原65项红灯，并将review指出的全局perf worker影响收紧到Phase 3专属命令；当前最终本地gate均通过，等待最终完整差异复审与新clean SHA远端pipeline。
- [x] 2026-07-24 run `30066733479`证实WebKit单worker仍被六项默认30秒预算阻断；当前只在Phase 3专属WebKit子命令冻结60秒预算，本地architecture 7/7、WebKit 67 passed / 3 skipped及静态门禁均通过，等待新clean SHA远端six-handoff验证。

原始计划编制轮在双轴复审和whitespace/scope检查通过后停止；当前B4 gate修订、Vanilla完整本地closure及WebKit 60秒专属预算已按`packages/*`真实实现完成本地验证与差异复审。下一执行边界是形成并推送新clean SHA、重跑远端final pipeline；不得借此进入JWL1迁移或B5。
