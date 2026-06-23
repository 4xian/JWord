/**
 * 职责：在浏览器 Hocuspocus runtime 中调用服务端 storage-backed history HTTP API。
 * 边界：只处理 HTTP JSON、base64 update、版本缓存和本地 restore 应用，不访问 DOM 或 IndexedDB。
 * 协作：hocuspocus-runtime.ts 负责触发记录/预览/恢复，server/hocuspocus-history-api.ts 负责持久化 backend。
 * 约束：readVersionHistory 是同步 debug API，因此异步刷新结果以本地缓存形式暴露。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import * as Y from 'yjs'
import type { JWordPersistenceDiagnostic } from '@4xian/jword-persistence'

import {
  restoreCoreDocumentFromUpdate
} from './hocuspocus-history'
import { readBodyTextFromUpdate } from './hocuspocus-projection'
import type {
  VersionHistoryEntry,
  VersionPreviewSnapshot
} from '../runtime'

export interface HocuspocusServerHistoryClientOptions {
  readonly historyApiUrl: string
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
  readonly notify: () => void
  readonly recordDiagnostics?: (diagnostics: readonly JWordPersistenceDiagnostic[]) => void
}

export interface HocuspocusServerHistoryClient {
  /** 读取本地缓存的服务端历史版本，并按需异步刷新。 */
  readVersionHistory(liveEntry: VersionHistoryEntry): readonly VersionHistoryEntry[]

  /** 记录当前 Y.Doc state update 到服务端 history backend。 */
  recordVersion(label: string, origin: string, update: Uint8Array): Promise<void>

  /** 从服务端 history backend 创建只读预览。 */
  previewVersion(versionId: string): Promise<VersionPreviewSnapshot | null>

  /** 从服务端 history backend 恢复版本，并追加 restore 版本。 */
  restoreVersion(versionId: string, targetDoc: Y.Doc): Promise<boolean>
}

interface HistoryApiVersionRecord {
  readonly versionId: string
  readonly label?: string
  readonly updateCount?: number
}

interface HistoryApiRecordVersionResponse {
  readonly version?: HistoryApiVersionRecord
}

interface HistoryApiListVersionsResponse {
  readonly versions?: readonly HistoryApiVersionRecord[]
}

interface HistoryApiPreviewResponse {
  readonly version?: HistoryApiVersionRecord
  readonly updateBase64?: string
}

