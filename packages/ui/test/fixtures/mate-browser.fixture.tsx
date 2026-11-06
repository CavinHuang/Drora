import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ASSISTANT_MODES, ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type { IPlatformService } from "@drora/shared";
import type { IServiceAccessor } from "@drora/services";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../src/store/TabStoreProvider.js";
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
 *
 * 2026-11-06 二轮审查扩展（mate-surface-ac.test.mjs 消费；既有场景不点不触发）：
 * - fixture-approve-bare：不带 targetWorkspaceIdentity 直放行最新决策卡（命中 trigger
 *   落库回读臂）——F1 守卫读点；服务工厂 approve 已移除 tab.workspaceIdentity 兜底，
 *   改为与真实链同构的「入参 → Router 建议 → trigger 落库值」解析，链断即
 *   validationFailed 拒绝。
 * - fixture-inject-auto-notice：注入 auto_notice×gate 决策+同 decisionId 的 done 工单
 *   （F4 告知卡呈现/工单号反查验收；真实 auto 直派判定在 host 侧，夹具只造快照事实）。
 *
 * P8b 台账扩展（mate-surface-ac.test.mjs MSA15 消费；既有场景不点不触发）：
 * - fixture-inject-inventory：注入全域台账视图（本组：工单 T-inv-1+代管会话+teams 会话+
 *   闲时行；跨项目组 fixture/workspace-b：一条会话行）+ 快照 inventoryReady 信号——
 *   工单行同步落 snapshot.tickets（总览卡工单行点击=selectTicket，详情按快照工单集
 *   渲染）。真实三源组装在 host 侧 workInventoryBootstrap，夹具只造投影事实。
 * - fixture-inventory-clear / fixture-inventory-empty：「投影就绪中」（view 清空、ready
 *   保持）/「无工作」（workspaces 空）两态——三态区分验收（旧 Host 缺席=不注入即卡
 *   不渲染）。
 *
 * P10a-2 对话台扩展（mate-surface-ac.test.mjs MSA18 消费；既有场景不点不触发）：
 * - MateSidePane 顶部新增 MateThreadSection（对话流=台账消息投影：四类消息+composer+
 *   readMateThread 分页）——待决策卡/告知卡在对话流与收件箱**同卡双视图**呈现（设计
 *   语义：同源同卡不双写），既有资产的卡片 locator 需按 mate-inbox-list 容器收敛。
 * - fixture-thread-truncate / fixture-thread-seed：快照截断窗开关+旧史注入（状态件拆
 *   mate-browser.fixture-thread.ts）——「截断首屏+加载更早读台账」的分页验收面。
 * - fixture-mode-off：mode 切 off（§2.3 mode 矩阵：composer 禁用+提示）。
 * - fixture-last-trigger：recordTrigger 入参摘要读点（composer 发送=explicit+target=
 *   workspaceKey 与 /mate 拦截同链断言）。
 */

