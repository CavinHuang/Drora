// R3 P3c 模型选择器第一档 + 上下文用量（specs/mobile-relay-r3-frontend.md §16 第 2/3 条）。
// 受控纯展示组件：模型清单（view）与当前选中事实（state）都由调用方注入，组件不订阅、
// 不发命令；触发按钮/打开状态归 App（本组件渲染触摸遮罩 + 面板本体，onClose/onSelect
// 由调用方收口）。桌面参考：packages/ui/src/hooks/useModelSelectionView.ts（revision
// 乱序丢弃归调用方订阅层）、chat-input-toolbar/contextUsage.tsx（用量判空/百分比口径）。
//
// 档位交互裁定（spec §16「跨模型切档丢弃源 thought 用目标模型默认档」）：模型行点击提交
// 不带 thoughtLevel（命令层 thought ""，目标模型默认档收敛）；显式档位由行下展开的
// reasoningLevel.values 子选项行提交（view 缺 optionSpecs 回落 snapshot.thoughtLevels）。
// 分组/选中/档位展开是纯派生，纯函数导出供 node:test 单测（本包无 React 测试设施）。
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelSelectionView } from "@drora/services";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";

/** 选择提交意图（TaskSession.switchModel 入参形；thoughtLevel 缺省 = 目标模型默认档）。 */
export interface ModelMenuSelection {
  providerId: string;
  modelId: string;
  thoughtLevel?: string;
}

/**
 * 当前选中事实（conversationStore.getModelSelectionState 返回形的结构投影；
 * 与 store 类型结构性兼容——ui 不反向 import app，App 集成处由 TS 结构化赋值兜住漂移）。
 */
export interface ModelMenuState {
  current: {
    providerId: string;
    modelId: string;
    options?: { reasoningLevel?: string };
  } | null;
  fallback: { provider: string; model: string; thought: string } | null;
  thoughtLevels: string[];
  availability: { allowed: boolean; reasonCode?: string } | null;
  usage: { usedTokens: number; maxTokens: number } | null;
}

export interface ModelMenuProps {
  /** 模型清单视图（taskSession.getModelSelectionView）；null = 视图未就绪。 */
  view: ModelSelectionView | null;
  /** 当前选中事实（store.getModelSelectionState() 返回值）。 */
  state: ModelMenuState;
  /** 首读进行中（view 为 null 时区分 remoteWaiting / targetMissing 文案）。 */
  loading?: boolean;
  /** 选择提交（模型行不带档位；档位子选项行显式带）。 */
  onSelect: (selection: ModelMenuSelection) => void;
  /** 关闭请求（遮罩点击/Escape；打开状态归调用方，本组件只发请求）。 */
  onClose: () => void;
}

/**
 * 档位集合解析：view 模型 config.optionSpecs.reasoningLevel.values 优先，
 * 缺失/为空回落 snapshot.config.thoughtLevels（spec §16 第 3 条）。
 */
export function resolveModelThoughtLevels(
  model:
    | {
        config?: { optionSpecs?: { reasoningLevel?: { values?: readonly string[] } } };
      }
    | undefined,
  fallbackLevels: readonly string[],
): string[] {
  const values = model?.config?.optionSpecs?.reasoningLevel?.values;
  return values && values.length > 0 ? [...values] : [...fallbackLevels];
}

/** 当前选中模型匹配：config.modelSelection 优先，无稀疏意图时回落 config effective 投影。 */
export function isModelSelected(
  state: ModelMenuState,
  providerId: string,
  modelId: string,
): boolean {
  if (state.current) {
    return state.current.providerId === providerId && state.current.modelId === modelId;
  }
  return state.fallback?.provider === providerId && state.fallback?.model === modelId;
}

/**
 * 当前生效思考档：modelSelection.options 显式档优先，回落投影 thought（空串 = 未绑定档，
 * 不参与勾选）；只应在当前模型行内比较。
 */
export function resolveCurrentThoughtLevel(state: ModelMenuState): string | undefined {
  const explicit = state.current?.options?.reasoningLevel;
  if (explicit !== undefined) return explicit;
  const projected = state.fallback?.thought;
  return projected ? projected : undefined;
}

/**
 * k/M compact token 格式化（桌面 lib/tokenNumberFormat.formatCompactTokenNumber 同语义：
 * ≥1000 走 locale compact 记法——英文 K/M/B、中文万/亿，<1000 原样）。
 */
export function formatCompactTokenCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale || undefined, {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value);
}

/**
 * 上下文用量徽标（composer 状态区；spec §16 第 2 条）。文案 = 官方键 chat.contextUsage
 * （「上下文已用 {used} / 总量 {total}」，used/total compact 格式化）+ 百分比；
 * 判空同桌面 getRenderableTaskUsage：非有限值/非正数不渲染（0 是初始化兜底，不是占用）。
 */
