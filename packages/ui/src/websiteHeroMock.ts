// 官网 hero 静态 mock 的受控导出入口：只聚合展示组件与最小 provider 集合，不引 App/Root 等重依赖链。
// 纯新增聚合模块（新文件新模块，不触碰还原目录，上游合并零冲突面）。
// 消费方：apps/website 首页 hero（静态导出烘焙，SSR 语义见 specs/website.md）。
// 激活任务高亮走 TaskList 的 activeTaskId prop（zustand store 在 SSR 语义下读初始快照，
// 模块级播种无法进入 renderToStaticMarkup，故不用 store 注入）。
export { WorkspaceSidebarItem } from "@/WorkspaceSidebarItem.js";
export { TaskList } from "@/TaskList.js";
export { MemoTaskItem } from "@/TaskListItem.js";
export { ConversationTimeline } from "@/v4/ConversationTimeline.js";
export { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
export { DroraIntlProvider } from "@/i18n/IntlProvider.js";
export { TabStoreProvider } from "@/store/TabStoreProvider.js";
export { ServiceProvider } from "@/hooks/useServices.js";
export { PlatformProvider } from "@/hooks/usePlatform.js";
export { TooltipProvider } from "@/components/ui/tooltip.js";
export type { DroraTaskMeta } from "@drora/shared";
export type { IServiceAccessor } from "@drora/services";
