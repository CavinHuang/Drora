/**
 * hero mock 侧栏：真实 TaskList / TaskListItem 渲染任务行，组头用站点 legacy 结构
 * （参考站同款 anatomy：folder 图标 + 组名 + ⋯/⊕ 动作）。
 *
 * 不用 WorkspaceSidebarItem 的原因：它的激活任务高亮读模块级 droraSessionStore，
 * zustand 在 SSR（renderToStaticMarkup）语义下读 getInitialState（空快照），模块级播种
 * 进不了静态 HTML（实测验证）；改走 TaskList 的公开 activeTaskId prop，语义一致。
 * 组名与任务数据逐字对齐参考站（见 mock-data.mock.ts）；本子树仅作装饰渲染，禁止挂 client 交互。
 */
import { TaskList } from "@drora/ui/website-hero";
import { activeHeroTaskId, heroSidebarChrome, heroWorkspaces } from "./mock-data.mock";

const noop = () => {};
const noopAsync = async () => null;

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
            <span className="sa-icon">{action.icon}</span>
            <span>{action.label}</span>
            {action.kbd ? <kbd>{action.kbd}</kbd> : null}
          </div>
        ))}
      </div>

      {/* workspace 组森林：组头（站点 chrome）+ 真实 TaskList（失败红点/激活高亮为组件行为） */}
      <div className="win-side-list">
        {heroWorkspaces.map((workspace) => (
          <div key={workspace.workspacePath}>
            <div className="win-side-label">
              <span className="wsl-icon">
                <FolderIcon />
              </span>
              <span className="wsl-name">{workspace.label}</span>
              <span className="wsl-actions" aria-hidden="true">
                <i>⋯</i>
                <i>⊕</i>
              </span>
            </div>
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
          ⚙
        </span>
      </div>
    </div>
  );
}
