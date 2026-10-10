/**
 * 官网 hero「真组件 mock」入口。
 *
 * 按 .zcode/workflow-tmp/mock-recipe.md 配方挂 provider 森林
 * （Intl + Tooltip + TabStore + Services + Platform），内部渲染真实 packages/ui 组件：
 * 侧栏 WorkspaceSidebarItem/TaskList、聊天流 ConversationTimeline。
 *
 * 由 scripts/generate-hero-mock.mjs 构建期经 esbuild + renderToStaticMarkup 烘焙为
 * hero-mock.generated.html（无 JS 兜底壳）；线上由 HeroMockSlot 在客户端挂载本组件
 * 换掉静态壳（ConversationTimeline 虚拟化需运行时测高才能出行；挂载门规避
 * Date.now() 相对时间的水合失配，见 specs/website.md）。渲染期不调用任何服务方法；
 * 产品 UI 变更后重跑 pnpm --filter @drora/website generate:hero-mock。
 *
 * 站点侧 chrome（mock-wrap 容器 / 交通灯 / 三栏栅格 / 顶栏）沿用 legacy 类名，
 * 由 public/assets/css/style.css 提供样式。顶栏/composer 图标为参考站 lucide
 * 图标的逐字 path 复刻（stroke 1.5/2 与 size 对齐）。
 */
import {
  DroraIntlProvider,
  PlatformProvider,
  ServiceProvider,
  TabStoreProvider,
  TooltipProvider,
  type IServiceAccessor,
} from "@drora/ui/website-hero";
import { ConversationTimeline } from "@drora/ui/website-hero";
import type { IPlatformService } from "@drora/shared";
import { activeHeroWorkspace, heroChatRows, heroComposer, heroTopbar } from "./mock-data.mock";
import { HeroSidebar } from "./HeroSidebar.mock";
import { RightPanelCards } from "./RightPanelCards.mock";
import type { ReactNode } from "react";

// 渲染期不调用任何服务方法（重命名/归档/重连都在回调里），空对象 cast 只过 context 判空；
// settingService 为 undefined 时 useSettings 有 unavailableSettingsStore 兜底（配方 §2.1）。
const mockServices = {
  settingService: undefined,
  broadcastService: undefined,
  botsService: undefined,
  droraAgentService: undefined,
} as unknown as IServiceAccessor;

const mockPlatform = {} as unknown as IPlatformService;

type IconProps = { size?: number; sw?: number };

function Svg({ size = 16, sw = 1.5, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 参考站顶栏 lucide 图标逐字 path（panel-left-close / arrow-left / arrow-right）。 */
const PanelLeftCloseIcon = () => (
  <Svg>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="m16 15-3-3 3-3" />
  </Svg>
);
const ArrowLeftIcon = () => (
  <Svg>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Svg>
);
const ArrowRightIcon = () => (
  <Svg>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Svg>
);
/** 顶栏右侧簇：square-chart-gantt / square-terminal / panel-right-open（参考站逐字）。 */
const SquareChartGanttIcon = () => (
  <Svg>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 8h7" />
    <path d="M8 12h6" />
    <path d="M11 16h5" />
  </Svg>
);
const SquareTerminalIcon = () => (
  <Svg>
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </Svg>
);
const PanelRightOpenIcon = () => (
  <Svg>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
    <path d="m10 15-3-3 3-3" />
  </Svg>
);
const ChevronDownIcon = ({ size = 14 }: IconProps) => (
  <Svg size={size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
/** composer 的 reasoning 档位按钮：lucide brain（参考站逐字）。 */
const BrainIcon = () => (
  <Svg sw={2}>
    <path d="M12 18V5" />
    <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
    <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
    <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
    <path d="M18 18a4 4 0 0 0 2-7.464" />
    <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
    <path d="M6 18a4 4 0 0 1-2-7.464" />
    <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
  </Svg>
);
/** composer 上下文用量环（参考站同款双 circle 进度环，14,238/200,000 视觉）。 */
const UsageRingIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
      opacity="0.7"
      strokeLinecap="round"
      strokeDasharray="62.83 62.83"
      strokeDashoffset="58.36"
      transform="rotate(-90 12 12)"
    />
  </svg>
);
/** 顶栏应用胶囊：Finder 风格双色调脸（参考站为 Finder png，此处品牌蓝近似绘制）。 */
const FinderFaceIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="var(--blue)" />
    <path d="M12 2.5v19" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
    <circle cx="8" cy="9.2" r="1.15" fill="#fff" />
    <circle cx="16" cy="9.2" r="1.15" fill="#fff" />
    <path
      d="M7.8 14.2c1.25 1.5 2.7 2.2 4.2 2.2s2.95-.7 4.2-2.2"
      stroke="#fff"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

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
          {/* 参考站左簇三钮（新建任务钮在参考站为 width:0 折叠态，不复刻） */}
          <span className="tb-icon">
            <PanelLeftCloseIcon />
          </span>
          <span className="tb-arrow">
            <ArrowLeftIcon />
          </span>
          <span className="tb-arrow">
            <ArrowRightIcon />
          </span>
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
              <span className="wt-pill">
                <i className="wt-icon-active">
                  <FinderFaceIcon />
                </i>
                <i className="wt-pill-caret">
                  <ChevronDownIcon size={11} />
                </i>
              </span>
              <i>
                <SquareChartGanttIcon />
              </i>
              <i>
                <SquareTerminalIcon />
              </i>
              <i>
                <PanelRightOpenIcon />
              </i>
            </span>
          </div>

          <div className="win-chat">
            <ConversationTimeline
              rows={heroChatRows}
              totalCount={heroChatRows.length}
              sessionKey="hero-mock"
              rowContext={{
                theme: "dark",
                workspacePath: activeHeroWorkspace.workspacePath,
                codePreviewSettings: {
                  lightTheme: "github-light",
                  darkTheme: "github-dark",
                  showLineNumbers: false,
                  wrapLongLines: false,
                  fontSizePx: 13,
                },
              }}
            />
          </div>

          {/* composer：手写（参考站同款视觉与工具行）。ChatPromptEditor 为 Lexical 真输入壳，
              其依赖链带 Vite import.meta.env（Next 构建不支持）且交互对装饰区无意义，故回退 */}
          <div className="win-input">
            <div className="composer" data-testid="chat-input">
              <div className="comp-input">{heroComposer.placeholder}</div>
              <div className="comp-bar">
                <span className="comp-btn icon-only">
                  <span className="tr-icon">＋</span>
                  <span className="sr-only">{heroComposer.addContext}</span>
                </span>
                <span className="comp-btn plain">
                  <span className="tr-icon">✋</span>
                  {heroComposer.confirmEdit}
                  <i className="comp-caret">⌄</i>
                </span>
                <span className="comp-spacer"></span>
                <span className="comp-btn icon-only comp-ring">
                  <UsageRingIcon />
                  <span className="sr-only">{heroComposer.usage}</span>
                </span>
                <span className="chip">
                  {heroComposer.model}
                  <i className="comp-caret">⌄</i>
                </span>
                <span className="comp-btn plain">
                  <BrainIcon />
                  {heroComposer.effort}
                </span>
                <span className="comp-send">↑</span>
              </div>
            </div>
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
