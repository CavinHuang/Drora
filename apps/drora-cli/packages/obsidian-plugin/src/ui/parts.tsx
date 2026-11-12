/**
 * 面板共享小组件（P5）。样式类名来自 panel.html 内联样式（宿主 CSS 变量 + 兜底值，
 * drora-site panel 同款纪律）；组件保持展示性，状态归 main.tsx 单一所有者。
 */
import type { ReactNode } from "react";
import type { Translate } from "./i18n.js";

export function LoadingRow({ t }: { t: Translate }) {
  return <div className="vault-state">{t("vault.loading")}</div>;
}

export function ErrorRow({ t, message }: { t: Translate; message: string }) {
  return (
    <div className="vault-state vault-state-danger">
      {t("vault.networkError")} <span className="vault-state-detail">{message}</span>
    </div>
  );
}

/** D13 保守缺省：写操作降级提示（§2 审批语义——未裁定前只读面，如实提示不静默）。 */
export function DegradedWriteNotice({ t }: { t: Translate }) {
  return <div className="vault-degraded">{t("vault.degraded.write")}</div>;
}

export function Banner({ kind, children }: { kind: "info" | "warn" | "danger"; children: ReactNode }) {
  return <div className={`vault-banner vault-banner-${kind}`}>{children}</div>;
}

/** 空态容器（图标位留白，标题 + 可选说明）。 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="vault-empty">
      <div className="vault-empty-title">{title}</div>
      {hint ? <div className="vault-empty-hint">{hint}</div> : null}
    </div>
  );
}

/** 分页「加载更多」（列表分页与分段读取共用形态）。 */
export function LoadMoreButton({
  t,
  disabled,
  onClick,
  label,
}: {
  t: Translate;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type="button" className="vault-btn vault-btn-ghost vault-loadmore" disabled={disabled} onClick={onClick}>
      {label ?? t("vault.loadMore")}
    </button>
  );
}
