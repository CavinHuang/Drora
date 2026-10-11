/**
 * hero mock 右栏：参考站形态=单张 308 宽 r16 浮卡（bg 提亮一档）内三块
 * （Git tools / Goal / Progress），块间 border-t 分隔；卡头行 32px 高
 * （13px 60% 白 + 14px 图标）；行图标 lucide 同形 SVG。
 */
import type { ReactNode } from "react";
import { heroRightPanel } from "./mock-data.mock";

function Sw({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
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
}

const FileTextIcon = () => (
  <Sw>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </Sw>
);
const BranchIcon = () => (
  <Sw>
    <path d="M15 6a9 9 0 0 0-9 9V3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </Sw>
);
const ArrowRightIcon = () => (
  <Sw>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Sw>
);
const TargetIcon = () => (
  <Sw>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </Sw>
);
const ListChecksIcon = () => (
  <Sw>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </Sw>
);
const CheckIcon = () => (
  <Sw size={16}>
    <path d="M20 6 9 17l-5-5" />
  </Sw>
);

export function RightPanelCards() {
  const { git, goal, progress } = heroRightPanel;
  return (
    <aside className="win-panel">
      <div className="panel-card">
        <section className="pc-section">
          <div className="pc-head-row">
            <p className="pc-title">
              <FileTextIcon />
              {git.title}
            </p>
          </div>
          <div className="pc-row">
            <span className="pcr-icon">
              <FileTextIcon />
            </span>
            <span>{git.changesLabel}</span>
            <span className="pcr-diff">
              <b className="diff add">{git.added}</b> <b className="diff del">{git.removed}</b>
            </span>
          </div>
          <div className="pc-row">
            <span className="pcr-icon">
              <BranchIcon />
            </span>
            {git.branch}
            <i className="pcr-caret">⌄</i>
          </div>
          <div className="pc-divider"></div>
          <div className="pc-row muted">
            <span className="pcr-icon">
              <ArrowRightIcon />
            </span>
            <span>{git.commitLabel}</span>
            <span className="pcr-more">⋯</span>
          </div>
        </section>

        <section className="pc-section">
          <div className="pc-head-row">
            <p className="pc-title">
              <TargetIcon />
              {goal.title}
            </p>
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
        </section>

        <section className="pc-section">
          <div className="pc-head-row">
            <p className="pc-title">
              <ListChecksIcon />
              {progress.title}
            </p>
          </div>
          {progress.items.map((item) => (
            <div className="progress-item done" key={item}>
              <CheckIcon />
              <span>{item}</span>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
