/**
 * 职责：处理正式协同服务端的 history HTTP list、record 和 preview 路由。
 * 边界：只处理 history payload、tenant/license gate 和 storage service 调用，不负责 health/version/license-status。
 * 协作模块：index.ts 分发路由；history-service.ts 提供 storage-backed 版本服务；request-guards.ts 提供 tenant hook。
 * 性能/安全约束：record/preview 在读取 body 前必须先从 URL/header 读取 metadata 并完成 tenant/license 检查。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  IncomingMessage,
  ServerResponse
} from 'node:http'
import {
  GATE6_COLLAB_FEATURES,
  type JWordLicenseEntitlement
} from '@4xian/jword-license'
import type {
  JWordPersistenceDiagnostic,
  JWordSnapshotRecord,
  JWordVersionRecord
} from '@4xian/jword-persistence'

import type {
  JWordCollabServerLicenseHook,
  JWordCollabServerTenantHook
} from './index.js'
import type {
  JWordCollabHistoryService
} from './history-service.js'
import {
  isJWordCollabHistoryLockQueueExceededError
} from './history-service.js'
import {
  checkJWordCollabTenant
} from './request-guards.js'
import {
  decodeBase64,
  encodeBase64,
  isRecord,
  readEntitlementMetadata,
  readJsonBody,
  readOptionalEntitlement,
  readOptionalString,
  readString,
  writeJson
} from './http-utils.js'

export interface HandleJWordHistoryRequestOptions {
  readonly licenseHook?: JWordCollabServerLicenseHook
  readonly tenantHook?: JWordCollabServerTenantHook
  readonly historyService?: JWordCollabHistoryService
  readonly maxPayloadBytes: number
  readonly allowedOrigins?: readonly string[]
}

interface RecordHistoryVersionRequest {
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
  readonly origin: string
  readonly label: string
  readonly updateBase64: string
  readonly snapshotId?: string
  readonly createdAt?: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

interface HistoryVersionLookupRequest {
  readonly documentId: string
  readonly versionId: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

interface LicenseMetadata {
  readonly documentId: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

interface HistoryPreviewLicenseMetadata extends LicenseMetadata {
  readonly versionId: string
}

const licenseHookRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
const licenseMetadataRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_METADATA_REQUIRED'

/** 处理 history 版本列表请求。 */
export async function handleListHistoryVersions(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  requestId: string,
  options: HandleJWordHistoryRequestOptions,
  requestOrigin?: string
): Promise<void> {
  const documentId = url.searchParams.get('documentId')
  const tenantId = url.searchParams.get('tenantId') ?? undefined
  const entitlement = readEntitlementMetadata(request, url)

  if (documentId === null || documentId.trim() === '') {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_DOCUMENT_ID_REQUIRED',
      requestId
    }, options.allowedOrigins, requestOrigin)
    return
  }

  const tenant = await checkJWordCollabTenant(options.tenantHook, requestId, documentId, tenantId)

  if (!tenant.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: tenant.diagnosticCode,
      requestId
    }, options.allowedOrigins, requestOrigin)
    return
  }

  const license = await checkHistoryLicense(options.licenseHook, {
    documentId,
    feature: GATE6_COLLAB_FEATURES.history,
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(entitlement === undefined ? {} : { entitlement })
  })

  if (!license.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: license.diagnosticCode,
      requestId
    }, options.allowedOrigins, requestOrigin)
    return
  }

  if (options.historyService === undefined) {
    writeJson(response, 503, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_STORAGE_MISSING',
      requestId
    }, options.allowedOrigins, requestOrigin)
    return
  }

  let versions: readonly JWordVersionRecord[]

  try {
    versions = await options.historyService.listVersions(documentId)
  } catch (error: unknown) {
    if (writeHistoryServiceError(response, requestId, options, requestOrigin, error)) {
      return
    }

    throw error
  }

  writeJson(response, 200, {
    versions: versions.map(serializeVersionRecord),
    requestId
  }, options.allowedOrigins, requestOrigin)
}

