# Gate 0 Dependency Versions

本文件记录 2026-05-11 Gate 0 根工具链配置的版本核验结果。

## Registry latest

以下版本通过 `npm view <package> version` 实测：

| Package | Version |
|---|---:|
| `pnpm` | `11.0.9` |
| `typescript` | `6.0.3` |
| `eslint` | `10.3.0` |
| `rollup` | `4.60.3` |
| `vite` | `8.0.12` |
| `vitest` | `4.1.5` |
| `@playwright/test` | `1.59.1` |
| `yjs` | `13.6.30` |
| `dompurify` | `3.4.2` |
| `jszip` | `3.10.1` |
| `pdf-lib` | `1.17.1` |
| `fontkit` | `2.0.4` |
| `@hocuspocus/server` | `4.0.0` |

## Local pnpm decision

用户明确要求本轮使用系统已有 pnpm，不要求 Corepack 切到 registry latest。

- `pnpm --version` 实测：`9.14.2`
- `packageManager` 写入：`pnpm@9.14.2`
- CI `pnpm/action-setup` 写入：`9.14.2`

## Support package versions

ESLint flat config 和 Rollup 基础配置需要以下支撑包，版本也通过 `npm view <package> version` 实测并精确固定：

| Package | Version |
|---|---:|
| `@eslint/js` | `10.0.1` |
| `typescript-eslint` | `8.59.2` |
| `globals` | `17.6.0` |
| `@types/node` | `25.6.2` |
| `@rollup/plugin-node-resolve` | `16.0.3` |
| `@rollup/plugin-commonjs` | `29.0.2` |
| `@rollup/plugin-typescript` | `12.3.0` |
| `rollup-plugin-dts` | `6.4.1` |
| `tslib` | `2.8.1` |

## Version rules

- `package.json` 中直接依赖使用精确版本。
- 不使用 `^` 或 `~`。
- 本轮不写任何自动 commit、tag、publish 配置。
