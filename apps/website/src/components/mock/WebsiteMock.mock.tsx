/**
 * 官网 hero「真组件 mock」入口。
 *
 * 按 .zcode/workflow-tmp/mock-recipe.md 配方挂 provider 森林
 * （Intl + Tooltip + TabStore + Services + Platform），内部渲染真实 packages/ui 组件：
 * 侧栏 WorkspaceSidebarItem/TaskList、聊天流 ConversationShareReadonlyTimeline、
 * composer ChatPromptEditor（真实 Lexical 输入壳）。
 *
 * 本文件不进入 next build 的模块图谱：由 scripts/generate-hero-mock.mjs 在构建期经
 * esbuild（tsconfig paths 解析 ui 源码的 `@/*.js` 导入）+ react-dom/server
 * renderToStaticMarkup 烘焙为 hero-mock.generated.html，由 src/app/page.tsx 读入注入。
 * 原因有二：① ui 组件链内部使用 React hooks，Next 15 的 RSC 编译禁止 server 图谱引入
 * hooks 模块（next build 直接报错）；② 不能改用 "use client" 水合边界——mock 的相对时间
 * 以 Date.now() 为基准在构建期烘焙，浏览器重算会水合失配（配方 §5）。渲染期不调用任何
 * 服务方法；产品 UI 变更后重跑 pnpm --filter @drora/website generate:hero-mock。
 *
 * 站点侧 chrome（mock-wrap 容器 / 交通灯 / 三栏栅格 / 顶栏）沿用 legacy 类名，
 * 由 public/assets/css/style.css 提供样式。
 */
import {
  ChatPromptEditor,
  DroraIntlProvider,
  PlatformProvider,
  ServiceProvider,
  TabStoreProvider,
  TooltipProvider,
  type IServiceAccessor,
} from "@drora/ui/website-hero";
import { ConversationShareReadonlyTimeline } from "@drora/ui/conversation-share-readonly";
import type { IPlatformService } from "@drora/shared";
import { activeHeroWorkspace, heroChatRows, heroComposer, heroTopbar } from "./mock-data.mock";
import { HeroSidebar } from "./HeroSidebar.mock";
import { RightPanelCards } from "./RightPanelCards.mock";

// 渲染期不调用任何服务方法（重命名/归档/重连都在回调里），空对象 cast 只过 context 判空；
// settingService 为 undefined 时 useSettings 有 unavailableSettingsStore 兜底（配方 §2.1）。
const mockServices = {
  settingService: undefined,
  broadcastService: undefined,
  botsService: undefined,
  droraAgentService: undefined,
} as unknown as IServiceAccessor;

const mockPlatform = {} as unknown as IPlatformService;

function HeroMockWindow() {
  return (
    // `dark`：官网常暗，让 @drora/ui 的 token（--color-background 等）在此子树取暗色值。
    // `reveal`：站点滚动渐显动画钩子（main.js IntersectionObserver 加 .in）。
    <div className="mock-wrap reveal dark" aria-hidden="true">
      <div className="mock-glow" aria-hidden="true"></div>
      <div className="window">
        <div className="win-traffic">
          <div className="traffic">
            <i className="t-red"></i>
            <i className="t-yellow"></i>
            <i className="t-green"></i>
          </div>
          <span className="tb-icon">◫</span>
          <span className="tb-arrow">‹</span>
          <span className="tb-arrow">›</span>
          <span className="tb-icon">⊕</span>
        </div>

        <HeroSidebar />

        <div className="win-main">
          <div className="win-topbar">
            <p className="wt-title">{heroTopbar.goalTitle}</p>
            <span className="chip">{heroTopbar.workspaceChip}</span>
            <span className="chip chip-branch">
              {heroTopbar.branchChip} <i>⌄</i>
            </span>
            <span className="wt-spacer"></span>
            <span className="wt-icons">
              <i className="wt-icon-active">▣</i>
              <i>⊞</i>
              <i>◱</i>
              <i>▥</i>
            </span>
          </div>

          {/* 聊天流：真实组件（自带 DroraIntlProvider/TooltipProvider，零外部 provider 依赖），
              用户气泡 / 工具摘要行 / markdown 在构建期烘焙；行序规则见 mock-data.mock.ts */}
          <div className="win-chat">
            <ConversationShareReadonlyTimeline rows={heroChatRows} locale="zh-CN" theme="dark" />
          </div>

          {/* composer：真实 Lexical 输入壳，test-id 与产品一致（chat-input / chat-send-button） */}
          <div className="win-input">
            <ChatPromptEditor
              workspacePath={activeHeroWorkspace.workspacePath}
              taskId={null}
              submitLabel={heroComposer.submitLabel}
              placeholder={heroComposer.placeholder}
              onSubmit={() => true}
              inputTestId="chat-input"
            />
          </div>
        </div>

        <RightPanelCards />
      </div>
    </div>
  );
}

// provider 森林（配方 §2.1：Intl 最外、Tooltip 次之、TabStore/Services/Platform 最内）。
export function WebsiteMock() {
  return (
    <DroraIntlProvider initialLocale="zh-CN">
      <TooltipProvider>
        <TabStoreProvider>
          <ServiceProvider services={mockServices}>
            <PlatformProvider platform={mockPlatform}>
              <HeroMockWindow />
            </PlatformProvider>
          </ServiceProvider>
        </TabStoreProvider>
      </TooltipProvider>
    </DroraIntlProvider>
  );
}
