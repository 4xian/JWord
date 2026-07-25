/**
 * 职责：应用资源类 operation 到 Y.Doc 文档资源索引。
 * 边界：只处理资源记录的增删和 document.resourceIds 同步，不处理图片 run 或外部下载。
 * 协作模块：operation-adapter 负责分发，document-store 负责资源记录结构。
 * 性能/安全约束：只接受资源 URL 策略校验通过的输入，不访问 DOM 和网络。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  DOCUMENT_STORE_FIELDS,
  createResourceRecord
} from '../model/document-store'
import { isAllowedResourceUrl } from '../resources/types'
import { createJWordError } from '../shared/errors'
import type { DocumentStore, ResourceId } from '../model/document-store'
import type { ResourceUrlPolicy } from '../resources/types'
import type { Operation } from './transaction'
import {
  appendIdIfMissing,
  readRequiredArray,
  removeId
} from './operation-record-utils'

/** 写入或替换资源记录，并同步 document 资源索引。 */
export function upsertResource(
  store: DocumentStore,
  resource: Extract<Operation, { kind: 'upsertResource' }>['resource'],
  resourceUrlPolicy?: ResourceUrlPolicy
): void {
  if (!isAllowedResourceUrl(resource.source.url, resourceUrlPolicy)) {
    throw createJWordError('OPERATION_RESOURCE_URL_DISALLOWED', '资源 URL 不在 allowlist 内', {
      resourceId: resource.id,
      url: resource.source.url
    })
  }

  store.resources.set(resource.id as ResourceId, createResourceRecord(resource))
  appendIdIfMissing(
    readRequiredArray<ResourceId>(store.document, DOCUMENT_STORE_FIELDS.document.resourceIds, 'document resourceIds'),
    resource.id as ResourceId
  )
}

/** 删除资源记录，并从 document 资源索引移除对应 ID。 */
export function deleteResource(store: DocumentStore, resourceId: string): void {
  store.resources.delete(resourceId as ResourceId)
  removeId(
    readRequiredArray<ResourceId>(store.document, DOCUMENT_STORE_FIELDS.document.resourceIds, 'document resourceIds'),
    resourceId as ResourceId
  )
}
