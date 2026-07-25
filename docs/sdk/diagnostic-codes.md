<!-- 由 tools/diagnostics/generate-diagnostics-artifacts.mjs 生成，请勿直接编辑。 -->

# JWord Diagnostic Codes

Source: `fixtures/collab/diagnostics-registry.json`  
Schema version: 1  
Code count: 192

| Code | Owner | Severity | Recoverable | Fallback | Domains | Description |
|---|---|---|---|---|---|---|
| `COLLAB_PROVIDER_UNAVAILABLE` | provider | error | yes | queue-local-operations | network | Provider is unavailable and local operations must be queued until reconnect. |
| `COLLAB_USER_IDENTITY_REQUIRED` | provider | error | yes | block-room-connection | authorization, presence | Collaboration user id or name is missing and the provider connection must be blocked. |
| `COLLAB_PROVIDER_AUTH_FAILED` | provider | error | no | block-room-connection | authorization, auth-hook, network | Provider authentication failed and the room connection must be blocked. |
| `COLLAB_UPDATE_REJECTED` | provider | error | yes | keep-local-update-pending | network | Provider rejected a local update and the client must preserve it as pending. |
| `COLLAB_PERMISSION_DENIED` | provider | error | yes | keep-local-update-pending | authorization, server | Provider denied write permission for a read/comment-only collaboration connection. |
| `COLLAB_PROVIDER_NOT_CONNECTED` | provider | error | yes | wait-for-provider-reconnect | network | Provider was asked to send an update before it reached a connected state. |
| `COLLAB_PROVIDER_SEND_FAILED` | provider | warning | yes | keep-local-update-pending | network, offline | Provider failed to publish a local update and the client must keep the update pending. |
| `COLLAB_UPDATE_METADATA_MISMATCH` | provider | error | no | reject-update-without-broadcast | network | Update metadata does not match the provider document, room or client identity. |
| `COLLAB_PROVIDER_DESTROYED` | provider | error | no | create-new-provider | network | Provider was used after destroy and must not accept more updates or presence changes. |
| `COLLAB_SERVER_UNAVAILABLE` | network | error | yes | keep-single-user-editing | network, version, server | Client could not read the collaboration server version endpoint before connecting. |
| `COLLAB_VERSION_MISMATCH` | version | error | yes | keep-single-user-editing | version, server | Server version payload is invalid and the provider must not connect. |
| `COLLAB_PROTOCOL_MISMATCH` | version | error | yes | keep-single-user-editing | version, server | Client and server collaboration protocol versions are incompatible. |
| `COLLAB_SERVER_TOO_OLD` | version | error | yes | keep-single-user-editing | version, server | Server package version is below the client minimum server requirement. |
| `COLLAB_CLIENT_TOO_OLD` | version | error | yes | keep-single-user-editing | version, server | Client package version is below the server minimum client requirement. |
| `COLLAB_FEATURE_FLAGS_MISSING` | version | error | yes | keep-single-user-editing | version, server | Server did not advertise a feature required by the client. |
| `COLLAB_AWARENESS_STALE` | awareness | warning | yes | hide-stale-remote-presence | presence | Remote cursor or selection awareness is stale and should not be rendered as live. |
| `COLLAB_AWARENESS_INVALID` | awareness | error | no | drop-invalid-presence-payload | presence | Awareness payload parsed as JSON but does not match the public presence schema. |
| `COLLAB_AWARENESS_PARSE_FAILED` | awareness | error | no | drop-invalid-presence-payload | presence | Awareness payload is not valid JSON and cannot be used for presence. |
| `COLLAB_AWARENESS_ANCHOR_UNRESOLVED` | awareness | warning | yes | render-presence-without-selection | presence | Remote cursor or selection awareness references an unresolved range and should be downgraded to presence only. |
| `OFFLINE_CACHE_SYNCED` | offline | info | yes | use-y-indexeddb-cache | offline, storage | IndexedDB offline cache is synced with the local Y.Doc. |
| `OFFLINE_CACHE_UNAVAILABLE` | offline | warning | yes | continue-online-without-cache | offline, storage | IndexedDB offline cache is unavailable, but online collaboration may continue. |
| `OFFLINE_LOCAL_UPDATE_QUEUED` | offline | info | yes | preserve-local-yjs-update | offline | A local update was preserved while the provider was disconnected. |
| `OFFLINE_RECONNECT_STARTED` | offline | info | yes | keep-local-updates-pending | offline, network | Provider reconnect started with local offline updates still pending. |
| `OFFLINE_RECONNECT_SYNCED` | offline | info | yes | clear-local-pending-count | offline, network | Pending local offline updates were synced after reconnect. |
| `OFFLINE_RECONNECT_CONFLICT_MERGED` | offline | warning | yes | merge-yjs-conflict | offline, network | Local offline updates and remote updates were merged during reconnect. |
| `OFFLINE_RECONNECT_FAILED` | offline | error | yes | keep-local-updates-pending | offline, network | Provider reconnect failed and local offline updates remain pending. |
| `COLLAB_SNAPSHOT_STALE` | snapshot | warning | yes | request-fresh-snapshot | history, storage | Snapshot metadata is older than the current update log and should be refreshed. |
| `COLLAB_SNAPSHOT_MISSING` | snapshot | warning | yes | rebuild-from-update-log | history, storage | Snapshot metadata references a missing snapshot and the version must be rebuilt from the update log. |
| `COLLAB_HISTORY_ORIGIN_SKIPPED` | history | info | yes | skip-nonlocal-origin-in-undo | history | Undo skipped remote or AI origins that are outside the local user scope. |
| `COLLAB_HISTORY_SERVER_FALLBACK` | history | warning | yes | use-local-history-memory | history, server | Client could not use server-backed history and fell back to in-memory history. |
| `COLLAB_AUTH_DENIED` | server | error | no | reject-protected-request | authorization, auth-hook, server | Server auth hook denied a protected HTTP request before license or storage access. |
| `JWORD_COLLAB_AUTH_HOOK_REQUIRED` | server | error | no | configure-server-auth-hook | authorization, auth-hook, server | Self-host Hocuspocus server refused a room connection because no auth hook was configured. |
| `COLLAB_TENANT_DENIED` | server | error | no | reject-tenant-scoped-request | authorization, tenant-hook, server | Server tenant hook denied document access before license, storage or relay work. |
| `JWORD_COLLAB_HISTORY_STORAGE_MISSING` | storage | error | yes | disable-server-history-api | history, storage, server | Self-host server has no history storage service for the requested history operation. |
| `JWORD_COLLAB_HISTORY_DOCUMENT_ID_REQUIRED` | history | error | yes | ask-client-to-resend-document-id | history, payload-limit, server | History list request is missing a document id. |
| `JWORD_COLLAB_HISTORY_RECORD_PAYLOAD_INVALID` | history | error | yes | reject-invalid-history-record | history, payload-limit, server | History record payload is invalid and must not be written to storage. |
| `JWORD_COLLAB_HISTORY_PREVIEW_PAYLOAD_INVALID` | history | error | yes | reject-invalid-history-preview | history, payload-limit, server | History preview payload is invalid and must not read storage. |
| `JWORD_COLLAB_HISTORY_METADATA_MISMATCH` | history | error | yes | reject-history-body-metadata-mismatch | history, payload-limit, server | History body metadata does not match URL or header metadata and must be rejected. |
| `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED` | history | error | yes | reject-history-operation-with-backpressure | history, server | History document lock queue exceeded the configured depth and the request must be retried later. |
| `COLLAB_AUTO_INSERTER_ANCHOR_REBASED` | auto-inserter | warning | yes | rebase-inserter-anchor | auto-insert | AI insertion anchor was rebased after concurrent local or remote edits. |
| `COLLAB_AUTO_INSERTER_ANCHOR_UNRESOLVED` | auto-inserter | error | yes | stop-pending-ai-flush | auto-insert | AI insertion anchor became unresolved and pending AI text must stop flushing. |
| `COLLAB_AUTO_INSERTER_RANGE_REQUIRED` | auto-inserter | error | no | reject-replace-without-range | auto-insert | Replace mode requires a stable range before auto-insert text can flush. |
| `COLLAB_AUTO_INSERTER_ANCHOR_REQUIRED` | auto-inserter | error | no | reject-insert-without-anchor | auto-insert | Insert or append mode requires a stable anchor before auto-insert text can flush. |
| `COLLAB_AUTO_INSERTER_FLUSH_FAILED` | auto-inserter | error | no | stop-current-auto-insert-session | auto-insert | Auto-insert flush failed for a non-recoverable editor or transaction error. |
| `COLLAB_AUTO_INSERTER_POSITION_REQUIRED` | auto-inserter | error | yes | request-explicit-auto-insert-position | auto-insert | Collaboration auto-insert session was started without a public position or range. |
| `COLLAB_AUTO_INSERTER_ABORTED` | auto-inserter | info | yes | keep-current-document-and-drop-pending-ai-text | auto-insert | AI insertion was aborted and pending AI text must not be flushed. |
| `COLLAB_AUTO_INSERTER_RETRY_STARTED` | auto-inserter | info | yes | retry-auto-inserter-from-stable-anchor | auto-insert | AI insertion retry started after a recoverable inserter failure. |
| `JWORD_COLLAB_AUTO_INSERT_RELAY_PAYLOAD_INVALID` | auto-inserter | error | yes | reject-invalid-auto-insert-relay | auto-insert, payload-limit, server | Server auto-insert relay payload is invalid and must not accept the chunk. |
| `JWORD_COLLAB_AUTO_INSERT_RELAY_METADATA_MISMATCH` | auto-inserter | error | yes | reject-auto-insert-body-metadata-mismatch | auto-insert, payload-limit, server | Auto-insert relay body metadata does not match URL or header metadata and must be rejected. |
| `COLLAB_RESTORE_CONFLICT_RESOLVED` | restore | warning | yes | restore-local-snapshot-with-conflict-note | history | Version restore met newer collaborative edits and resolved them through restore policy. |
| `JWORD_COLLAB_LICENSE_HOOK_REQUIRED` | server | error | no | configure-server-license-hook | authorization, server | Self-host server refused a paid endpoint because no license hook was configured. |
| `JWORD_COLLAB_LICENSE_METADATA_REQUIRED` | server | error | yes | resend-license-metadata-in-url-or-header | authorization, payload-limit, server | Paid endpoint metadata was missing from URL or headers and request body was not consumed. |
| `JWORD_COLLAB_LICENSE_STATUS_PAYLOAD_INVALID` | server | error | yes | reject-invalid-license-status-request | authorization, payload-limit, server | License status HTTP payload is invalid and must not call the license hook. |
| `JWORD_COLLAB_SERVER_RATE_LIMITED` | server | error | yes | retry-after-rate-limit-window | rate-limit, server | Self-host server rate limit rejected a request for the configured window. |
| `JWORD_COLLAB_SERVER_PAYLOAD_TOO_LARGE` | server | error | yes | resend-smaller-request-payload | payload-limit, server | HTTP request body exceeded the configured collaboration server payload limit. |
| `JWORD_COLLAB_SERVER_INTERNAL_ERROR` | server | error | yes | surface-request-id-for-support | server | Self-host server caught an unexpected request handling error. |
| `JWORD_COLLAB_SERVER_NOT_FOUND` | server | error | yes | check-self-host-route | server | Self-host server did not recognize the requested route. |
| `PERSISTENCE_INDEXEDDB_UNAVAILABLE` | storage | warning | yes | continue-online-without-offline-cache | offline, storage | Current runtime cannot use IndexedDB for offline cache. |
| `PERSISTENCE_VERSION_NOT_FOUND` | storage | warning | yes | keep-current-document | history, storage | Requested history version does not exist or has already been removed. |
| `PERSISTENCE_SNAPSHOT_NOT_FOUND` | storage | warning | yes | rebuild-from-update-log | history, storage | Requested snapshot is missing or its storage index is damaged. |
| `PERSISTENCE_VERSION_COMPACTED` | storage | error | no | keep-current-document | history, storage | Requested version is older than the compaction boundary and cannot be restored. |
| `PERSISTENCE_RESTORE_FAILED` | storage | error | no | keep-current-document | history, storage | Version restore failed while building an isolated document and the current document was not written. |
| `PERSISTENCE_RESTORE_RECOVERY_REQUIRED` | storage | error | yes | retry-restore-recovery | history, storage | Version restore has a pending operation that must be retried to finalize or repair recovery. |
| `CANVAS_POOL_DISPOSED` | core | error | no | reject-canvas-pool-use | canvas, core | Canvas runtime rejects invalid canvas pool usage with CANVAS_POOL_DISPOSED. |
| `DOCUMENT_STORE_ARRAY_CONTAINER_MISSING` | core | error | no | reject-invalid-store-access | core, document-store | Document store rejects invalid container access with DOCUMENT_STORE_ARRAY_CONTAINER_MISSING. |
| `DOCUMENT_STORE_TEXT_CONTAINER_MISSING` | core | error | no | reject-invalid-store-access | core, document-store | Document store rejects invalid container access with DOCUMENT_STORE_TEXT_CONTAINER_MISSING. |
| `EDITOR_ALREADY_MOUNTED` | core | error | no | reject-editor-operation | core, editor | Core editor runtime rejects an invalid editor operation with EDITOR_ALREADY_MOUNTED. |
| `EDITOR_ANCHOR_TARGET_NOT_FOUND` | core | error | no | reject-editor-operation | core, editor | Core editor runtime rejects an invalid editor operation with EDITOR_ANCHOR_TARGET_NOT_FOUND. |
| `EDITOR_DESTROYED` | core | error | no | reject-editor-operation | core, editor | Core editor runtime rejects an invalid editor operation with EDITOR_DESTROYED. |
| `EDITOR_INPUT_HANDLER_FAILED` | core | error | yes | emit-editor-error-and-continue-input | core, editor | Core input runtime caught an input handler error and kept the editor recoverable. |
| `EDITOR_POINTER_PAGE_MISSING` | core | error | no | reject-editor-operation | core, editor | Core editor runtime rejects an invalid editor operation with EDITOR_POINTER_PAGE_MISSING. |
| `OPERATION_ANCHOR_UNRESOLVED` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_ANCHOR_UNRESOLVED. |
| `OPERATION_BLOCK_KIND_MISMATCH` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_BLOCK_KIND_MISMATCH. |
| `OPERATION_BLOCK_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_BLOCK_NOT_FOUND. |
| `OPERATION_COMMENT_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_COMMENT_NOT_FOUND. |
| `OPERATION_DELETE_RANGE_CROSS_RUN` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_DELETE_RANGE_CROSS_RUN. |
| `OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER` | core | error | yes | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER. |
| `OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION` | core | error | yes | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION. |
| `OPERATION_FIXTURE_SCHEMA_UNSUPPORTED` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_FIXTURE_SCHEMA_UNSUPPORTED. |
| `OPERATION_IMAGE_DIMENSIONS_INVALID` | core | error | no | reject-operation-and-keep-document | core, operation, resource | Operation adapter rejects an invalid operation with OPERATION_IMAGE_DIMENSIONS_INVALID. |
| `OPERATION_IMAGE_TARGET_INVALID` | core | error | no | reject-operation-and-keep-document | core, operation, resource | Operation adapter rejects an invalid operation with OPERATION_IMAGE_TARGET_INVALID. |
| `OPERATION_INSERT_BLOCK_REFERENCE_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_INSERT_BLOCK_REFERENCE_NOT_FOUND. |
| `OPERATION_KIND_UNKNOWN` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_KIND_UNKNOWN. |
| `OPERATION_LINK_URL_DISALLOWED` | core | error | yes | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_LINK_URL_DISALLOWED. |
| `OPERATION_MERGE_BLOCK_NOT_ADJACENT` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_MERGE_BLOCK_NOT_ADJACENT. |
| `OPERATION_PROPERTY_CONTAINER_MISSING` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_PROPERTY_CONTAINER_MISSING. |
| `OPERATION_PROPERTY_VALUE_INVALID` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_PROPERTY_VALUE_INVALID. |
| `OPERATION_RESOURCE_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_RESOURCE_NOT_FOUND. |
| `OPERATION_RESOURCE_URL_DISALLOWED` | core | error | yes | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_RESOURCE_URL_DISALLOWED. |
| `OPERATION_REVISION_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_REVISION_NOT_FOUND. |
| `OPERATION_RUN_FORMAT_RANGE_INVALID` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_RUN_FORMAT_RANGE_INVALID. |
| `OPERATION_RUN_ID_DUPLICATE` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_RUN_ID_DUPLICATE. |
| `OPERATION_RUN_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_RUN_NOT_FOUND. |
| `OPERATION_RUN_NOT_IN_BLOCK` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_RUN_NOT_IN_BLOCK. |
| `OPERATION_SECTION_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_SECTION_NOT_FOUND. |
| `OPERATION_STRING_FIELD_MISSING` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_STRING_FIELD_MISSING. |
| `OPERATION_TABLE_CELL_NOT_FOUND` | core | error | no | reject-operation-and-keep-document | core, import, operation | Operation adapter rejects an invalid operation with OPERATION_TABLE_CELL_NOT_FOUND. |
| `OPERATION_TEXT_INDEX_OUT_OF_BOUNDS` | core | error | no | reject-operation-and-keep-document | core, operation | Operation adapter rejects an invalid operation with OPERATION_TEXT_INDEX_OUT_OF_BOUNDS. |
| `PLUGIN_CALLBACK_FAILED` | core | warning | yes | isolate-plugin-callback | core, plugin | Core plugin host emits PLUGIN_CALLBACK_FAILED for plugin isolation and command diagnostics. |
| `PLUGIN_ADAPTER_DUPLICATE` | core | warning | yes | use-first-registered-adapter | core, plugin, adapter | Core plugin host detected more than one adapter for the same slot and will use the first registered adapter. |
| `PLUGIN_ADAPTER_FAILED` | core | warning | yes | isolate-plugin-adapter | core, plugin, adapter | Core plugin host isolated a plugin adapter failure without corrupting editor state. |
| `PLUGIN_ADAPTER_UNAVAILABLE` | core | warning | yes | skip-adapter-dependent-action | core, plugin, adapter | Core plugin host could not resolve a requested adapter from the plugin registry. |
| `PLUGIN_IMPORT_REJECTED` | core | warning | yes | keep-document-unchanged | core, plugin, adapter, import | Plugin import adapter rejected an import request and the current document remains unchanged. |
| `PLUGIN_EXPORT_REJECTED` | core | warning | yes | return-export-error-without-download | core, plugin, adapter, export | Plugin export adapter rejected an export request and no browser download is triggered by core. |
| `PLUGIN_COLLAB_PROVIDER_REJECTED` | core | warning | yes | block-provider-attachment | core, plugin, adapter, collaboration | Plugin collaboration provider adapter rejected provider creation or attachment without exposing provider internals. |
| `PLUGIN_COMMAND_DUPLICATE` | core | error | no | reject-duplicate-plugin-registration | core, plugin | Core plugin host emits PLUGIN_COMMAND_DUPLICATE for plugin isolation and command diagnostics. |
| `PLUGIN_COMMAND_NOT_FOUND` | core | error | yes | ignore-missing-plugin-command | core, plugin | Core plugin host emits PLUGIN_COMMAND_NOT_FOUND for plugin isolation and command diagnostics. |
| `PLUGIN_COMMAND_REJECTED` | core | warning | yes | reject-plugin-command-with-diagnostic | core, plugin | Core plugin host emits PLUGIN_COMMAND_REJECTED for plugin isolation and command diagnostics. |
| `PROJECTION_INVALID_DOCUMENT` | core | error | no | reject-invalid-projection-input | core, projection | Projection creation rejects invalid document state with PROJECTION_INVALID_DOCUMENT. |
| `TRANSACTION_COMMAND_EMPTY` | core | error | no | reject-transaction-command | core, transaction | Transaction pipeline rejects an invalid command with TRANSACTION_COMMAND_EMPTY. |
| `TRANSACTION_ORIGIN_EMPTY` | core | error | no | reject-transaction-command | core, transaction | Transaction pipeline rejects an invalid command with TRANSACTION_ORIGIN_EMPTY. |
| `DOCX_COMMENTS_EXPORT_UNSUPPORTED` | docx | warning | yes | omit-comments | docx, export, format-interop, import | DOCX 导出暂不写入批注内容。 |
| `DOCX_COMMENT_ID_MISSING` | docx | warning | yes | skip-comment | docx, format-interop, import | 发现缺少 w:id 的 DOCX 批注。 |
| `DOCX_CONTENT_TYPES_MISSING` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop | DOCX package 缺少 [Content_Types].xml。 |
| `DOCX_DRAWING_FLOATING_UNSUPPORTED` | docx | warning | yes | preserve-empty-inline | docx, format-interop | 发现暂未支持的浮动 drawing。 |
| `DOCX_ELEMENT_UNSUPPORTED` | docx | warning | yes | preserve-opaque-element | docx, format-interop, import | 发现暂未映射的 OOXML element。 |
| `DOCX_HEADER_FOOTER_EXPORT_UNSUPPORTED` | docx | warning | yes | omit-header-footer | docx, export, format-interop | DOCX 导出暂不写入页眉页脚内容。 |
| `DOCX_HYPERLINK_RELATIONSHIP_MISSING` | docx | warning | yes | preserve-hyperlink-text | docx, format-interop, import | 超链接引用的 relationship 不存在。 |
| `DOCX_HYPERLINK_UNSUPPORTED` | docx | warning | yes | preserve-hyperlink-text | docx, format-interop, import | 发现暂未支持的超链接类型。 |
| `DOCX_IMAGE_EXPORT_MIME_UNSUPPORTED` | docx | warning | yes | omit-image | docx, export, format-interop, resource | DOCX 导出暂不支持该图片 MIME。 |
| `DOCX_IMAGE_EXTERNAL_UNSUPPORTED` | docx | warning | yes | preserve-alt-text | docx, format-interop, resource | 发现暂未支持的外链图片。 |
| `DOCX_IMAGE_RELATIONSHIP_MISSING` | docx | warning | yes | omit-image | docx, format-interop, import, resource | 图片引用的 relationship 不存在。 |
| `DOCX_IMAGE_RELATIONSHIP_UNSUPPORTED` | docx | warning | yes | omit-image | docx, format-interop, import, resource | 发现暂未支持的图片 relationship 类型。 |
| `DOCX_MAIN_DOCUMENT_MISSING` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop | DOCX package 缺少主文档 part。 |
| `DOCX_NUMBERING_FORMAT_UNSUPPORTED` | docx | warning | yes | preserve-numbering-metadata | docx, format-interop, import | 发现暂未完整支持的编号格式。 |
| `DOCX_OPAQUE_PART_PRESERVE_SKIPPED` | docx | warning | yes | omit-unsafe-opaque-part | docx, format-interop | 导出时跳过编辑后不安全的 opaque part。 |
| `DOCX_OPAQUE_RELATIONSHIP_PRESERVE_SKIPPED` | docx | warning | yes | omit-unsafe-opaque-relationship | docx, format-interop, import | 导出时跳过编辑后不安全的 opaque relationship。 |
| `DOCX_PACKAGE_INVALID` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop, package | 输入不是可读取的 DOCX zip package。 |
| `DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop, package | DOCX package 超出资源安全上限。 |
| `DOCX_PAGE_NUMBERING_EXPORT_UNSUPPORTED` | docx | warning | yes | omit-page-numbering | docx, export, format-interop, import | DOCX 导出暂不写入 section 页码设置。 |
| `DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED` | docx | warning | yes | preserve-paragraph-content | docx, format-interop | 发现暂未映射的段落属性。 |
| `DOCX_PART_UNSUPPORTED` | docx | warning | yes | preserve-opaque-part | docx, format-interop | 发现暂未映射的 OPC part。 |
| `DOCX_RELATIONSHIP_TARGET_MISSING` | docx | warning | yes | preserve-relationship-metadata | docx, format-interop, import | relationship 指向的 target part 不存在。 |
| `DOCX_RELATIONSHIP_TARGET_TRAVERSAL_UNSUPPORTED` | docx | warning | yes | preserve-relationship-metadata | docx, format-interop, import | relationship target 使用多余 .. 越过 OPC package 根。 |
| `DOCX_RELATIONSHIP_UNSUPPORTED` | docx | warning | yes | preserve-opaque-relationship | docx, format-interop, import | 发现暂未映射的 OPC relationship。 |
| `DOCX_REVISIONS_EXPORT_UNSUPPORTED` | docx | warning | yes | omit-revisions | docx, export, format-interop | DOCX 导出暂不写入修订 metadata。 |
| `DOCX_REVISION_METADATA_UNSUPPORTED` | docx | warning | yes | preserve-opaque-revision | docx, format-interop | 发现暂未完整支持的修订 metadata。 |
| `DOCX_ROOT_RELS_MISSING` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop | DOCX package 缺少 root relationships part。 |
| `DOCX_RUN_PROPERTY_UNSUPPORTED` | docx | warning | yes | preserve-run-text | docx, format-interop, import | 发现暂未映射的 run 属性。 |
| `DOCX_SECTION_BREAK_UNSUPPORTED` | docx | warning | yes | treat-as-next-page | docx, format-interop, import | 发现暂未完整支持的 section break 类型。 |
| `DOCX_SECTION_COLUMNS_UNSUPPORTED` | docx | warning | yes | ignore-columns | docx, format-interop, import | 发现暂未完整支持的 section columns。 |
| `DOCX_SECTION_ORIENTATION_UNSUPPORTED` | docx | warning | yes | normalize-landscape-page-size | docx, format-interop, import | 发现暂未完整支持的 section 页面方向。 |
| `DOCX_STYLE_UNKNOWN` | docx | warning | yes | preserve-style-id | docx, format-interop, import | 引用了样式表中不存在的样式。 |
| `DOCX_TABLE_COMPLEX_MERGE_UNSUPPORTED` | docx | warning | yes | preserve-cell-text | docx, format-interop, import | 发现暂未支持的复杂表格合并。 |
| `DOCX_TABLE_NESTED_UNSUPPORTED` | docx | warning | yes | flatten-nested-table-text | docx, format-interop, import | 发现暂未支持的嵌套表格。 |
| `DOCX_TABLE_STYLE_UNSUPPORTED` | docx | warning | yes | preserve-table-text | docx, format-interop, import | 发现暂未完整支持的表格样式。 |
| `DOCX_USER_CANCELLED` | docx | error | yes | surface-diagnostic-and-continue | docx, format-interop | 用户取消当前 DOCX 任务。 |
| `DOCX_WORKER_CANCELLED` | docx | error | yes | surface-diagnostic-and-continue | docx, format-interop, worker | worker 收到取消当前 DOCX 任务的请求。 |
| `DOCX_WORKER_UNAVAILABLE` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop, worker | 当前环境缺少 DOCX worker 运行所需基础能力。 |
| `DOCX_WORKER_ERROR` | docx | error | no | surface-diagnostic-and-stop | docx, format-interop, worker | DOCX worker 捕获未知异常。 |
| `JWORD_FEATURE_NOT_ENTITLED` | license | error | yes | show-license-remediation | authorization, license | 当前授权未包含请求的高级 feature。 |
| `JWORD_LICENSE_EXPIRED` | license | error | yes | show-license-remediation | authorization, license | 商业授权已过期。 |
| `JWORD_LICENSE_HANDLE_INVALID` | license | error | yes | show-license-remediation | authorization, license | 授权 handle 无效或不属于当前 License runtime。 |
| `JWORD_LICENSE_INSECURE_FIXTURE_ACCEPTED` | license | warning | yes | accept-test-only-license-with-warning | authorization, license | 旧 FNV fixture 授权仅在显式测试开关下被接受。 |
| `JWORD_LICENSE_ISSUER_INVALID` | license | error | yes | show-license-remediation | authorization, license | JWL2 token issuer 不受当前 License runtime 信任。 |
| `JWORD_LICENSE_KEY_UNKNOWN` | license | error | yes | show-license-remediation | authorization, license | JWL2 token keyId 未在当前生产 trust set 登记。 |
| `JWORD_LICENSE_MISSING` | license | error | yes | show-license-remediation | authorization, license | 缺少商业授权 entitlement。 |
| `JWORD_LICENSE_NOT_YET_VALID` | license | error | yes | show-license-remediation | authorization, license | 授权签发时间尚未生效。 |
| `JWORD_LICENSE_SIGNATURE_INVALID` | license | error | yes | show-license-remediation | authorization, license | 商业授权签名缺失或校验失败。 |
| `JWORD_LICENSE_TOKEN_INVALID` | license | error | yes | show-license-remediation | authorization, license | JWL2 token 结构、编码、canonical claims 或期限关系无效。 |
| `JWORD_NATIVE_CHECKSUMS_INVALID` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_CHECKSUMS_INVALID for stable package diagnostics. |
| `JWORD_NATIVE_CHECKSUMS_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_CHECKSUMS_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_DOCUMENT_INVALID` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_DOCUMENT_INVALID for stable package diagnostics. |
| `JWORD_NATIVE_DOCUMENT_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_DOCUMENT_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_FORMAT_UNSUPPORTED` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_FORMAT_UNSUPPORTED for stable package diagnostics. |
| `JWORD_NATIVE_HASH_MISMATCH` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_HASH_MISMATCH for stable package diagnostics. |
| `JWORD_NATIVE_MANIFEST_INVALID` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_MANIFEST_INVALID for stable package diagnostics. |
| `JWORD_NATIVE_MANIFEST_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_MANIFEST_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_METADATA_INVALID` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_METADATA_INVALID for stable package diagnostics. |
| `JWORD_NATIVE_METADATA_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_METADATA_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_OLD_SCHEMA_MIGRATED` | native | warning | yes | load-migrated-document | native, package | Native package schema migration completed and reported a recoverable warning. |
| `JWORD_NATIVE_PACKAGE_ENTRY_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_PACKAGE_ENTRY_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_PACKAGE_INVALID` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_PACKAGE_INVALID for stable package diagnostics. |
| `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED` | native | error | no | reject-native-package-operation | native, package, payload-limit | Native package input exceeded a fixed resource or decompression budget and must be rejected. |
| `JWORD_NATIVE_READER_UNSUPPORTED` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_READER_UNSUPPORTED for stable package diagnostics. |
| `JWORD_NATIVE_RESOURCE_CHECKSUM_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_RESOURCE_CHECKSUM_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_RESOURCE_MIME_MISMATCH` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_RESOURCE_MIME_MISMATCH for stable package diagnostics. |
| `JWORD_NATIVE_RESOURCE_MISSING` | native | warning | yes | preserve-document-with-missing-resource-warning | native, package | Native package references a missing resource and preserves the document with a warning. |
| `JWORD_NATIVE_RESOURCE_REFERENCE_MISSING` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_RESOURCE_REFERENCE_MISSING for stable package diagnostics. |
| `JWORD_NATIVE_RESOURCE_UNPACKED` | native | warning | yes | load-unpacked-resource | native, package | Native package resource is stored unpacked and remains loadable with a warning. |
| `JWORD_NATIVE_SCHEMA_FUTURE` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_SCHEMA_FUTURE for stable package diagnostics. |
| `JWORD_NATIVE_SCHEMA_UNSUPPORTED` | native | error | no | reject-native-package-operation | native, package | Native package operation emits JWORD_NATIVE_SCHEMA_UNSUPPORTED for stable package diagnostics. |
| `JWORD_NATIVE_USER_CANCELLED` | native | error | yes | stop-current-request | native, package | Native package operation emits JWORD_NATIVE_USER_CANCELLED for stable package diagnostics. |
| `JWORD_NATIVE_WORKER_CANCELLED` | native | error | yes | stop-current-request | native, package, worker | Native package operation emits JWORD_NATIVE_WORKER_CANCELLED for stable package diagnostics. |
| `JWORD_NATIVE_WORKER_UNAVAILABLE` | native | error | no | reject-native-package-operation | native, package, worker | 当前环境缺少 native worker 运行所需基础能力。 |
| `JWORD_NATIVE_WORKER_ERROR` | native | error | no | reject-native-package-operation | native, package, worker | Native package operation emits JWORD_NATIVE_WORKER_ERROR for stable package diagnostics. |
| `PDF_EXPORT_CANCELLED` | pdf | error | yes | surface-diagnostic-and-continue | export, format-interop, pdf | 用户取消当前 PDF 导出任务。 |
| `PDF_FONT_MISSING` | pdf | warning | yes | provide-compatible-font | font, format-interop, pdf | 当前字体配置不能覆盖待导出的 PDF 文本。 |
| `PDF_IMAGE_INVALID` | pdf | error | yes | surface-diagnostic-and-continue | format-interop, pdf, resource | PDF 图片输入不是可读取的 data URL、ArrayBuffer 或 Blob。 |
| `PDF_IMAGE_UNSUPPORTED` | pdf | error | yes | surface-diagnostic-and-continue | format-interop, pdf, resource | PDF 图片 MIME 类型暂不支持。 |
| `PDF_PAGE_SIZE_EXCEEDED` | pdf | error | yes | surface-diagnostic-and-continue | export, format-interop, pdf | PDF 页面宽高超过 14400 points 的规范上限。 |
| `PDF_WORKER_UNAVAILABLE` | pdf | error | no | surface-diagnostic-and-stop | format-interop, pdf, worker | 当前环境缺少 PDF worker 运行所需基础能力，或 worker 无法完成请求。 |
