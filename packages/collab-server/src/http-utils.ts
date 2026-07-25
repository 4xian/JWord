/**
 * 职责：提供正式协同服务端 HTTP JSON、CORS、payload 和 metadata 解析基础工具。
 * 边界：不路由业务请求、不调用授权 hook、不访问 history storage。
 * 协作模块：index.ts、history-routes.ts 和 auto-insert-relay.ts 共享这些无状态 helper。
 * 性能/安全约束：body 读取统一限制最大字节数；授权 metadata 可从 URL/header 读取而不消费 body。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  IncomingMessage,
  ServerResponse
} from 'node:http'
import type {
  JWordLicenseEntitlement
} from '@4xian/jword-license'

/** 写出 JSON HTTP 响应。 */
export function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  allowedOrigins?: readonly string[],
  requestOrigin?: string
): void {
  applyCorsHeaders(response, allowedOrigins, requestOrigin)
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(body)}\n`)
}

/** 读取 JSON 请求体并限制最大 payload。 */
export async function readJsonBody(request: IncomingMessage, maxPayloadBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let byteLength = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    byteLength += buffer.byteLength
    if (byteLength > maxPayloadBytes) {
      throw new Error('JWORD_COLLAB_SERVER_PAYLOAD_TOO_LARGE')
    }
    chunks.push(buffer)
  }

  return chunks.length === 0
    ? {}
    : JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 从 URL 或 header 读取可选 entitlement metadata。 */
export function readEntitlementMetadata(
  request: IncomingMessage,
  url: URL
): JWordLicenseEntitlement | null | undefined {
  const rawValue = url.searchParams.get('entitlement') ?? request.headers['x-jword-entitlement']

  if (rawValue === null || rawValue === undefined) {
    return undefined
  }

  const rawString = Array.isArray(rawValue) ? rawValue[0] : rawValue

  if (rawString === undefined || rawString.trim() === '') {
    return undefined
  }

  try {
    return readOptionalEntitlement(JSON.parse(rawString) as unknown)
  } catch {
    return undefined
  }
}

/** 判断未知值是否是普通记录。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取必填字符串。 */
export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 读取可选字符串。 */
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** 读取可选授权对象。 */
export function readOptionalEntitlement(value: unknown): JWordLicenseEntitlement | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  if (!isRecord(value) || typeof value.customerId !== 'string' || typeof value.licenseToken !== 'string') {
    return undefined
  }

  return Array.isArray(value.features)
    ? {
        customerId: value.customerId,
        licenseToken: value.licenseToken,
        features: value.features.filter((feature): feature is string => typeof feature === 'string'),
        ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
        ...(typeof value.offlineGraceUntil === 'string' ? { offlineGraceUntil: value.offlineGraceUntil } : {}),
        ...(value.status === 'server-unavailable' || value.status === 'valid' ? { status: value.status } : {})
      }
    : undefined
}

/** 编码二进制字段。 */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** 解码二进制字段。 */
export function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** 判断请求是否是 history 版本列表或写入路径。 */
export function isHistoryVersionsPath(pathname: string): boolean {
  return pathname === '/history/versions' || pathname === '/jword-history/versions'
}

/** 判断请求是否是 history 预览路径。 */
export function isHistoryPreviewPath(pathname: string): boolean {
  return pathname === '/history/preview' || pathname === '/jword-history/preview'
}

/** 根据 origin 和 allowlist 写入 CORS header。 */
function applyCorsHeaders(
  response: ServerResponse,
  allowedOrigins?: readonly string[],
  requestOrigin?: string
): void {
  const allowOrigin = readAllowedOrigin(allowedOrigins, requestOrigin)

  if (allowOrigin !== undefined) {
    response.setHeader('access-control-allow-origin', allowOrigin)
  }
  response.setHeader(
    'access-control-allow-headers',
    'content-type,authorization,x-jword-document-id,x-jword-tenant-id,x-jword-version-id,x-jword-entitlement'
  )
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
}

/** 读取当前请求可返回的 CORS origin。 */
function readAllowedOrigin(
  allowedOrigins?: readonly string[],
  requestOrigin?: string
): string | undefined {
  if (allowedOrigins === undefined || allowedOrigins.length === 0) {
    return '*'
  }

  return requestOrigin !== undefined && allowedOrigins.includes(requestOrigin) ? requestOrigin : undefined
}
