# JWord Gate 4.5/5/6 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the nine code review findings that currently prevent Gate 4.5, Gate 5, and Gate 6 from being called genuinely complete.

**Architecture:** Keep fixes scoped to the package that owns each boundary. Gate 4.5 stays free and independent. Gate 5 format features fail before reading document content unless a verifiable entitlement is present. Gate 6 public client SDK must use the same public provider/server contracts that third-party consumers would use.

**Tech Stack:** TypeScript ESM, Vitest, Playwright where browser evidence is required, JSZip, pdf-lib, Node HTTP server tests, pnpm workspace.

---

## Work Split

The nine findings are grouped into six non-overlapping implementation lanes so subagents can run in parallel:

1. Native lane: persistent blob/file image resources and real running-task cancellation.
2. Gate 5 license/DOCX lane: signed entitlement verification plus DOCX inspect/index authorization.
3. PDF lane: render table cell text into exported PDF and cover it with stream/visual assertions.
4. Collab client lane: local update publishing, server-backed history, and offline queue state on public SDK.
5. Collab server lane: deny by default and authorize before accepting document payloads/chunks.
6. Release lane: dist ESM/pack self-checks, sourcemap/source leak prevention, and Gate 5 external tarball smoke.

## Task 1: Native Resource Persistence And Running Cancel

**Files:**
- Modify: `packages/native/src/index.ts`
- Modify: `packages/native/src/worker.ts`
- Modify: `packages/native/src/messages.ts` if transferable behavior needs to return the actual result buffer.
- Modify: `packages/native/test/public-api.test.ts`
- Modify: `packages/native/test/worker.test.ts`
- Modify: `examples/vanilla/src/demo-media.ts`
- Modify: `examples/vanilla/tests/gate4_5-native.e2e.ts`
- Modify: `fixtures/native/registry.json` only if fixture metadata needs path/state fields.

- [x] Add a failing public API test where a document resource has `source.kind === 'blobUrl'` and a `metadata.nativeBytesBase64` fallback. Save must write `resources/<id>`, load must return a stable packed resource summary, and validation must pass.
- [x] Update `examples/vanilla/src/demo-media.ts` so file uploads convert the file bytes to a `dataUrl` source or store packable bytes in resource metadata before creating the demo resource. Do not leave uploaded files as non-persistent `blobUrl` in the canonical resource snapshot.
- [x] Update native resource packing so it can pack `dataUrl` resources and the explicit metadata fallback for current blob/file uploads. Keep external URLs as warning-only and do not fetch them.
- [x] Add a running cancellation test with a large resource and an `AbortSignal` that aborts during zip/checksum/generation progress.
- [x] Add abort checks around checksum creation and after `zip.generateAsync`. Use JSZip `onUpdate` only if needed; otherwise fail promptly after the long operation and ensure worker reports cancelled instead of success.
- [x] Run `pnpm --filter @4xian/jword-native test`, `pnpm --filter @4xian/jword-native typecheck`, and `pnpm exec playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium --reporter=line`.

执行记录（2026-05-28）：Gate 4.5 native lane 已补资源持久化与运行中取消；`examples/vanilla` 文件上传转为持久化 `dataUrl`，native 打包支持 `dataUrl` 与 `metadata.nativeBytesBase64`，保存流程在 checksum/zip generation 前后检查 abort。主进程复验：`pnpm --filter @4xian/jword-native test` 为 2 files / 13 tests passed；`pnpm --filter @4xian/jword-native typecheck` 通过；`pnpm exec playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium --reporter=line` 为 2 passed。

## Task 2: Signed License And DOCX Inspect Authorization

**Files:**
- Modify: `packages/license/src/index.ts`
- Modify: `packages/docx/src/package.ts`
- Modify: `packages/docx/src/worker.ts`
- Modify: `packages/docx/src/compatibility.ts` if compatibility report needs to pass through license.
- Modify: `packages/docx/test/public-api-license.test.ts`
- Modify: `packages/docx/test/public-api-package.test.ts`
- Modify: `packages/docx/test/worker.test.ts`
- Modify: `packages/license/test/*` if present; otherwise add `packages/license/test/public-api.test.ts`.

