/**
 * 职责：聚合装配文本编辑 runtime 的拆分层级并保留原公开抽象类入口。
 * 边界：只作为 facade 级继承入口，不承载具体编辑命令实现。
 * 协作模块：键盘编辑层、段落拆分层、粘贴计划层、富文本片段层、删除计划层与选区运行时层。
 * 性能/安全约束：入口文件不访问 Projection、不执行事务、不访问 top-level DOM。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { JWordEditorKeyboardEditingRuntime } from './keyboard-editing'

export abstract class JWordEditorTextEditingRuntime extends JWordEditorKeyboardEditingRuntime {}
