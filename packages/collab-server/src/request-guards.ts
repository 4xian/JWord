/**
 * 职责：提供正式协同服务端 HTTP auth、tenant hook 和受保护路由判断。
 * 边界：只调用宿主注入 hook 并归一默认拒绝策略，不读取请求体、不访问 history storage。
 * 协作模块：index.ts 和 auto-insert-relay.ts 在进入 license/storage/relay 前复用这里的守卫。
 * 性能/安全约束：hook 拒绝时调用方必须立即停止后续 license、storage 或 relay 操作。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  JWordCollabServerAuthHook,
  JWordCollabServerAuthHookResult,
  JWordCollabServerTenantHook,
  JWordCollabServerTenantHookResult
} from './index.js'

const authHookRequiredDiagnosticCode = 'JWORD_COLLAB_AUTH_HOOK_REQUIRED'

/** 调用宿主请求认证 hook，缺少 hook 时默认拒绝受保护 HTTP 路由。 */
export async function checkJWordCollabRequestAuth(
  authHook: JWordCollabServerAuthHook | undefined,
  requestId: string,
  method: string,
  path: string
): Promise<JWordCollabServerAuthHookResult> {
  if (authHook === undefined) {
    return {
      ok: false,
      diagnosticCode: authHookRequiredDiagnosticCode
    }
  }

  return authHook({
    requestId,
    method,
    path
  })
}

/** 调用宿主 tenant hook，默认放行本地开发路径。 */
export async function checkJWordCollabTenant(
  tenantHook: JWordCollabServerTenantHook | undefined,
  requestId: string,
  documentId: string,
  tenantId?: string
): Promise<JWordCollabServerTenantHookResult> {
  if (tenantHook === undefined) {
    return {
      ok: true
    }
  }

  return tenantHook({
    requestId,
    documentId,
    ...(tenantId === undefined ? {} : { tenantId })
  })
}

/** 判断请求是否需要先经过宿主 auth hook。 */
export function shouldAuthorizeJWordCollabRequest(method: string, pathname: string): boolean {
  return (method === 'POST' && (
    pathname === '/license/status' ||
    pathname === '/auto-insert/relay' ||
    isHistoryVersionsPath(pathname) ||
    isHistoryPreviewPath(pathname)
  )) || (method === 'GET' && isHistoryVersionsPath(pathname))
}

/** 判断请求是否是 history 版本列表或写入路径。 */
function isHistoryVersionsPath(pathname: string): boolean {
  return pathname === '/history/versions' || pathname === '/jword-history/versions'
}

/** 判断请求是否是 history 预览路径。 */
function isHistoryPreviewPath(pathname: string): boolean {
  return pathname === '/history/preview' || pathname === '/jword-history/preview'
}