- [x] Extend `JWordLicenseEntitlement` with a minimal verifiable signature contract such as `issuer`, `issuedAt`, and `signature`.
- [x] Implement deterministic local signature verification without network access. Use Node/Web Crypto HMAC or a simple canonical payload hash only if it is explicit and tested. Invalid or missing signatures must produce a stable diagnostic such as `JWORD_LICENSE_SIGNATURE_INVALID`.
- [x] Keep existing test helpers working by updating test entitlement factories to create signed entitlements.
- [x] Add tests that unsigned, tampered, expired, feature-mismatched, and server-unavailable entitlements fail without document content in the error.
- [x] Require `docx.import` authorization before `inspectDocxPackage()` and `createDocxIndexes()` read ZIP bytes.
- [x] Require `docx.import` authorization in the worker `inspect` branch before calling `inspectDocxPackage()`.
- [x] Run `pnpm --filter @4xian/jword-license test` if the package has a test script; otherwise run `pnpm exec vitest run packages/license/test packages/docx/test/public-api-license.test.ts packages/docx/test/public-api-package.test.ts packages/docx/test/worker.test.ts --reporter=dot`.

执行记录（2026-05-28）：Gate 5 license/DOCX lane 已补签名授权契约、缺失/篡改签名诊断、DOCX inspect/index/worker inspect 前置授权。主进程复验：`pnpm --filter @4xian/jword-license test` 为 1 file / 6 tests passed；`pnpm --filter @4xian/jword-docx test` 为 13 files / 62 tests passed；`pnpm --filter @4xian/jword-docx typecheck` 通过。

## Task 3: PDF Table Cell Text Rendering

**Files:**
- Modify: `packages/pdf/src/index.ts`
- Modify: `packages/pdf/test/public-api.test.ts`
- Modify: `packages/pdf/test/visual-report.test.ts` if visual report needs stronger table text evidence.
- Modify: `fixtures/pdf/registry.json` only if status can be made truthful with real table/image fixture evidence.

- [x] Add a failing PDF public API test asserting table cell text appears in inflated PDF streams for `createTableImageLayout()`.
- [x] Render each `table.rows[].cells[].fragments[]` through the same `renderPdfTextFragment()` path as page lines, after table borders and before header/footer.
- [x] Keep table borders and image rendering unchanged.
- [x] Strengthen visual report expectations so `pdf-table-image` cannot claim `table-cell-text` if text is missing.
- [x] Run `pnpm --filter @4xian/jword-pdf test` and `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --reporter=dot`.

执行记录（2026-05-28）：PDF lane 已在 table border 后、正文 lines 前渲染单元格 text fragments，并用 public API inflated stream 与 visual report text boxes 覆盖。主进程复验：`pnpm --filter @4xian/jword-pdf test` 为 4 files / 31 tests passed；`pnpm --filter @4xian/jword-pdf typecheck` 通过；Gate 5 fixture/commercial/Gate 6 focused architecture suite 中 `tests/architecture/gate5-fixture-registry.test.ts` 一并通过。

## Task 4: Public Collab Client SDK Data Path

**Files:**
- Modify: `packages/collab/src/client-types.ts`
- Modify: `packages/collab/src/client-sdk.ts`
- Modify: `packages/collab/src/index.ts` only if provider adapter type needs a small public extension.
- Modify: `packages/collab/test/public-client.test.ts`
- Modify: `tools/release/check-gate6-third-party-smoke.mjs`

- [x] Extend `JWordCollaborationEditor` with optional `subscribe(listener)` compatible with core `Editor.subscribe`. Do not require DOM APIs.
- [x] In `connectJWordCollaboration()`, subscribe to local editor `transaction` events after successful handshake/connect. For local/user transactions only, encode a sync update and call `provider.sendUpdate()` with `clientId`, `documentId`, `roomId`, `updateId`, and `origin: 'local'`.
- [x] Avoid echo loops: remote-user, version-restore, and auto-inserter updates must not be re-sent as local user updates unless the plan explicitly says otherwise.
- [x] Replace connection-local history storage with server-backed HTTP calls when `serverUrl` is available. Use `/history/versions` list/record and `/history/versions/:id/preview` style already implemented by `@4xian/jword-collab-server`; if the exact endpoint differs, follow current server handler.
- [x] Keep an in-memory fallback only if server history returns a diagnostic, and expose that diagnostic.
- [x] Add offline state that tracks pending local provider sends or history records while provider status is `offline`/`reconnecting`. `queuedOperations` must not be hard-coded to `0`.
- [x] Update `tools/release/check-gate6-third-party-smoke.mjs` so the empty-project smoke verifies local update publishing and server-backed history, not just in-memory `recordVersion()`.
- [x] Run `pnpm --filter @4xian/jword-collab test`, `node tools/release/check-gate6-third-party-smoke.mjs`, and focused Gate 6 architecture tests.

