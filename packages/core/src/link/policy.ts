/**
 * 职责：对外暴露 core 链接 allowlist 策略入口。
 * 边界：这里只做路径兼容转发，不重复实现 URL 校验逻辑。
 * 协作模块：core tests、command builder 和 operation adapter 统一从该入口读取策略。
 * 性能/安全约束：保持纯函数导出，不访问 DOM 或宿主环境。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export { isAllowedLinkUrl } from '../links/policy'