/** 创建服务端 history HTTP client。 */
export function createHocuspocusServerHistoryClient(
  options: HocuspocusServerHistoryClientOptions
): HocuspocusServerHistoryClient {
  const versions = new Map<string, VersionHistoryEntry>()
  const versionUpdates = new Map<string, Uint8Array>()
  let refreshPromise: Promise<void> | null = null

  /** 读取本地缓存的服务端历史版本，并按需异步刷新。 */
  function readVersionHistory(liveEntry: VersionHistoryEntry): readonly VersionHistoryEntry[] {
    void refreshVersions()

    const entries = Array.from(versions.values())
      .sort((left, right) => left.revision - right.revision)

    return entries.length === 0 ? [liveEntry] : entries
  }

  /** 记录当前 Y.Doc state update 到服务端 history backend。 */
  async function recordVersion(label: string, origin: string, update: Uint8Array): Promise<void> {
    try {
      const response = await postJson<HistoryApiRecordVersionResponse>('versions', {
        documentId: options.documentId,
        roomId: options.roomId,
        clientId: options.clientId,
        authorId: options.authorId,
        origin,
        label,
        updateBase64: encodeBase64(update)
      })
      const version = response.version

      if (version === undefined) {
        return
      }

      versionUpdates.set(version.versionId, update)
      versions.set(version.versionId, toHistoryEntry(version, readBodyTextFromUpdate(update)))
      options.notify()
    } catch {
      recordHistoryApiFailure()
    }
  }

  /** 从服务端 history backend 创建只读预览。 */
  async function previewVersion(versionId: string): Promise<VersionPreviewSnapshot | null> {
    if (versionId === 'provider-live') {
      return null
    }

    const loaded = await loadVersionUpdate(versionId).catch(() => {
      recordHistoryApiFailure(versionId)
      return null
    })

    return loaded === null
      ? null
      : {
          id: loaded.entry.id,
          label: loaded.entry.label,
          text: loaded.entry.text
        }
  }

  /** 从服务端 history backend 恢复版本，并追加 restore 版本。 */
  async function restoreVersion(versionId: string, targetDoc: Y.Doc): Promise<boolean> {
    const loaded = await loadVersionUpdate(versionId).catch(() => {
      recordHistoryApiFailure(versionId)
      return null
    })

    if (loaded === null) {
      return false
    }

    restoreCoreDocumentFromUpdate(targetDoc, loaded.update, 'version-restore')
    await recordVersion(`restore:${loaded.entry.label}`, 'version-restore', Y.encodeStateAsUpdate(targetDoc))

    return true
  }

  /** 刷新服务端版本列表，补齐缺失版本的预览文本。 */
  async function refreshVersions(): Promise<void> {
    if (refreshPromise !== null) {
      return refreshPromise
    }

    refreshPromise = fetchJson<HistoryApiListVersionsResponse>(
      `versions?documentId=${encodeURIComponent(options.documentId)}`
    ).then(async (response) => {
      const records = response.versions ?? []

      for (const record of records) {
        if (!versions.has(record.versionId)) {
          versions.set(record.versionId, toHistoryEntry(record, ''))
        }
      }

      await Promise.all(records.map(async (record) => {
        const entry = versions.get(record.versionId)

        if (entry !== undefined && entry.text !== '') {
          return
        }

        await loadVersionUpdate(record.versionId)
      }))
      options.notify()
    }).catch(() => {
      recordHistoryApiFailure()
    }).finally(() => {
      refreshPromise = null
    })

    return refreshPromise
  }

  /** 从服务端加载版本 update，并刷新本地缓存。 */
  async function loadVersionUpdate(
    versionId: string
  ): Promise<{ readonly entry: VersionHistoryEntry, readonly update: Uint8Array } | null> {
    const response = await postJson<HistoryApiPreviewResponse>('preview', {
      documentId: options.documentId,
      versionId
    })

    if (response.version === undefined || response.updateBase64 === undefined) {
      return null
    }

    const update = decodeBase64(response.updateBase64)
    const entry = toHistoryEntry(response.version, readBodyTextFromUpdate(update))

    versionUpdates.set(versionId, update)
    versions.set(versionId, entry)

    return {
      entry,
      update
    }
  }

  /** 执行 GET 请求并读取 JSON。 */
  async function fetchJson<Result>(path: string): Promise<Result> {
    const response = await fetch(`${options.historyApiUrl}/jword-history/${path}`)

    if (!response.ok) {
      throw new Error(`JWord history API GET failed: ${response.status}`)
    }

    return await response.json() as Result
  }

  /** 执行 POST 请求并读取 JSON。 */
  async function postJson<Result>(path: string, body: object): Promise<Result> {
    const response = await fetch(`${options.historyApiUrl}/jword-history/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`JWord history API POST failed: ${response.status}`)
    }

    return await response.json() as Result
  }

  /** 记录服务端 history API 失败诊断，并通知 demo 刷新。 */
  function recordHistoryApiFailure(versionId?: string): void {
    options.recordDiagnostics?.([createHistoryApiFailureDiagnostic(options.documentId, versionId)])
    options.notify()
  }

  return {
    readVersionHistory,
    recordVersion,
    previewVersion,
    restoreVersion
  }
}

/** 将服务端版本元数据转换成 demo 历史项。 */
function toHistoryEntry(record: HistoryApiVersionRecord, text: string): VersionHistoryEntry {
  return {
    id: record.versionId,
    label: record.label ?? record.versionId,
    revision: record.updateCount ?? 0,
    text
  }
}

/** 编码 browser fetch 使用的 base64 update。 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

/** 解码服务端返回的 base64 update。 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 创建服务端 history API 失败诊断。 */
function createHistoryApiFailureDiagnostic(
  documentId: string,
  versionId?: string
): JWordPersistenceDiagnostic {
  return {
    code: 'PERSISTENCE_RESTORE_FAILED',
    severity: 'error',
    recoverable: false,
    message: 'Server history API request failed; current document was not changed.',
    documentId,
    ...(versionId === undefined ? {} : { versionId })
  }
}