function Fixture() {
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [lastBrief, setLastBrief] = useState("");
  const [lastApprove, setLastApprove] = useState("");
  const [lastIngest, setLastIngest] = useState("");
  // P4 第二棒验收读点：气泡闸判定（fixture-last-admit）。
  const [lastAdmit, setLastAdmit] = useState("");
  // P10a-2 对话台验收读点：recordTrigger 入参摘要（快照推送随动更新——composer 同链
  // 断言锚 simulated/target/text）。
  const [lastTrigger, setLastTrigger] = useState("");
  // P3 桌宠接缝发布方验收：捕获 MatePetSync 经 platform.publishMatePet 发布的最新投影
  // （真实 Main 转发/宠物窗渲染在 desktop matePetBridge/tray DOM 单测与真机链路覆盖）。
  const [lastProjection, setLastProjection] = useState("");
  const {
    service,
    approveDirect,
    resync,
    injectRouterDecision,
    injectAutoNotice, injectQueryReply,
    submitSource,
    approveBare,
    lastIngest: readLastIngest,
    queueNext,
    rolloverNext,
    awaitNext,
    injectNotice,
    pushReports,
    setTrustGateOpen,
    setAutoLockedNext,
    injectInventory,
    clearInventory,
    emptyInventory,
    injectAutonomyCard,
    injectRhythm,
    toggleThreadTruncation,
    seedThreadHistory,
    lastTriggerInput: readLastTrigger,
    lastManageApproveInput: readLastManageApprove,
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
  // P10a-2：recordTrigger 入参读点随快照推送更新（captureTriggerInput 先于 publish）。
  useEffect(() => {
    const subscription = service.onDidChange(() => setLastTrigger(readLastTrigger()));
    return () => subscription.dispose();
  }, [service, readLastTrigger]);
  // P10b：manage 放行读点（快照推送随动——approveManageDecision 翻 managed 即 publish）。
  const [lastManageApprove, setLastManageApprove] = useState("");
  useEffect(() => {
    const subscription = service.onDidChange(() => setLastManageApprove(readLastManageApprove()));
    return () => subscription.dispose();
  }, [service, readLastManageApprove]);
  return (
    // TooltipProvider 照 Root.tsx 根层共享一次：MateConfigSection 的 auto 禁用钮经
    // ControlHintTooltip 消费 Radix 上下文，缺 Provider 会整树抛错（PR-1B 审查发现 1）。
    // P4 第二棒：PlatformProvider 同照 Root.tsx 根层挂载——MateConfigSection 每日配额行
    // 的 useSettings 消费 usePlatform（缺 Provider 整树抛错）；夹具 platform 桩只含
    // publishMatePet 读点，useSettings 的 platform.* 皆为可选调用（stub 安全）。
    <DroraIntlProvider key={locale} initialLocale={locale}>
      <TooltipProvider>
        {/* P5（06 号详设 §5）：MateModelPreference 的 useModelSelectionView 经
            useWorkspaceServicesResolution 消费 useTabStore——缺 TabStoreProvider 整树
            抛错（MSA13 探针实证）；照 Root.tsx 根层挂法补齐（无 tab 形态下 hook 走
            unavailable，模型 select 诚实禁用——registry 清单链属真机验收域）。 */}
        <TabStoreProvider>
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
              {/* P10b manage 臂验收（MSA19 消费；真实评估/可见集预检/异步执行面在 host 侧
                  manageActions+node.ts 装配——单测锁定；夹具只造决策卡建议投影事实，
                  targetRef=MSA15 台账注入的会话行 sess-inv-open，同构「可见集成员」）。 */}
              <button
                data-testid="fixture-inject-manage"
                onClick={() =>
                  injectRouterDecision(
                    "suggested",
                    {
                      kind: "manage",
                      manageTargetKind: "session",
                      manageTargetRef: "sess-inv-open",
                      manageAction: "stop_turn",
                      reason: "用户要求停掉该会话的当前回合（卡住无进展）",
                      evidence: ["请把会话 sess-inv-open 的当前回合停掉"],
                    },
                    "请把会话 sess-inv-open（用户手开的会话）的当前回合停掉",
                  )
                }
              >
                注入 manage 建议卡
              </button>
              {/* 2026-11-06 二轮审查（F1 守卫，mate-surface-ac MSA11 消费）：不带 target
                  直放行最新决策卡——命中 trigger 落库回读臂；UI 触发未恒传 workspaceKey
                  的回归在此 validationFailed（fixture-last-brief 不推进即红）。 */}
              <button data-testid="fixture-approve-bare" onClick={() => void approveBare()}>
                Approve latest (no target)
              </button>
              {/* 2026-11-06 二轮审查（F4 告知卡，mate-surface-ac MSA12 消费）：注入
                  auto_notice×gate 决策+关联工单——真实 auto 直派判定在 host 侧，夹具只造
                  快照事实（告知卡呈现/工单号反查/档位归属验收）。 */}
              <button data-testid="fixture-inject-auto-notice" onClick={() => injectAutoNotice()}>
                Inject auto notice
              </button>
              {/* P7（08 号详设 §3.4，MSA14 消费）：注入 status_replied 查询直答决策——
                  答复卡呈现/只读无工单动作/dismiss 出清验收。 */}
              <button data-testid="fixture-inject-query-reply" onClick={() => injectQueryReply()}>
                注入查询直答
              </button>
              {/* P8b 台账验收（MSA15 消费；真实三源组装在 host 侧 workInventoryBootstrap，
                  夹具只造快照事实：注入视图/就绪中/无工作三态）。 */}
              <button data-testid="fixture-inject-inventory" onClick={() => injectInventory()}>
                注入全域台账
              </button>
              <button data-testid="fixture-inventory-clear" onClick={() => clearInventory()}>
                台账就绪中
              </button>
              <button data-testid="fixture-inventory-empty" onClick={() => emptyInventory()}>
                台账无工作
              </button>
              {/* P9 自主节奏验收（MSA16 消费；真实建卡事务在 host 侧 autonomy.ts 独立
                  事务——不进候选卡评估循环，夹具只造快照事实）。 */}
              <button data-testid="fixture-inject-autonomy" onClick={() => injectAutonomyCard()}>
                注入自主建议卡
              </button>
              <button data-testid="fixture-inject-rhythm" onClick={() => injectRhythm()}>
                注入节奏投影
              </button>
              {/* P10a-2 对话台验收控件（MSA18 消费；既有场景不点不触发）：快照截断窗
                  （模拟真实快照容量截断——首屏=截断窗、台账全量走 readMateThread）/
                  旧史注入（早于现有全部行的分页史）/mode 切 off（composer 禁用断言）。 */}
              <button data-testid="fixture-thread-truncate" onClick={toggleThreadTruncation}>
                对话台快照截断窗
              </button>
              <button data-testid="fixture-thread-seed" onClick={() => seedThreadHistory()}>
                对话台注入旧史
              </button>
              <button
                data-testid="fixture-mode-off"
                onClick={() => void service.setMode(ASSISTANT_MODES.off)}
              >
                Mode off
              </button>
              {/* P10b：off 矩阵后回 observe（MSA19 台账行管理入口断言需要非 off 态）。 */}
              <button
                data-testid="fixture-mode-observe"
                onClick={() => void service.setMode(ASSISTANT_MODES.observe)}
              >
                Mode observe
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
              <output data-testid="fixture-last-trigger">{lastTrigger}</output>
              <output data-testid="fixture-manage-approve-input">{lastManageApprove}</output>
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
        </TabStoreProvider>
      </TooltipProvider>
    </DroraIntlProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
