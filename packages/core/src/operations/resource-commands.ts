/**
 * 职责：构造资源写入与删除命令。
 * 边界：只生成 resource operation，不执行事务、不读取 DOM 或外部资源。
 * 协作模块：图片命令、docx/pdf/native 互通层和 editor facade 通过事务流水线消费资源命令。
 * 性能/安全约束：写入前执行资源 URL allowlist 校验，保持命令 JSON 兼容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { isAllowedResourceUrl } from '../resources/types'
import type { Resource, ResourceUrlPolicy } from '../resources/types'
import { createJWordError } from '../shared/errors'
import type { Command } from './transaction'

/**
 * 构造资源写入命令。
 */
export function buildUpsertResourceCommand(resource: Resource): Command {
  return buildUpsertResourceCommandWithPolicy(resource)
}

export function buildUpsertResourceCommandWithPolicy(
  resource: Resource,
  policy?: ResourceUrlPolicy
): Command {
  if (!isAllowedResourceUrl(resource.source.url, policy)) {
    throw createJWordError('OPERATION_RESOURCE_URL_DISALLOWED', '资源 URL 不在 allowlist 内', {
      resourceId: resource.id,
      url: resource.source.url
    })
  }

  return {
    name: 'upsertResource',
    operations: [{
      kind: 'upsertResource',
      resource
    }]
  }
}

/**
 * 构造资源删除命令。
 */
export function buildDeleteResourceCommand(resourceId: string): Command {
  return {
    name: 'deleteResource',
    operations: [{
      kind: 'deleteResource',
      resourceId
    }]
  }
}
