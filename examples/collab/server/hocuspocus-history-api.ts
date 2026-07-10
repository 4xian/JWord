/**
 * 职责：为 Hocuspocus demo 暴露浏览器可访问的 history HTTP API。
 * 边界：只处理 JSON over HTTP 与 service 调用，不承载 WebSocket、浏览器 runtime 或 IndexedDB 逻辑。
 * 协作：hocuspocus-history-service.ts 提供 storage-backed history backend，hocuspocus-service.ts 管理生命周期。
 * 约束：HTTP 响应不泄漏 Uint8Array 结构体，二进制 update 统一使用 base64。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { createServer } from 'node:http'
import type {
  IncomingMessage,
  Server,
  ServerResponse
} from 'node:http'
import type {
  JWordPersistenceDiagnostic,
  JWordSnapshotRecord,
  JWordVersionRecord
} from '@4xian/jword-persistence'

import type {
  CollabHocuspocusHistoryService
} from './hocuspocus-history-service.ts'

export interface CollabHocuspocusHistoryApiOptions {
  readonly address: string
  readonly port?: number
  readonly historyService: CollabHocuspocusHistoryService
}

export interface CollabHocuspocusHistoryApiState {
  readonly address: string
  readonly port: number
  readonly httpUrl: string
}

export interface CollabHocuspocusHistoryApiServer {
  /** 启动 history HTTP API。 */
  start(): Promise<CollabHocuspocusHistoryApiState>

  /** 停止 history HTTP API。 */
  stop(): Promise<void>
}

interface RecordVersionRequest {
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
  readonly origin: string
  readonly label: string
  readonly updateBase64: string
  readonly snapshotId?: string
  readonly createdAt?: string
}

interface VersionLookupRequest {
  readonly documentId: string
  readonly versionId: string
}

const defaultHistoryApiPort = 0

/** 创建服务端 history HTTP API。 */
export function createCollabHocuspocusHistoryApiServer(
  options: CollabHocuspocusHistoryApiOptions
): CollabHocuspocusHistoryApiServer {
  const server = createServer((request, response) => {
    void handleHistoryApiRequest(options.historyService, request, response)
  })
  let state: CollabHocuspocusHistoryApiState | null = null

  return {
    /** 启动 history HTTP API。 */
    async start() {
      if (state !== null) {
        return state
      }

      await new Promise<void>((resolve) => {
        server.listen(options.port ?? defaultHistoryApiPort, options.address, resolve)
      })

      const address = server.address()

      if (typeof address !== 'object' || address === null) {
        throw new Error('JWord history API server did not expose a TCP address.')
      }

      state = {
        address: options.address,
        port: address.port,
        httpUrl: `http://${options.address}:${address.port}`
      }

      return state
    },

    /** 停止 history HTTP API。 */
    async stop() {
      if (state === null) {
        return
      }

      await closeServer(server)
      state = null
    }
  }
}

