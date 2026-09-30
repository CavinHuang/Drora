// GitPane 窄公开入口（specs/mobile-relay-r3-frontend.md §25；§22 窄入口模式——
// mobile-web 经此装配官方 GitPane 复原件与同源 git 数据派生 hook，不深引 UI 实现文件）。
export { GitPane } from "@/GitPane.js";
export { useGitRepository } from "@/hooks/useGitRepository.js";
export type { GitPaneRepositoryState } from "@/hooks/useGitRepository.js";
export { ServiceProvider } from "@/hooks/useServices.js";
export { StoreProvider } from "@/store/StoreProvider.js";
export { TabStoreProvider } from "@/store/TabStoreProvider.js";
export { DroraIntlProvider } from "@/i18n/IntlProvider.js";
export { TooltipProvider } from "@/components/ui/tooltip.js";
export { PluginReferenceIconProvider } from "@/v4/pluginReferenceIconContext.js";
export { GitActionMenu } from "@/GitActionMenu.js";
