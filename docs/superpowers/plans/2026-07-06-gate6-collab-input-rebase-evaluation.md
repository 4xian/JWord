# Gate 6 协同输入 rebase 方案评估

> 日期：2026-07-06  
> 对应修复项：`[计划审查 2.1] 协同输入 rebase 方案评估`  
> 执行依据：`docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md` §3.12 / D7

## 结论

评估通过，暂不切换替代方案。

本轮新增 `examples/collab/tests/collab-input-rebase-stress.test.ts`，将 textarea 旧基线输入 rebase 路径固化为回归测试。压测结果为 210 / 210 轮一致，最终一致率 100%，未触发 D7 的“低于 100% 即切换替代方案”条件，因此保留现有 `examples/collab/src/runtime/hocuspocus-text-command.ts` 路径。

## 压测范围

压测启动真实本地 Hocuspocus 服务与双 client provider adapter，并在每个批次使用隔离 room。为稳定锁定 D7 的远端处理边界，测试内将本端 `Y.Doc` update 应用到对端后刷新 projection，覆盖“远端更新仅 `Y.applyUpdate` 后刷新 projection/layout/render”的收敛路径。

随机序列固定 seed：`1779900449`。

| 场景 | 轮数 | 断言 |
| --- | ---: | --- |
| 同位置同时输入 | 76 | 双端最终文本一致；双方 token 均只出现一次；无多余 bold range。 |
| 一方删除另一方正在插入的区域 | 66 | 双端最终文本一致；远端插入片段保留；无多余 bold range。 |
| 格式化与文本编辑重叠区 | 68 | 双端最终文本一致；被删格式化文本不残留；双端格式快照一致。 |

## 实测数据

```json
{
  "seed": 1779900449,
  "rounds": 210,
  "consistentRounds": 210,
  "consistencyRate": 1,
  "scenarioCounts": {
    "same-position-insert": 76,
    "delete-over-remote-insert": 66,
    "format-overlapping-edit": 68
  },
  "failures": []
}
```

## 验证命令

```bash
pnpm exec vitest run examples/collab/tests/collab-input-rebase-stress.test.ts --reporter=verbose
```

结果：1 file / 1 test passed，输出 `JWORD_COLLAB_REBASE_STRESS_SUMMARY`，一致率 100%。

## 后续口径

- 本项只完成计划审查 2.1 的评估和回归固化，不声明协同输入最终 stable 方案完成。
- 如果后续新增真实 textarea harness、IME beforeinput 细分事件或 multi-run rich text 输入路径，需要继续扩展本压测矩阵。
- 若任一后续压测出现一致率低于 100%，按 D7 切换到以 core command / Y.RelativePosition 为基准的输入定位方案，并删除 demo 级 value diff rebase 逻辑。
