/**
 * 职责：为 Gate 2 分页布局 提供 脏页 优先、后续页分片和页起点早停的纯调度计划。
 * 边界：只计算页索引调度，不执行 layout、不读取 Y.Doc、不访问 DOM、不创建计时器。
 * 协作模块：Editor、worker 或后续 idle scheduler 可按本模块结果调度当前页和后续页重排。
 * 性能/安全约束：调度结果不可变，避免一次性重排所有页成为默认路径。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-2---分页-layout-与-canvas-render。
 */

export interface LayoutScheduleInput {
  readonly pageCount: number
  readonly dirtyPageIndex: number
  readonly previousPageStartKeys?: readonly string[]
  readonly nextPageStartKeys?: readonly string[]
  readonly chunkSize?: number
}

export interface LayoutSchedule {
  readonly immediatePageIndexes: readonly number[]
  readonly deferredChunks: readonly (readonly number[])[]
  readonly stoppedAtPageIndex?: number
}

/**
 * 创建分页重排调度计划。
 *
 * @param input 页数、脏页、页起点指纹和分片大小。
 * @returns 当前页同步重排和后续页分片重排计划。
 */
export function createLayoutSchedule(input: LayoutScheduleInput): LayoutSchedule {
  const pageCount = Math.max(0, input.pageCount)
  const dirtyPageIndex = clampPageIndex(input.dirtyPageIndex, pageCount)

  if (dirtyPageIndex === undefined) {
    return Object.freeze({
      immediatePageIndexes: Object.freeze([]),
      deferredChunks: Object.freeze([])
    })
  }

  const chunkSize = Math.max(1, input.chunkSize ?? 4)
  const deferredPageIndexes: number[] = []
  const stoppedAtPageIndex = findStablePageStart(input, dirtyPageIndex, pageCount)
  const endPageIndex = stoppedAtPageIndex ?? pageCount

  for (let pageIndex = dirtyPageIndex + 1; pageIndex < endPageIndex; pageIndex += 1) {
    deferredPageIndexes.push(pageIndex)
  }

  return Object.freeze({
    immediatePageIndexes: Object.freeze([dirtyPageIndex]),
    deferredChunks: Object.freeze(chunkPageIndexes(deferredPageIndexes, chunkSize)),
    ...(stoppedAtPageIndex === undefined ? {} : { stoppedAtPageIndex })
  })
}

function clampPageIndex(pageIndex: number, pageCount: number): number | undefined {
  if (pageCount === 0 || !Number.isInteger(pageIndex)) {
    return undefined
  }

  return Math.min(Math.max(pageIndex, 0), pageCount - 1)
}

function findStablePageStart(
  input: LayoutScheduleInput,
  dirtyPageIndex: number,
  pageCount: number
): number | undefined {
  const previousKeys = input.previousPageStartKeys
  const nextKeys = input.nextPageStartKeys

  if (previousKeys === undefined || nextKeys === undefined) {
    return undefined
  }

  for (let pageIndex = dirtyPageIndex + 1; pageIndex < pageCount; pageIndex += 1) {
    if (previousKeys[pageIndex] === nextKeys[pageIndex]) {
      return pageIndex
    }
  }

  return undefined
}

function chunkPageIndexes(
  pageIndexes: readonly number[],
  chunkSize: number
): readonly (readonly number[])[] {
  const chunks: number[][] = []

  for (let index = 0; index < pageIndexes.length; index += chunkSize) {
    chunks.push(pageIndexes.slice(index, index + chunkSize))
  }

  return chunks.map((chunk) => Object.freeze(chunk))
}
