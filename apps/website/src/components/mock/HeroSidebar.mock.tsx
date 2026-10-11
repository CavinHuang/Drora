/**
 * hero mock 侧栏：真实 TaskList / TaskListItem 渲染任务行，组头用站点 legacy 结构
 * （参考站同款 anatomy：folder 图标 + 组名 + ⋯/⊕ 动作）。
 *
 * 不用 WorkspaceSidebarItem 的原因：它的激活任务高亮读模块级 droraSessionStore，
 * zustand 在 SSR（renderToStaticMarkup）语义下读 getInitialState（空快照），模块级播种
 * 进不了静态 HTML（实测验证）；改走 TaskList 的公开 activeTaskId prop，语义一致。
 * 组名与任务数据逐字对齐参考站（见 mock-data.mock.ts）；本子树仅作装饰渲染，禁止挂 client 交互。
 */
import type { ReactNode } from "react";
import { TaskList } from "@drora/ui/website-hero";
import { activeHeroTaskId, heroSidebarChrome, heroWorkspaces } from "./mock-data.mock";

const noop = () => {};
const noopAsync = async () => null;

const Sw = ({ size = 16, children }: { size?: number; children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** 顶部动作区图标（参考站 lucide 同形）：圆加号 / 闪灼。 */
const CirclePlusIcon = () => (
  <Sw>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </Sw>
);
const ZapIcon = () => (
  <Sw>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </Sw>
);
/** 组头动作钮：⋯ / ＋；用户区齿轮。 */
const MoreIcon = () => (
  <Sw size={14}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Sw>
);
const SidebarPlusIcon = () => (
  <Sw size={14}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Sw>
);
const SettingsIcon = () => (
  <Sw>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Sw>
);

/** 参考站组头 anatomy 的 folder 图标（与 legacy 注入版逐字一致）。 */
function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function HeroSidebar() {
  return (
    <div className="win-sidebar">
      {/* 顶部动作区：参考站同款逐字文案（真实 app 中此区域由 shell 渲染，mock 用站点 chrome 保留） */}
      <div className="win-side-actions">
        {heroSidebarChrome.actions.map((action) => (
          <div className="side-action" key={action.label}>
            <span className="sa-icon">
              {action.label === "新建任务" ? <CirclePlusIcon /> : action.label === "技能" ? <ZapIcon /> : <FolderIcon />}
            </span>
            <span>{action.label}</span>
            {action.kbd ? <kbd>{action.kbd}</kbd> : null}
          </div>
        ))}
      </div>

      {/* workspace 组森林：任务分区头（参考站同款「任务」+🗑）+ 组头（站点 chrome）
          + 真实 TaskList（失败红点/激活高亮为组件行为） */}
      <div className="win-side-list">
        <div className="win-side-section">
          <span className="wss-label">{heroSidebarChrome.tasksSectionLabel}</span>
          <span className="wss-trash" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </svg>
          </span>
        </div>
        {heroWorkspaces.map((workspace) => (
          <div key={workspace.workspacePath}>
            <div className="win-side-label">
              <span className="wsl-icon">
                <FolderIcon />
              </span>
              <span className="wsl-name">{workspace.label}</span>
              <span className="wsl-actions" aria-hidden="true">
                <MoreIcon />
                <SidebarPlusIcon />
              </span>
            </div>
            {workspace.tasks.length > 0 ? (
              <TaskList
                workspacePath={workspace.workspacePath}
                tasks={workspace.tasks}
                activeTaskId={workspace.label === "gomoku-ai" ? activeHeroTaskId : null}
                onSelectTask={noop}
                showCreateButton={false}
                showFooter={false}
                loading={false}
                onRenameTask={noopAsync}
                onSetTaskPinned={noopAsync}
                onArchiveTask={noopAsync}
                onSetTaskUnread={noopAsync}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* 底部用户区：参考站同款 Ryan Bot；头像用 Drora D 标（唯一分歧） */}
      <div className="win-side-user">
        <span className="wsu-avatar" aria-hidden="true">
          {heroSidebarChrome.user.avatar}
        </span>
        <span className="wsu-name">{heroSidebarChrome.user.name}</span>
        <span className="wsu-gear" aria-hidden="true">
          <SettingsIcon />
        </span>
      </div>
    </div>
  );
}
