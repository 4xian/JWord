/**
 * 职责：提供 Gate 5 DOCX 兼容 runner 的通用 JSON、字段和 fixture 工具函数。
 * 边界：不执行 DOCX/PDF 互通，不启动外部办公软件。
 * 协作模块：run-gate5-docx-compatibility.mjs 使用这些纯工具完成输入校验和输出。
 * 约束：工具函数只做确定性解析和文件存在性判断，不把缺失证据伪装成通过。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

/** 判断未知值是否包含指定字符串字段。 */
export function isStringField(value, field) {
  return typeof value === 'object' &&
    value !== null &&
    typeof value[field] === 'string'
}

/** 判断未知值是否缺少字段或包含指定字符串字段。 */
export function isOptionalStringField(value, field) {
  return typeof value === 'object' &&
    value !== null &&
    (value[field] === undefined || typeof value[field] === 'string')
}

/** 判断未知值是否缺少字段或包含指定数字字段。 */
export function isOptionalNumberField(value, field) {
  return typeof value === 'object' &&
    value !== null &&
    (value[field] === undefined || typeof value[field] === 'number')
}

/** 汇总 registry 中真实可运行 fixture 数量。 */
export function summarizeFixtures(fixtures) {
  const available = fixtures.filter(isAvailableFixture).length

  return {
    total: fixtures.length,
    available,
    missing: fixtures.length - available
  }
}

/** 判断 fixture 是否已有真实输入文件。 */
export function isAvailableFixture(fixture) {
  return fixture !== undefined &&
    fixture.input?.state === 'available' &&
    typeof fixture.input.path === 'string' &&
    existsSync(fixture.input.path)
}

/** 读取 JSON 文件。 */
export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** 读取正整数环境变量，缺失或无效时使用默认值。 */
export function readPositiveIntegerEnv(name, defaultValue) {
  const value = process.env[name]

  if (value === undefined || value.trim().length === 0) {
    return defaultValue
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

/** 输出格式化 JSON。 */
export function printJson(value) {
  console.log(JSON.stringify(value, null, 2))
}

/** 判断命令是否存在于 PATH。 */
export function commandExists(command) {
  return spawnSync('sh', ['-lc', `command -v ${quoteShell(command)}`], {
    stdio: 'ignore'
  }).status === 0
}

/** 运行外部命令并捕获 stdout/stderr。 */
export function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs })
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: readCommandErrorOutput(result, options.timeoutMs)
  }
}

/** 把 validator 命令模板展开为最终 argv。 */
export function expandCommandTemplateParts(parts, artifactPath) {
  const hasArtifactPlaceholder = parts.some((part) => part.includes('{artifact}'))
  const expandedParts = parts.map((part) => part.replaceAll('{artifact}', artifactPath))

  return hasArtifactPlaceholder ? expandedParts : [...expandedParts, artifactPath]
}

/** 解析显式命令模板，支持常见 shell 引号和空白分隔。 */
export function parseCommandTemplate(command) {
  const parts = []
  let current = ''
  let quote = null
  let hasToken = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote !== null) {
      if (character === quote) {
        quote = null
        continue
      }

      if (quote === '"' && character === '\\') {
        const escaped = command[index + 1]

        if (escaped !== undefined) {
          current += escaped
          index += 1
          hasToken = true
          continue
        }
      }

      current += character
      hasToken = true
      continue
    }

    if (/\s/u.test(character)) {
      if (hasToken) {
        parts.push(current)
        current = ''
        hasToken = false
      }
      continue
    }

    if (character === '\'' || character === '"') {
      quote = character
      hasToken = true
      continue
    }

    if (character === '\\') {
      const escaped = command[index + 1]

      if (escaped !== undefined) {
        current += escaped
        index += 1
        hasToken = true
        continue
      }
    }

    current += character
    hasToken = true
  }

  if (quote !== null) {
    throw new Error('OPENXML_VALIDATOR_COMMAND has unmatched quotes.')
  }

  if (hasToken) {
    parts.push(current)
  }

  return parts
}

/** 格式化外部命令 evidence。 */
export function formatCommandEvidence(command, result) {
  const output = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join('\n')

  return output.length === 0 ? command : `${command}: ${output}`
}

/** 读取外部命令失败原因。 */
export function readCommandFailureMessage(result) {
  const message = [result.stderr.trim(), result.stdout.trim()].filter((part) => part.length > 0).join('\n')

  return message.length === 0 ? `Command exited with ${result.status}.` : message
}

/** 为固定候选命令生成 shell 查询参数。 */
function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** 读取外部命令错误输出，超时时返回稳定诊断。 */
function readCommandErrorOutput(result, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT') {
    return `Open XML validator command timed out after ${timeoutMs}ms.`
  }

  return result.stderr ?? ''
}
