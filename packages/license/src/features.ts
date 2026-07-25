/**
 * 职责：集中定义商业授权 feature catalog 与对应类型。
 * 边界：只描述稳定 feature 标识，不执行授权判断、不读取 token。
 * 协作模块：license.ts 同时使用 legacy catalog 与 JWL2 模块级 catalog。
 * 性能/安全约束：常量必须只读，不接受调用方扩展或覆盖。
 * 实现说明：旧 Gate catalog 在 Phase 4 删除，模块级 catalog 从 JWL2 起生效。
 */

/** Gate 5 高级格式互通 feature matrix。 */
export const GATE5_FORMAT_FEATURES = {
  docxImport: 'docx.import',
  docxExport: 'docx.export',
  pdfExport: 'pdf.export'
} as const

/** Gate 6 高级协作、离线、历史、服务端和自动插入 feature matrix。 */
export const GATE6_COLLAB_FEATURES = {
  multiplayer: 'collaboration.multiplayer',
  offline: 'collaboration.offline',
  history: 'collaboration.history',
  server: 'collaboration.server',
  autoInsert: 'automation.autoInsert'
} as const

/** 所有旧商业高级能力使用的稳定 feature key union。 */
export type JWordLicenseFeatureKey =
  | typeof GATE5_FORMAT_FEATURES[keyof typeof GATE5_FORMAT_FEATURES]
  | typeof GATE6_COLLAB_FEATURES[keyof typeof GATE6_COLLAB_FEATURES]

/** JWL2 使用的模块级 feature catalog。 */
export const JWORD_FEATURES = {
  professionalEditing: 'professional.editing',
  formats: 'formats',
  collaboration: 'collaboration'
} as const

/** JWL2 模块级 feature。 */
export type JWordFeature = typeof JWORD_FEATURES[keyof typeof JWORD_FEATURES]