执行记录（2026-05-28）：collab client lane 已补 public SDK 的本地事务发布、远端/restore/auto-inserter 防回声、server-backed history、pending queue offline state 和第三方 smoke 覆盖。主进程复验：`pnpm --filter @4xian/jword-collab test` 为 2 files / 19 tests passed；`pnpm --filter @4xian/jword-collab typecheck` 通过；`node tools/release/check-gate6-third-party-smoke.mjs` 输出 `status: ok`、`localUpdate: "published"`、`history: "server-backed"`、`unauthorized: "COLLAB_LICENSE_MISSING"`。

## Task 5: Collab Server Authorization Before Payload

**Files:**
- Modify: `packages/collab-server/src/index.ts`
- Modify: `packages/collab-server/src/auto-insert-relay.ts`
- Modify: `packages/collab-server/src/hocuspocus-server.ts`
- Modify: `packages/collab-server/test/server.test.ts`
- Modify: `examples/collab/server/dev-server.ts` only if local demo needs explicit development hooks.

- [x] Change server-side license behavior so missing `licenseHook` denies paid Gate 6 endpoints by default. Local demos/tests that intentionally allow access must pass an explicit allow hook.
- [x] For history record and preview endpoints, read only URL/header/query metadata needed for auth/tenant/license before reading JSON payload containing `updateBase64`.
- [x] If JSON body is currently the only place containing `documentId` or entitlement, add a metadata-first route contract through headers or query parameters, and keep old body-only behavior rejected with a diagnostic instead of reading document payload.
- [x] For auto-insert relay, authorize from headers/query metadata before reading `chunkText`.
- [x] Add tests proving denied requests do not read request body. Use a custom `Readable` request or a body stream that fails if consumed.
- [x] Update Hocuspocus server default license behavior to deny unless an explicit hook allows it.
- [x] Run `pnpm --filter @4xian/jword-collab-server test` and `pnpm exec vitest run tests/architecture/gate6-commercial-readiness.test.ts --reporter=dot`.

执行记录（2026-05-28）：collab server lane 已改为缺 `licenseHook` 默认拒绝，history record/preview 与 auto-insert relay 均从 query/header 读取 metadata 完成 tenant/license 判断后才读取 body；Hocuspocus sync 缺 hook 或授权拒绝时不进入正常同步。主进程复验：`pnpm --filter @4xian/jword-collab-server test` 为 1 file / 16 tests passed；`pnpm --filter @4xian/jword-collab-server typecheck` 通过；focused architecture suite 中 `tests/architecture/gate6-commercial-readiness.test.ts` 一并通过。

## Task 6: Release Pack And External Install Hardening

**Files:**
- Modify: `rollup.config.mjs`
- Modify: `tsconfig.base.json` or package tsconfigs only if needed to stop sourcemap/declaration map emission.
- Modify: `tools/release/check-gate5-commercial-pack.mjs`
- Modify: `tools/release/check-gate6-commercial-pack.mjs`
- Modify: `tools/release/check-gate6-third-party-smoke.mjs`
- Create: `tools/release/check-gate5-third-party-smoke.mjs`
- Modify: `tests/architecture/gate5-commercial-readiness.test.ts`
- Modify: `tests/architecture/gate6-package-exports.test.ts`

- [x] Disable JS and declaration sourcemaps for commercial release output, or ensure pack scripts reject every `.map` and every file containing `sourcesContent`.
- [x] Add pack checks that fail on `.map`, `sourcesContent`, `src/`, `test/`, `tests/`, `fixtures/`, and private helper source paths inside tarballs.
- [x] Add a dist import smoke that imports the actual packed `dist/index.js` and subpath exports from a temp Node ESM project.
- [x] Fix any extensionless relative imports in dist by changing the build pipeline or package build scripts. The verification must inspect packed dist, not source files only.
- [x] Add `tools/release/check-gate5-third-party-smoke.mjs` that packs/install-smokes `@4xian/jword-docx`, `@4xian/jword-pdf`, and `@4xian/jword-license` from an empty temp project and imports public APIs without monorepo aliases.
- [x] Run `pnpm build`, `node tools/release/check-gate5-commercial-pack.mjs`, `node tools/release/check-gate5-third-party-smoke.mjs`, `node tools/release/check-gate6-commercial-pack.mjs`, and `node tools/release/check-gate6-third-party-smoke.mjs`.

