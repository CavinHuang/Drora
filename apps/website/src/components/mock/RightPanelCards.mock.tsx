/**
 * hero mock 右栏卡片（Git tools / Goal / Progress）。
 * 配方 §6 结论：这三张卡没有可静态挂载的真实组件（Git/Goal/Progress 是 dock/工具行形态），
 * 按配方以站点 legacy 卡片结构 + 逐字参考站数据手写；样式沿用 style.css 的 .panel-card 族。
 * 参考站右栏没有终端卡（终端是其独立可折叠面板，mock 里保持折叠不渲染）。
 */
import { heroRightPanel } from "./mock-data.mock";

export function RightPanelCards() {
  const { git, goal, progress } = heroRightPanel;
  return (
    <aside className="win-panel">
      <div className="panel-card">
        <p className="pc-title">{git.title}</p>
        <div className="pc-row">
          <span className="pcr-icon">⑃</span>
          <span>{git.changesLabel}</span>
          <span className="pcr-diff">
            <b className="diff add">{git.added}</b> <b className="diff del">{git.removed}</b>
          </span>
        </div>
        <div className="pc-row">
          <span className="pcr-icon">⎇</span>
          {git.branch}
          <i className="pcr-caret">⌄</i>
        </div>
        <div className="pc-divider"></div>
        <div className="pc-row muted">
          <span className="pcr-icon">→</span>
          <span>{git.commitLabel}</span>
          <span className="pcr-more">⋯</span>
        </div>
      </div>

      <div className="panel-card">
        <div className="pc-head-row">
          <p className="pc-title">{goal.title}</p>
          <span className="pc-badge">{goal.badge}</span>
        </div>
        <p className="pc-goal">{goal.desc}</p>
        <p className="pc-dotmeta">
          <span>{goal.meta[0]}</span>
          <i>·</i>
          <span>{goal.meta[1]}</span>
          <i>·</i>
          <span>{goal.meta[2]}</span>
        </p>
      </div>

      <div className="panel-card">
        <p className="pc-title">{progress.title}</p>
        {progress.items.map((item) => (
          <div className="progress-item done" key={item}>
            <span>✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
