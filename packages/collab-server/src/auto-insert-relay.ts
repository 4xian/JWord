/**
 * 职责：处理正式协同服务端的自动插入 relay 授权入口。
 * 边界：只校验 relay 请求体和 automation.autoInsert 授权，不执行 AI 生成、不写入文档、不访问 history storage。
 * 协作模块：index.ts 路由到本模块；packages/license 提供 Gate 6 autoInsert feature key。
 * 性能/安全约束：未授权时不接受 chunk；响应只返回 relay 元数据，不回显用户文档内容或完整 chunk。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-633。
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
  JWordCollabServerLicenseHook,
  JWordCollabServerTenantHook
} from './index.js'
import {
  checkJWordCollabTenant
} from './request-guards.js'
import {
  isRecord,
  readEntitlementMetadata,
  readJsonBody,
  readOptionalEntitlement,
  readOptionalString,
  readString,
  writeJson
} from './http-utils.js'

export interface HandleJWordAutoInsertRelayRequestOptions {
  readonly licenseHook?: JWordCollabServerLicenseHook
  readonly tenantHook?: JWordCollabServerTenantHook
  readonly maxPayloadBytes: number
  readonly allowedOrigins?: readonly string[]
}

interface AutoInsertRelayRequest {
  readonly documentId: string
  readonly requestId: string
  readonly actorId: string
  readonly chunkText: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

interface AutoInsertRelayLicenseMetadata {
  readonly documentId: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

const licenseHookRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
const licenseMetadataRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_METADATA_REQUIRED'

/** 处理自动插入 relay 请求，先校验服务端授权再接受 chunk。 */
export async function handleJWordAutoInsertRelayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  options: HandleJWordAutoInsertRelayRequestOptions
): Promise<void> {
  const metadata = readAutoInsertRelayLicenseMetadata(request, new URL(request.url ?? '/', 'http://127.0.0.1'))

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

  const license = await checkLicense(options.licenseHook, metadata)

  if (!license.ok) {
    writeJson(response, 403, {
      ok: false,
      diagnosticCode: license.diagnosticCode,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const body = readAutoInsertRelayRequest(await readJsonBody(request, options.maxPayloadBytes))

  if (body === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_AUTO_INSERT_RELAY_PAYLOAD_INVALID',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (body.documentId !== metadata.documentId) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_AUTO_INSERT_RELAY_METADATA_MISMATCH',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  writeJson(response, 200, {
    ok: true,
    documentId: body.documentId,
    requestId: body.requestId,
    actorId: body.actorId,
    chunkLength: [...body.chunkText].length
  }, options.allowedOrigins, request.headers.origin)
}

/** 调用宿主授权 hook，缺少 hook 时默认拒绝付费 relay。 */
async function checkLicense(
  licenseHook: JWordCollabServerLicenseHook | undefined,
  metadata: AutoInsertRelayLicenseMetadata
) {
  if (licenseHook === undefined) {
    return {
      ok: false,
      diagnosticCode: licenseHookRequiredDiagnosticCode
    }
  }

  return licenseHook({
    documentId: metadata.documentId,
    feature: GATE6_COLLAB_FEATURES.autoInsert,
    ...(metadata.tenantId === undefined ? {} : { tenantId: metadata.tenantId }),
    ...(metadata.entitlement === undefined ? {} : { entitlement: metadata.entitlement })
  })
}

/** 从 URL 或 header 读取 relay 授权 metadata，不读取 chunk body。 */
function readAutoInsertRelayLicenseMetadata(
  request: IncomingMessage,
  url: URL
): AutoInsertRelayLicenseMetadata | null {
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

/** 校验自动插入 relay 请求体。 */
function readAutoInsertRelayRequest(value: unknown): AutoInsertRelayRequest | null {
  if (!isRecord(value)) {
    return null
  }

  const documentId = readString(value.documentId)
  const requestId = readString(value.requestId)
  const actorId = readString(value.actorId)
  const chunkText = readString(value.chunkText)
  const tenantId = readOptionalString(value.tenantId)
  const entitlement = readOptionalEntitlement(value.entitlement)

  return documentId === null || requestId === null || actorId === null || chunkText === null
    ? null
    : {
        documentId,
        requestId,
        actorId,
        chunkText,
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(entitlement === undefined ? {} : { entitlement })
      }
}