export function UsageBadge({
  usedTokens,
  maxTokens,
}: {
  usedTokens: number;
  maxTokens: number;
}) {
  const intl = useIntl();
  if (
    !Number.isFinite(usedTokens) ||
    !Number.isFinite(maxTokens) ||
    usedTokens <= 0 ||
    maxTokens <= 0
  ) {
    return null;
  }
  // 百分比钳制到 [0,1]（跨快照竞窗下 used 可能瞬时越界，不渲染 >100% 的误导值）。
  const percent = Math.min(Math.max(usedTokens / maxTokens, 0), 1);
  const percentLabel = new Intl.NumberFormat(intl.locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(percent);
  const usageLabel = intl.formatMessage(
    { id: "chat.contextUsage" },
    {
      used: formatCompactTokenCount(usedTokens, intl.locale),
      total: formatCompactTokenCount(maxTokens, intl.locale),
    },
  );
  return (
    <span
      data-testid="mobile-usage-badge"
      className="inline-flex min-w-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 text-ui-xs text-foreground-subtle"
    >
      <span className="min-w-0 truncate tabular-nums">{usageLabel}</span>
      <span className="ml-1 shrink-0 font-mono tabular-nums">{percentLabel}</span>
    </span>
  );
}

/** 模型菜单（spec §16 第 3 条第一档）。父级需把本组件渲染在触发按钮的 relative 容器内
 * （面板 absolute 锚定、遮罩 fixed 全屏）；面板 w-72 max-h-96 overflow-y-auto，行高 44px
 * 触控标准，选中行 bg-selected，分组标题 text-ui-xs 弱化色。 */
export function ModelMenu({
  view,
  state,
  loading = false,
  onSelect,
  onClose,
}: ModelMenuProps) {
  const { formatMessage } = useIntl();
  const menuLabel = formatMessage({ id: "chat.toolbar.model.label" });
  // 默认展开当前模型行（菜单每次打开重挂载，initializer 即取当时选中事实）。
  const [expandedKey, setExpandedKey] = useState<string | null>(() => {
    if (state.current) return `${state.current.providerId}/${state.current.modelId}`;
    if (state.fallback) return `${state.fallback.provider}/${state.fallback.model}`;
    return null;
  });
  // Escape 关闭（桌面调试/外接触发；触摸路径走遮罩 onClose）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 禁用态读 snapshot.availability.switchModelConfig（spec §16 第 3 条）；null = 无快照
  // 事实，不禁用（App 在无快照时通常不会打开菜单）。
  const switchDisabled = state.availability ? !state.availability.allowed : false;
  const currentThought = resolveCurrentThoughtLevel(state);

  const renderPlaceholder = (id: string) => (
    <div
      role="status"
      className="w-72 rounded-lg border border-border bg-card px-3 py-3 text-ui-xs text-foreground-subtle shadow"
    >
      {formatMessage({ id })}
    </div>
  );

  // 视图未就绪：首读中 → remoteWaiting；无目标/读取失败/空清单 → targetMissing。
  if (!view || view.providers.length === 0) {
    return renderPlaceholder(
      loading ? "chat.toolbar.model.remoteWaiting" : "chat.toolbar.model.targetMissing",
    );
  }

  return (
    <>
      {/* 触摸遮罩：点面板外关闭；aria-hidden 纯点击面，不进可达性树。 */}
      <div aria-hidden="true" className="fixed inset-0 z-30" onClick={onClose} />
      <div
        role="menu"
        aria-label={menuLabel}
        data-testid="mobile-model-menu"
        className="absolute z-40 max-h-96 w-72 overflow-y-auto rounded-lg border border-border bg-card shadow"
      >
        {view.providers.map((provider) => {
          // providerName 注册表内可空（config-service 允许空串），空回落 providerId。
          const providerLabel = provider.providerName?.trim() || provider.providerId;
          return (
            <section key={provider.providerId} role="group" aria-label={providerLabel}>
              <div className="px-3 pb-1 pt-2 text-ui-xs text-foreground-subtle">
                {providerLabel}
              </div>
              {provider.models.map((model) => {
                const rowKey = `${provider.providerId}/${model.modelId}`;
                const selected = isModelSelected(state, provider.providerId, model.modelId);
                const levels = resolveModelThoughtLevels(model, state.thoughtLevels);
                const expanded = expandedKey === rowKey && levels.length > 0;
                return (
                  <div key={rowKey}>
                    <div className={cn("flex items-stretch", selected && "bg-selected")}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={switchDisabled}
                        className={cn(
                          "flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-ui-sm text-foreground",
                          switchDisabled && "opacity-50",
                        )}
                        onClick={() => {
                          // 不带 thoughtLevel = 命令层 thought ""（目标模型默认档，
                          // spec §16 跨模型切档语义）；显式档位走档位子选项行。
                          onSelect({
                            providerId: provider.providerId,
                            modelId: model.modelId,
                          });
                        }}
                      >
                        <span className="w-4 shrink-0">
                          {selected ? <Check aria-hidden="true" className="size-3.5" /> : null}
                        </span>
                        <span className="min-w-0 truncate">{model.modelId}</span>
                      </button>
                      {levels.length > 0 ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${model.modelId} ${formatMessage({
                            id: "mobileShell.model.thoughtLevel",
                          })}`}
                          className="flex w-11 shrink-0 items-center justify-center text-foreground-subtle"
                          onClick={() => setExpandedKey(expanded ? null : rowKey)}
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                          />
                        </button>
                      ) : null}
                    </div>
                    {expanded ? (
                      <div className="border-t border-border bg-surface">
                        <div className="px-3 pt-1 text-ui-xs text-foreground-subtlest">
                          {formatMessage({ id: "mobileShell.model.thoughtLevel" })}
                        </div>
                        {levels.map((level) => {
                          const levelSelected = selected && currentThought === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              role="menuitemradio"
                              aria-checked={levelSelected}
                              disabled={switchDisabled}
                              className={cn(
                                "flex min-h-11 w-full items-center gap-2 pl-8 pr-3 text-left text-ui-xs text-foreground",
                                levelSelected && "bg-selected",
                                switchDisabled && "opacity-50",
                              )}
                              onClick={() => {
                                onSelect({
                                  providerId: provider.providerId,
                                  modelId: model.modelId,
                                  thoughtLevel: level,
                                });
                              }}
                            >
                              <span className="w-4 shrink-0">
                                {levelSelected ? (
                                  <Check aria-hidden="true" className="size-3.5" />
                                ) : null}
                              </span>
                              <span className="min-w-0 truncate">{level}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}