执行记录（2026-05-28）：release lane 已补商业包 pack 内容、source map/source content 泄漏、dist 相对 import 后缀、Gate 5/Gate 6 空项目 tarball 安装 smoke。主进程复验：`pnpm build` 通过；`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/release/check-gate5-third-party-smoke.mjs`、`node tools/release/check-gate6-commercial-pack.mjs`、`node tools/release/check-gate6-third-party-smoke.mjs` 均输出 `status: ok`。

## Final Verification And Plan Reconciliation

- [x] Run focused suites from all six tasks.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [x] Run the Gate 4.5 browser E2E and at least one real browser/Kimi smoke for native resource roundtrip if available.
- [x] Re-open `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` and update only the execution notes that were contradicted by this remediation.
- [x] Before claiming completion, re-audit the original nine findings one by one and record the proving file/command evidence.

主进程九项复核记录（2026-05-28）：

1. Gate 4.5 uploaded file image resources were not persistable: fixed by converting vanilla file uploads to `dataUrl` and supporting packable native resource bytes; proof: `packages/native/test/public-api.test.ts` and `examples/vanilla/tests/gate4_5-native.e2e.ts`.
2. Gate 4.5 save cancellation could still return stale success after long work: fixed with abort checks around resource/checksum/zip generation and worker cancellation tests; proof: `packages/native/test/worker.test.ts`.
3. Gate 5 licenses were bearer-shaped and unsigned: fixed by `JWordLicenseEntitlement` issuer/issuedAt/signature and `JWORD_LICENSE_SIGNATURE_INVALID`; proof: `packages/license/test/entitlement.test.ts`.
4. DOCX inspect/index paths could read ZIP bytes before import entitlement: fixed by `inspectDocxPackage()` / `createDocxIndexes()` / worker inspect preflight `docx.import`; proof: `packages/docx/test/public-api-license.test.ts` and `packages/docx/test/worker.test.ts`.
5. PDF table/image fixture claimed table text support without exporting cell text: fixed by rendering table cell fragments through `renderPdfTextFragment()` and checking stream/text boxes; proof: `packages/pdf/test/public-api.test.ts` and `packages/pdf/test/visual-report.test.ts`.
6. Public collab SDK did not publish local editor transactions through provider: fixed by optional `editor.subscribe()` and local/user origin `provider.sendUpdate()`; proof: `packages/collab/test/public-client.test.ts` and Gate 6 third-party smoke `localUpdate: "published"`.
7. Gate 6 history/offline were connection-local rather than server-backed/pending-aware: fixed by HTTP history calls with fallback diagnostics and pending operation tracker; proof: `packages/collab/test/public-client.test.ts` and Gate 6 third-party smoke `history: "server-backed"`.
8. Collab server paid endpoints accepted body/chunks before server-side license decisions: fixed by metadata-first history/auto-insert routes, default-deny missing hook, body-consumption trap tests and Hocuspocus default-deny; proof: `packages/collab-server/test/server.test.ts`.
9. Commercial package release surface still allowed dist/runtime/sourcemap/external-install regressions: fixed by pack checks, dist import normalization and Gate 5/Gate 6 empty-project smoke; proof: `tools/release/check-gate5-commercial-pack.mjs`, `tools/release/check-gate5-third-party-smoke.mjs`, `tools/release/check-gate6-commercial-pack.mjs`, `tools/release/check-gate6-third-party-smoke.mjs`.

最终验证记录（2026-05-28）：主进程已重新执行仓库级验证：`pnpm lint` 通过，package versions、core boundary 和中文注释检查通过；`pnpm typecheck` 通过；`pnpm test` 为 138 files / 695 tests passed；最终 `pnpm build` 通过并重新生成 core、license、native、docx、pdf、persistence、collab、collab-server 和 ui dist。Canonical 主计划已追加同日九项 remediation 复核记录，继续保留 Gate 7 文档站、wrapper、plugin 和 diagnostics export 为后续范围。