/** 分发 history HTTP API 请求。 */
async function handleHistoryApiRequest(
  historyService: CollabHocuspocusHistoryService,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (request.method === 'OPTIONS') {
    writeJson(response, 204, {})
    return
  }

  if (request.method === 'GET' && url.pathname === '/jword-history/versions') {
    await handleListVersions(historyService, url, response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/jword-history/versions') {
    await handleRecordVersion(historyService, request, response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/jword-history/preview') {
    await handlePreviewVersion(historyService, request, response)
    return
  }

  writeJson(response, 404, {
    error: 'JWORD_HISTORY_API_NOT_FOUND'
  })
}

/** 处理版本列表请求。 */
async function handleListVersions(
  historyService: CollabHocuspocusHistoryService,
  url: URL,
  response: ServerResponse
): Promise<void> {
  const documentId = url.searchParams.get('documentId')

  if (documentId === null || documentId.trim() === '') {
    writeJson(response, 400, {
      error: 'JWORD_HISTORY_DOCUMENT_ID_REQUIRED'
    })
    return
  }

  const versions = await historyService.listVersions(documentId)

  writeJson(response, 200, {
    versions: versions.map(serializeVersionRecord)
  })
}

/** 处理记录版本请求。 */
async function handleRecordVersion(
  historyService: CollabHocuspocusHistoryService,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = readRecordVersionRequest(await readJsonBody(request))

  if (body === null) {
    writeJson(response, 400, {
      error: 'JWORD_HISTORY_RECORD_PAYLOAD_INVALID'
    })
    return
  }

  const result = await historyService.recordVersion({
    documentId: body.documentId,
    roomId: body.roomId,
    clientId: body.clientId,
    authorId: body.authorId,
    origin: body.origin,
    label: body.label,
    update: decodeBase64(body.updateBase64),
    ...(body.snapshotId === undefined ? {} : { snapshotId: body.snapshotId }),
    ...(body.createdAt === undefined ? {} : { createdAt: body.createdAt })
  })

  writeJson(response, 200, {
    version: serializeVersionRecord(result.version),
    snapshot: serializeSnapshotRecord(result.snapshot),
    diagnostics: result.diagnostics.map(serializeDiagnostic)
  })
}

/** 处理版本预览请求。 */
async function handlePreviewVersion(
  historyService: CollabHocuspocusHistoryService,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = readVersionLookupRequest(await readJsonBody(request))

  if (body === null) {
    writeJson(response, 400, {
      error: 'JWORD_HISTORY_PREVIEW_PAYLOAD_INVALID'
    })
    return
  }

  const preview = await historyService.createPreview(body)

  writeJson(response, 200, {
    ...(preview.version === undefined ? {} : { version: serializeVersionRecord(preview.version) }),
    updateBase64: encodeBase64(preview.update),
    diagnostics: preview.diagnostics.map(serializeDiagnostic)
  })
}

/** 读取 JSON 请求体。 */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 校验记录版本请求体。 */
function readRecordVersionRequest(value: unknown): RecordVersionRequest | null {
  if (!isRecord(value)) {
    return null
  }

  const request = {
    documentId: readString(value.documentId),
    roomId: readString(value.roomId),
    clientId: readString(value.clientId),
    authorId: readString(value.authorId),
    origin: readString(value.origin),
    label: readString(value.label),
    updateBase64: readString(value.updateBase64),
    snapshotId: readOptionalString(value.snapshotId),
    createdAt: readOptionalString(value.createdAt)
  }

  return request.documentId === null ||
    request.roomId === null ||
    request.clientId === null ||
    request.authorId === null ||
    request.origin === null ||
    request.label === null ||
    request.updateBase64 === null
    ? null
    : {
        documentId: request.documentId,
        roomId: request.roomId,
        clientId: request.clientId,
        authorId: request.authorId,
        origin: request.origin,
        label: request.label,
        updateBase64: request.updateBase64,
        ...(request.snapshotId === undefined ? {} : { snapshotId: request.snapshotId }),
        ...(request.createdAt === undefined ? {} : { createdAt: request.createdAt })
      }
}

/** 校验版本查找请求体。 */
function readVersionLookupRequest(value: unknown): VersionLookupRequest | null {
  if (!isRecord(value)) {
    return null
  }

  const documentId = readString(value.documentId)
  const versionId = readString(value.versionId)

  return documentId === null || versionId === null
    ? null
    : {
        documentId,
        versionId
      }
}

/** 序列化版本元数据。 */
function serializeVersionRecord(version: JWordVersionRecord): object {
  return {
    ...version,
    ...(version.stateVector === undefined ? {} : { stateVectorBase64: encodeBase64(version.stateVector) })
  }
}

/** 序列化 snapshot 元数据。 */
function serializeSnapshotRecord(snapshot: JWordSnapshotRecord): object {
  return {
    ...snapshot,
    stateUpdateBase64: encodeBase64(snapshot.stateUpdate),
    stateVectorBase64: encodeBase64(snapshot.stateVector),
    stateUpdate: undefined,
    stateVector: undefined
  }
}

/** 序列化诊断对象。 */
function serializeDiagnostic(diagnostic: JWordPersistenceDiagnostic): object {
  return {
    ...diagnostic
  }
}

/** 写出 JSON 响应。 */
function writeJson(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  })
  response.end(JSON.stringify(payload))
}

/** 判断未知值是否是普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取必填字符串。 */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 读取可选字符串。 */
function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 编码二进制 update。 */
function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** 解码二进制 update。 */
function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** 关闭 Node HTTP server。 */
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
