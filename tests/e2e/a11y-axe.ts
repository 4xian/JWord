/**
 * @fileoverview 职责：为 Playwright E2E 提供统一的 axe-core 严重无障碍问题扫描。
 * 边界：只注入 axe-core 并断言 serious/critical violation；不替代键盘路径或人工屏幕阅读器验收。
 * 协作：Gate 4-6 a11y E2E 和根 package.json 的 axe-core devDependency。
 * 约束：扫描输出只保留规则、影响级别和目标节点，避免快照整页 HTML。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md#67-a11y-验收。
 */
import { expect, type Page } from '@playwright/test'
import axeCore from 'axe-core'

type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical'

interface AxeNodeSummary {
  readonly target: readonly string[]
  readonly failureSummary?: string
}

interface AxeViolationSummary {
  readonly id: string
  readonly impact: AxeImpact | null
  readonly help: string
  readonly nodes: readonly AxeNodeSummary[]
}

interface AxeRunResult {
  readonly violations: readonly AxeViolationSummary[]
}

interface AxeRunner {
  run(
    context: string | Document,
    options: {
      readonly resultTypes: readonly ['violations']
    }
  ): Promise<AxeRunResult>
}

interface AxeScanPayload {
  readonly context: string | null
  readonly impacts: readonly AxeImpact[]
}

export interface ExpectNoSeriousAxeViolationsOptions {
  readonly label: string
  readonly context?: string
  readonly impacts?: readonly AxeImpact[]
}

/** 注入 axe-core 并断言指定范围内没有 serious/critical violation。 */
export async function expectNoSeriousAxeViolations(
  page: Page,
  options: ExpectNoSeriousAxeViolationsOptions
): Promise<void> {
  const impacts = options.impacts ?? ['serious', 'critical']

  await page.addScriptTag({ content: axeCore.source })

  const violations = await page.evaluate(async (payload: AxeScanPayload) => {
    const axe = (window as unknown as { readonly axe?: AxeRunner }).axe

    if (axe === undefined) {
      throw new Error('axe-core 未注入页面。')
    }

    const result = await axe.run(payload.context ?? document, {
      resultTypes: ['violations']
    })

    return result.violations
      .filter((violation) =>
        violation.impact !== null && payload.impacts.includes(violation.impact)
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          ...(node.failureSummary === undefined ? {} : { failureSummary: node.failureSummary })
        }))
      }))
  }, {
    context: options.context ?? null,
    impacts
  })

  expect(violations, formatAxeFailure(options.label, violations)).toEqual([])
}

/** 格式化 axe 扫描失败信息，方便定位真实 DOM 节点。 */
function formatAxeFailure(label: string, violations: readonly AxeViolationSummary[]): string {
  return [
    `${label} 存在 serious/critical a11y violation。`,
    ...violations.map((violation) =>
      `${violation.impact ?? 'unknown'} ${violation.id}: ${violation.help} -> ${
        violation.nodes.map((node) => node.target.join(' ')).join('; ')
      }`
    )
  ].join('\n')
}
