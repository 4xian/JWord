# JWord 发布元数据与 dry-run 审计

> 快照日期：2026-07-07。
> 本文对应 `JW-BACKLOG-006` 的 dry-run 审计层。本文不会执行真实 publish，也不替代人工发布审批。

## 结论

当前包已经具备 dry-run 级别的发布护栏：每个 package manifest 指向 `dist`、export map 不暴露源码、release dry-run 脚本只执行 `npm pack --dry-run --json` 并声明 `publish: not-run`。

真实 registry 发布仍不得直接执行，原因：

- 所有包当前仍为 `private: true`。
- 根版本与包版本均为 `0.0.0`，未形成正式发布版本策略。
- package manifest 未统一声明 `license` 字段，真实 registry 发布前需确认授权文本和 metadata。
- paid/restricted 包的 registry、scope access、token、2FA、dist-tag、rollback 流程仍需人工确认。
- no-alias 外部项目 smoke 和长矩阵仍需发布前 fresh run。

## 包元数据清单

| 包 | access | private | exports | files | 主要外部依赖 | 发布审计结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `@4xian/jword-core` | public | true | `.` | `dist` | `yjs` | dry-run 候选；真实发布需移除 private 并确认 license。 |
| `@4xian/jword-ui` | public | true | `.`, `./styles.css` | `dist` | `dompurify` | CSS sideEffects 已声明；真实发布需确认 license。 |
| `@4xian/jword-native` | public | true | `.`, `./worker` | `dist`, `fixtures`, `README.md` | `jszip` | worker 子入口已在 export map；fixtures 进入包需发布前复核体积。 |
| `@4xian/jword-devtools` | public | true | `.` | `dist` | 无直接外部运行依赖 | opt-in 面板包；真实发布需确认浏览器 DOM 使用说明。 |
| `@4xian/jword-react` | public | true | `.` | `dist` | peer `react`, `react-dom` | peerDependencies 已声明；真实发布需确认 peer 版本范围策略。 |
| `@4xian/jword-vue` | public | true | `.` | `dist` | peer `vue` | peerDependencies 已声明；真实发布需确认 peer 版本范围策略。 |
| `@4xian/jword-license` | restricted | true | `.` | `dist`, `README.md` | 无 | paid 基础包；真实发布需确认私有 registry 与访问控制。 |
| `@4xian/jword-docx` | restricted | true | `.`, `./worker` | `dist` | `jszip` | paid format；真实发布需确认授权 gating 和 worker 说明。 |
| `@4xian/jword-pdf` | restricted | true | `.`, `./worker` | `dist` | `fontkit`, `pdf-lib`, `pdfjs-dist` | paid format；真实发布需确认依赖体积和 license。 |
| `@4xian/jword-persistence` | restricted | true | `.` | `dist`, `README.md` | `y-indexeddb`, `yjs` | storage 能力包；真实发布需确认 IndexedDB 浏览器边界。 |
| `@4xian/jword-collab` | restricted | true | `.`, `./experimental` | `dist`, `README.md` | `@hocuspocus/provider`, `y-protocols`, `yjs` | paid collab；experimental 子入口需发布说明。 |
| `@4xian/jword-collab-server` | restricted | true | `.` | `dist`, `README.md` | `@hocuspocus/server`, `y-protocols`, `yjs` | server 包；真实发布需确认 Node runtime 和部署说明。 |

## 发布顺序建议

真实发布前建议按依赖方向分批：

1. free 基础：`core` → `ui` → `native`。
2. paid 基础：`license`。
3. paid formats：`docx`、`pdf`。
4. persistence / collab：`persistence` → `collab` → `collab-server`。
5. tooling / wrappers：`devtools`、`react`、`vue`。

任何批次发布前都必须完成：版本号确认、license metadata、registry access、dry-run、tarball 内容审计、外部项目 no-alias smoke、人工审批。

## dry-run 命令

| 命令 | 作用 | 是否 publish |
| --- | --- | --- |
| `node tools/release/gate7-release-dry-run.mjs` | 检查 dist 产物、manifest、export map、`npm pack --dry-run --json` 文件清单。 | 否 |
| `node tools/release/gate7-release-dry-run.mjs --build` | 先执行 `pnpm build`，再执行上述 dry-run。 | 否 |
| `node tools/release/check-gate7-third-party-smoke.mjs` | 打包本地 tarball，安装到临时第三方项目，跑 typecheck、Vite build、Chromium smoke。 | 否 |

## 本轮 dry-run 结果

执行命令：

```bash
node tools/release/gate7-release-dry-run.mjs
```

结果：通过，退出码 0。

报告摘要：

- `status: ok`
- `publish: not-run`
- `manualApprovalRequired: true`
- `changesetDraft: manual-draft-required`
- 12 个 package 均完成 manifest、dist 文件和 `npm pack --dry-run --json` 检查。
- 所有 package 的 `failures` 均为空数组。

解释：当前 dry-run 说明 dist 产物、export map 和 pack 文件清单没有发现脚本定义的发布结构问题；它不代表可以真实 publish。真实 publish 仍被 `private: true`、版本策略、license metadata、registry 权限和人工审批阻断。

## 真实发布人工审批清单

- [ ] 明确发布 registry：npm public、npm private 或企业私有 registry。
- [ ] 明确哪些包移除 `private: true`，哪些继续保持私有。
- [ ] 统一包版本号和 changelog / changeset 草稿。
- [ ] 补齐或确认每个包的 `license` metadata。
- [ ] 确认 `publishConfig.access` 与 registry 权限一致。
- [ ] 确认 token、2FA、provenance、dist-tag、rollback 策略。
- [ ] fresh run release dry-run 和 no-alias third-party smoke。
- [ ] 经人工确认后才允许执行真实 publish。
