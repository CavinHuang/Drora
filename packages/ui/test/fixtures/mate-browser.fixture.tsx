import { createRoot } from "react-dom/client";
import { useCallback, useMemo, useState } from "react";
import { ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type { IPlatformService } from "@drora/shared";
import type { IServiceAccessor } from "@drora/services";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import { ConfirmDialogHost } from "../../src/ConfirmDialog.js";
import { MateSidePane } from "../../src/app-shell/MateSidePane.js";
import { MateSessionLine } from "../../src/mate/session-line.js";
import { MatePetSync } from "../../src/root/MatePetSync.js";
// 服务工厂与夹具 tab 拆在 mate-browser.fixture-service.ts（单文件 ≤800 行纪律；
// MateSidePaneTab 类型随 tab 常量落在服务模块，本壳只消费实例）。
import { createMateFixtureService, tab } from "./mate-browser.fixture-service.js";
import "../../src/styles.css";

/**
 * Mate 面板浏览器验收夹具（真实 React + 仓库 CSS；docs/mate-implementation-plan-2026-11-04/
 * 01-p1-detailed-design.md §6 场景 1/2/4 + 02 号 §1.4/§7 Surface A·C 场景）。服务为内存版
 * IAssistantTicketService 形状：recordTrigger/approveDecision/onDidChange 全部内存实现 +
 * 推送，不代表真实 Host/CLI。
 *
 * 与服务实现的语义对齐点（诚实标注）：
 * - approveDecision 置 decided_by=user（卡片脱离待决策集、releaseCount 积累）——与服务侧
 *   2026-11-05 修复后的真实语义一致（assistantTicketsService.ts approve 事务补写 decided_by，
 *   服务测试 assistantTicketsService.test.ts 已锁定）。
 * - 同 decision 二次放行幂等返回首次 ticketId（P1 验收场景 4；对应服务的 dispatchIndex）。
 * - 工单状态 dispatched→running→done 由夹具定时器推进（400ms/1400ms），usage/汇报为固定值。
 * - fixture-resync 重推当前快照，模拟断连重连后的 resync 推送（01 §6 场景 5 后半）；
 *   真实断连/重订链路不在本 renderer-only 夹具内。
 *
 * P2 Surface 批次扩展（mate-surface-ac.test.mjs 消费；P1 mate-observe-ui.test.mjs 场景
 * 保持兼容——新控件不点不触发）：
 * - fixture-inject-<kind> 按钮：直注入带 Router 建议（suggested dispatch/attach/failed/
 *   hold 四态）的决策卡——真实 Router 评估在 host 侧（services routerEvaluation），renderer
 *   夹具只验收 Surface 呈现与预填放行传参。
 * - fixture-queued-next 开关：下一次 approve 模拟软预算排队（返回 queued:true、工单
 *   queued+queuedReason、不推进终态）——真实排队判定在服务侧写域/预算检查。
 * - lastApproveInput 全量捕获（fixture-approve-input）：断言决策卡预填参
 *   （targetWorkspaceIdentity/attachToSessionId/dispatchMode）确实随放行发出。
 * - 建票字段按入参真实映射 dispatchMode A/B/C 与 decisionId/anchorCommandId；
 *   generationCount 由 fixture-rollover-next 开关模拟换代（真实换代是 host 代际事务）。
 *
 * P3 接缝批扩展（mate-source-pet.test.mjs 消费；P1/P2 场景保持兼容——新控件不点不触发）：
 * - 决策卡带 sourceKind（local/phone），手机点名决策卡渲染来源徽标；
 * - fixture-inject-phone：submitSourceEntry 带 channel_ref 建卡（真实 Source 事件面在
 *   host 侧 sources/，renderer 夹具按 ingestSourceEvent 同构语义模拟）；
 * - 放行回填 ticket.channel_ref（assistantSnapshot 同列）；fixture-phone-followup 同
 *   通道追加 → 直通（不建新 trigger/decision，anchor 序号推进），经 fixture-last-ingest
 *   读点断言。桌宠接缝发布/导航链路的平台面在 MatePetSync/useMatePetEvents + desktop
 *   matePetBridge 单测与 Electron 真机链路覆盖，不在本 renderer 夹具内。
 *
 * P4 修复轮扩展（mate-trust-auto.test.mjs 消费；既有场景不点不触发）：
 * - fixture-trust-open：快照 trust 携带信任门达标投影（gateOpen/rate/samples/阈值）——
 *   只造投影，真实统计/setMode 复核在 host 侧（trustGate，assistantP4Host.test.ts）；
 * - fixture-auto-locked-next：下一次 setMode("auto") 模拟服务侧复核失败 mate.auto.locked
 *   （一次性消费），验收 MateTrustBar 失败臂专属文案；
 * - ConfirmDialogHost 挂载：「切 auto」requestConfirmation 确认链路可走通（无
 *   pendingRequest 时渲染空 Dialog，不影响既有场景）。
 */

function Fixture() {
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [lastBrief, setLastBrief] = useState("");
  const [lastApprove, setLastApprove] = useState("");
  const [lastIngest, setLastIngest] = useState("");
  // P4 第二棒验收读点：气泡闸判定（fixture-last-admit）。
  const [lastAdmit, setLastAdmit] = useState("");
  // P3 桌宠接缝发布方验收：捕获 MatePetSync 经 platform.publishMatePet 发布的最新投影
  // （真实 Main 转发/宠物窗渲染在 desktop matePetBridge/tray DOM 单测与真机链路覆盖）。
  const [lastProjection, setLastProjection] = useState("");
  const {
    service,
    approveDirect,
    resync,
    injectRouterDecision,
    submitSource,
    lastIngest: readLastIngest,
    queueNext,
    rolloverNext,
    awaitNext,
    injectNotice,
    pushReports,
    setTrustGateOpen,
    setAutoLockedNext,
  } = useMemo(
    () =>
      createMateFixtureService(
        setLastBrief,
        (input) =>
          setLastApprove(
            `mode=${input.dispatchMode ?? "-"} attach=${input.attachToSessionId ?? "-"} target=${
              input.targetWorkspaceIdentity ?? "-"
            } tier=${input.permissionTier ?? "-"}`,
          ),
        setLastAdmit,
      ),
    [],
  );
  // 夹具只需 accessor.assistantTicketService 一个字段（useAssistantTickets 判空降级的读点）。
  const accessor = useMemo(
    () => ({ assistantTicketService: service }) as IServiceAccessor,
    [service],
  );
  const petPlatform = useMemo(
    () =>
      ({
        publishMatePet: (projection: unknown) => setLastProjection(JSON.stringify(projection)),
      }) as unknown as IPlatformService,
    [],
  );
  const handleApproveAgain = useCallback(async () => {
    // 场景 4：绕过 UI 直调服务（同 decisionId 二次放行），断言不二派。
    const decisionId = 2; // 场景顺序：TR-1=inferred，TR-2=explicit → 决策卡 id=2
    await approveDirect({ decisionId, permissionTier: ASSISTANT_PERMISSION_TIERS.build });
  }, [approveDirect]);
  // P3 接缝批验收控件：手机点名入口（带通道绑定）→ 决策卡（phone 徽标）→ 放行回填
  // channel_ref → 同通道追加消息直通（不建新卡）。
  const handlePhoneNamed = useCallback(() => {
    void submitSource({
      text: "手机点名：看下移动端白屏",
      mention: true,
      remoteSessionId: "rs-phone-1",
      channelRef: "phone:session:rs-phone-1",
      targetWorkspaceIdentity: tab.workspaceIdentity ?? undefined,
    }).then(() => setLastIngest(readLastIngest()));
  }, [readLastIngest, submitSource]);
  const handlePhoneFollowUp = useCallback(() => {
    void submitSource({
      text: "补充：横屏复现",
      mention: true,
      channelRef: "phone:session:rs-phone-1",
    }).then(() => setLastIngest(readLastIngest()));
  }, [readLastIngest, submitSource]);
  return (
    // TooltipProvider 照 Root.tsx 根层共享一次：MateConfigSection 的 auto 禁用钮经
    // ControlHintTooltip 消费 Radix 上下文，缺 Provider 会整树抛错（PR-1B 审查发现 1）。
    // P4 第二棒：PlatformProvider 同照 Root.tsx 根层挂载——MateConfigSection 每日配额行
    // 的 useSettings 消费 usePlatform（缺 Provider 整树抛错）；夹具 platform 桩只含
    // publishMatePet 读点，useSettings 的 platform.* 皆为可选调用（stub 安全）。
    <DroraIntlProvider key={locale} initialLocale={locale}>
      <TooltipProvider>
        <PlatformProvider platform={petPlatform}>
        <ServiceProvider services={accessor}>
          <div className="bg-background text-foreground">
            <div className="fixture-controls flex flex-wrap gap-2 p-3 text-ui-base">
              <button data-testid="fixture-approve-again" onClick={() => void handleApproveAgain()}>
                Approve again (idempotency)
              </button>
              {/* 01 §6 场景 5 后半：重推快照模拟断连重连后的 resync（推送一致，UI 状态不变）。 */}
              <button data-testid="fixture-resync" onClick={resync}>
                Resync snapshot
              </button>
              <button
                data-testid="fixture-locale"
                onClick={() => setLocale((value) => (value === "zh-CN" ? "en-US" : "zh-CN"))}
              >
                Language
              </button>
              {/* P2 Surface 批次：注入带 Router 建议的决策卡（呈现+预填传参验收）。 */}
              <button
                data-testid="fixture-inject-dispatch"
                onClick={() =>
                  injectRouterDecision("suggested", {
                    kind: "dispatch",
                    targetWorkspaceIdentity: "fixture/workspace-b",
                    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
                    briefBase: "verbatim",
                    reason: "请求未指名既有会话，建议新开独立工单",
                    evidence: ["原文提到『修一下构建』", "名单内 workspace-b 空闲"],
                  })
                }
              >
                Inject dispatch suggestion
              </button>
              <button
                data-testid="fixture-inject-attach"
                onClick={() =>
                  injectRouterDecision("suggested", {
                    kind: "attach",
                    sessionId: "sess-attach-9",
                    targetWorkspaceIdentity: "fixture/workspace",
                    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
                    briefBase: "verbatim",
                    reason: "原文提到沿用登录页会话上下文",
                    evidence: ["原文提到『接着上次那个会话』"],
                  })
                }
              >
                Inject attach suggestion
              </button>
              <button
                data-testid="fixture-inject-failed"
                onClick={() => injectRouterDecision("failed")}
              >
                Inject failed router
              </button>
              <button data-testid="fixture-queue-next" onClick={queueNext}>
                Queue next approve
              </button>
              <button data-testid="fixture-rollover-next" onClick={rolloverNext}>
                Rollover next approve
              </button>
              {/* P4 第二棒：核验滞留终局/watchdog 通知/超额摘要/气泡闸读点。 */}
              <button data-testid="fixture-await-next" onClick={awaitNext}>
                Await (unverified) next
              </button>
              <button
                data-testid="fixture-inject-notice"
                onClick={() => injectNotice("T-notice-1", "running_stall", "工单运行停滞超过 30 分钟无新事件")}
              >
                Inject watchdog notice
              </button>
              <button data-testid="fixture-push-reports" onClick={() => pushReports(4, "汇报推送：已完成 fixture 场景")}>
                Push 4 report disturbances
              </button>
              {/* P4 第二棒：气泡闸判定读点（admitDisturbance 回调实时驱动）。 */}
              {/* P4 修复轮（04 详设 §2 验收场景 2 UI 半段）：信任门达标投影与
                  setMode("auto") 复核失败开关（mate-trust-auto.test.mjs 消费）。 */}
              <button data-testid="fixture-trust-open" onClick={() => setTrustGateOpen(true)}>
                Trust gate open
              </button>
              <button data-testid="fixture-auto-locked-next" onClick={() => setAutoLockedNext()}>
                Next setMode(auto) locked
              </button>
              {/* P4 修复轮：全局确认框宿主——MateTrustBar「切 auto」确认链路
                  （requestConfirmation→ConfirmDialogHost→settle）在本夹具可走通；
                  无 pendingRequest 时渲染空 Dialog，不影响既有场景。 */}
              <ConfirmDialogHost />
              {/* P3 接缝批：手机 Source 入口（phone 徽标决策卡 + channel_ref 直通）。 */}
              <button data-testid="fixture-inject-phone" onClick={handlePhoneNamed}>
                Inject phone named trigger
              </button>
              <button data-testid="fixture-phone-followup" onClick={handlePhoneFollowUp}>
                Phone follow-up (direct-through)
              </button>
              {/* MateSessionLine 两态演示（任务行徽标组件级验收；真实挂接在任务行列表）。 */}
              <div
                className="w-full"
                data-testid="fixture-session-line-with"
                data-active-count="2"
                data-pending="3"
              >
                <MateSessionLine
                  activity={{ activeCount: 2, pendingDecisions: 3, updatedAtMs: 1 }}
                />
              </div>
              <div className="w-full" data-testid="fixture-session-line-absent">
                <MateSessionLine activity={undefined} />
              </div>
              {/* P3 桌宠接缝：发布方组件（窗口 Host services 作用域同构）+ 投影读点。 */}
              <div className="w-full" data-testid="fixture-mate-pet-sync">
                <MatePetSync platform={petPlatform} />
              </div>
              <output data-testid="fixture-open-session">{openSession ?? ""}</output>
              <output data-testid="fixture-last-brief">{lastBrief}</output>
              <output data-testid="fixture-approve-input">{lastApprove}</output>
              <output data-testid="fixture-last-ingest">{lastIngest}</output>
              <output data-testid="fixture-mate-pet-projection">{lastProjection}</output>
              <output data-testid="fixture-last-admit">{lastAdmit}</output>
            </div>
            <div className="mx-auto" style={{ width: 480, height: 780 }}>
              <MateSidePane
                tab={tab}
                focused
                onOpenMateSession={({ sessionId }) => setOpenSession(sessionId)}
              />
            </div>
          </div>
        </ServiceProvider>
        </PlatformProvider>
      </TooltipProvider>
    </DroraIntlProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