/** 处理 history 版本写入请求。 */
export async function handleRecordHistoryVersion(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  options: HandleJWordHistoryRequestOptions
): Promise<void> {
  const metadata = readLicenseMetadata(request, new URL(request.url ?? '/', 'http://127.0.0.1'))

  if (metadata === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: licenseMetadataRequiredDiagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const tenant = await checkJWordCollabTenant(options.tenantHook, requestId, metadata.documentId, metadata.tenantId)

  if (!tenant.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: tenant.diagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const license = await checkHistoryLicense(options.licenseHook, {
    documentId: metadata.documentId,
    feature: GATE6_COLLAB_FEATURES.history,
    ...(metadata.tenantId === undefined ? {} : { tenantId: metadata.tenantId }),
    ...(metadata.entitlement === undefined ? {} : { entitlement: metadata.entitlement })
  })

  if (!license.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: license.diagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const body = readRecordHistoryVersionRequest(await readJsonBody(request, options.maxPayloadBytes))

  if (body === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_RECORD_PAYLOAD_INVALID',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (body.documentId !== metadata.documentId || !isTenantMetadataMatched(body.tenantId, metadata.tenantId)) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_METADATA_MISMATCH',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (options.historyService === undefined) {
    writeJson(response, 503, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_STORAGE_MISSING',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  let recorded: Awaited<ReturnType<JWordCollabHistoryService['recordVersion']>>

  try {
    recorded = await options.historyService.recordVersion({
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
  } catch (error: unknown) {
    if (writeHistoryServiceError(response, requestId, options, request.headers.origin, error)) {
      return
    }

    throw error
  }

  writeJson(response, 200, {
    version: serializeVersionRecord(recorded.version),
    snapshot: serializeSnapshotRecord(recorded.snapshot),
    diagnostics: recorded.diagnostics.map(serializeDiagnostic),
    requestId
  }, options.allowedOrigins, request.headers.origin)
}

/** 处理 history 版本预览请求。 */
export async function handlePreviewHistoryVersion(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  options: HandleJWordHistoryRequestOptions
): Promise<void> {
  const metadata = readHistoryPreviewLicenseMetadata(request, new URL(request.url ?? '/', 'http://127.0.0.1'))

  if (metadata === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: licenseMetadataRequiredDiagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const tenant = await checkJWordCollabTenant(options.tenantHook, requestId, metadata.documentId, metadata.tenantId)

  if (!tenant.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: tenant.diagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const license = await checkHistoryLicense(options.licenseHook, {
    documentId: metadata.documentId,
    feature: GATE6_COLLAB_FEATURES.history,
    ...(metadata.tenantId === undefined ? {} : { tenantId: metadata.tenantId }),
    ...(metadata.entitlement === undefined ? {} : { entitlement: metadata.entitlement })
  })

  if (!license.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: license.diagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const body = readHistoryVersionLookupRequest(await readJsonBody(request, options.maxPayloadBytes))

  if (body === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_PREVIEW_PAYLOAD_INVALID',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (
    body.documentId !== metadata.documentId ||
    body.versionId !== metadata.versionId ||
    !isTenantMetadataMatched(body.tenantId, metadata.tenantId)
  ) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_METADATA_MISMATCH',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (options.historyService === undefined) {
    writeJson(response, 503, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_HISTORY_STORAGE_MISSING',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  let preview: Awaited<ReturnType<JWordCollabHistoryService['createPreview']>>

  try {
    preview = await options.historyService.createPreview({
      documentId: body.documentId,
      versionId: body.versionId
    })
  } catch (error: unknown) {
    if (writeHistoryServiceError(response, requestId, options, request.headers.origin, error)) {
      return
    }

    throw error
  }

  writeJson(response, 200, {
    ...(preview.version === undefined ? {} : { version: serializeVersionRecord(preview.version) }),
    updateBase64: encodeBase64(preview.update),
    diagnostics: preview.diagnostics.map(serializeDiagnostic),
    requestId
  }, options.allowedOrigins, request.headers.origin)
}

/** 调用宿主 history 授权 hook，缺少 hook 时默认拒绝。 */
async function checkHistoryLicense(
  licenseHook: JWordCollabServerLicenseHook | undefined,
  input: Parameters<JWordCollabServerLicenseHook>[0]
) {
  if (licenseHook === undefined) {
    return {
      ok: false,
      diagnosticCode: licenseHookRequiredDiagnosticCode
    }
  }

  return licenseHook(input)
}

/** 从 URL 或 header 读取授权所需 metadata，不读取请求体。 */
function readLicenseMetadata(request: IncomingMessage, url: URL): LicenseMetadata | null {
  const documentId = readString(url.searchParams.get('documentId') ?? request.headers['x-jword-document-id'])
  const tenantId = readOptionalString(url.searchParams.get('tenantId') ?? request.headers['x-jword-tenant-id'])
  const entitlement = readEntitlementMetadata(request, url)

  return documentId === null
    ? null
    : {
        documentId,
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(entitlement === undefined ? {} : { entitlement })
      }
}

/** 从 URL 或 header 读取 history preview 授权所需 metadata。 */
function readHistoryPreviewLicenseMetadata(request: IncomingMessage, url: URL): HistoryPreviewLicenseMetadata | null {
  const metadata = readLicenseMetadata(request, url)
  const versionId = readString(url.searchParams.get('versionId') ?? request.headers['x-jword-version-id'])

  return metadata === null || versionId === null
    ? null
    : {
        ...metadata,
        versionId
      }
}

/** 校验 history 版本写入请求体。 */
function readRecordHistoryVersionRequest(value: unknown): RecordHistoryVersionRequest | null {
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
    createdAt: readOptionalString(value.createdAt),
    tenantId: readOptionalString(value.tenantId),
    entitlement: readOptionalEntitlement(value.entitlement)
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
        ...(request.createdAt === undefined ? {} : { createdAt: request.createdAt }),
        ...(request.tenantId === undefined ? {} : { tenantId: request.tenantId }),
        ...(request.entitlement === undefined ? {} : { entitlement: request.entitlement })
      }
}

/** 校验 history 版本查找请求体。 */
function readHistoryVersionLookupRequest(value: unknown): HistoryVersionLookupRequest | null {
  if (!isRecord(value)) {
    return null
  }

  const documentId = readString(value.documentId)
  const versionId = readString(value.versionId)
  const tenantId = readOptionalString(value.tenantId)
  const entitlement = readOptionalEntitlement(value.entitlement)

  return documentId === null || versionId === null
    ? null
    : {
        documentId,
        versionId,
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(entitlement === undefined ? {} : { entitlement })
      }
}

/** 序列化版本元数据，避免 JSON 直接展开 Uint8Array。 */
function serializeVersionRecord(version: JWordVersionRecord): object {
  return {
    ...version,
    ...(version.stateVector === undefined ? {} : { stateVectorBase64: encodeBase64(version.stateVector) }),
    stateVector: undefined
  }
}

/** 序列化 snapshot 元数据，避免 JSON 直接展开 Uint8Array。 */
function serializeSnapshotRecord(snapshot: JWordSnapshotRecord): object {
  return {
    ...snapshot,
    stateUpdateBase64: encodeBase64(snapshot.stateUpdate),
    stateVectorBase64: encodeBase64(snapshot.stateVector),
    stateUpdate: undefined,
    stateVector: undefined
  }
}

/** 序列化 persistence 诊断。 */
function serializeDiagnostic(diagnostic: JWordPersistenceDiagnostic): object {
  return {
    ...diagnostic
  }
}

/** 校验请求体 tenantId 与授权 metadata 一致。 */
function isTenantMetadataMatched(
  bodyTenantId: string | undefined,
  metadataTenantId: string | undefined
): boolean {
  return bodyTenantId === undefined || bodyTenantId === metadataTenantId
}

/** 将 history service 的稳定业务错误写成 HTTP JSON 响应。 */
function writeHistoryServiceError(
  response: ServerResponse,
  requestId: string,
  options: HandleJWordHistoryRequestOptions,
  requestOrigin: string | undefined,
  error: unknown
): boolean {
  if (!isJWordCollabHistoryLockQueueExceededError(error)) {
    return false
  }

  writeJson(response, 429, {
    ok: false,
    diagnosticCode: error.diagnosticCode,
    requestId
  }, options.allowedOrigins, requestOrigin)

  return true
}
