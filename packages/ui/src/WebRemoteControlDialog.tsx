/* eslint-disable max-lines -- 远控弹层保持单一文件（扫码卡双传输 + Bot Channel 卡），
   与 BotsDialog.tsx 同例；状态逻辑后续可再下沉 hook。 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { BotProvider, MobilePairingRuntimeState, MobilePairingStatus } from "@drora/shared";
import {
  Bot as BotIcon,
  Link2,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Square,
  XIcon,
} from "lucide-react";
import QRCode from "qrcode";
import { BotsDialog } from "@/BotsDialog.js";
import { ProviderIcon } from "@/BotsDialog/shared.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { getBotProviderRegionTagLabelId } from "@/botsUi.js";

type RemoteControlBotProvider = Extract<BotProvider, "weixin" | "feishu" | "lark" | "telegram">;

const REMOTE_CONTROL_BOT_ENTRIES: Array<{
  provider: RemoteControlBotProvider;
}> = [
  { provider: "weixin" },
  { provider: "feishu" },
  { provider: "lark" },
  { provider: "telegram" },
];

/** 状态文案/详情/圆点色/标签的映射逐项对齐原版（cin/lin/uin/din）。 */
const STATUS_TEXT_ID: Record<MobilePairingStatus, string> = {
  idle: "webRemoteControl.status.idle",
  starting: "webRemoteControl.status.starting",
  running: "webRemoteControl.status.running",
  connecting: "webRemoteControl.status.connecting",
  active: "webRemoteControl.status.active",
  error: "webRemoteControl.status.error",
};

const STATUS_DETAIL_ID: Record<MobilePairingStatus, string> = {
  idle: "webRemoteControl.statusDetail.idle",
  starting: "webRemoteControl.statusDetail.starting",
  running: "webRemoteControl.statusDetail.running",
  connecting: "webRemoteControl.statusDetail.connecting",
  active: "webRemoteControl.statusDetail.active",
  error: "webRemoteControl.statusDetail.error",
};

function statusDotClass(status: MobilePairingStatus): string {
  switch (status) {
    case "error":
      return "bg-destructive";
    case "active":
      return "bg-success";
    case "idle":
      return "bg-border";
    default:
      return "bg-warning";
  }
}

export const WebRemoteControlDialog = memo(function WebRemoteControlDialogComponent({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { intl } = useDroraIntl();
  const [botsDialogOpen, setBotsDialogOpen] = useState(false);
  const [botEntryProvider, setBotEntryProvider] = useState<RemoteControlBotProvider | null>(null);

  // —— 手机扫码连接（双传输，spec: mobile-web-remote.md）——
  // LAN 直连（默认回退，同网可用）与官方 relay 云中继（跨网络，M4a）二选一；
  // 布局与文案逐项对齐原版 3.14.3 发行版弹层，状态由 Main 推送驱动。
  const platform = usePlatform();
  const [transport, setTransport] = useState<"lan" | "relay">("lan");
  const [qr, setQr] = useState<{
    status: MobilePairingRuntimeState["status"];
    url: string | null;
    qrDataUrl: string | null;
    failureMessage: string | null;
    qrRenderError: string | null;
  }>({ status: "idle", url: null, qrDataUrl: null, failureMessage: null, qrRenderError: null });
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const renderedQrUrlRef = useRef<string | null>(null);
  const autoStartedForOpenRef = useRef(false);
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const renderQrForUrl = useCallback(async (url: string) => {
    if (renderedQrUrlRef.current === url) return;
    renderedQrUrlRef.current = url;
    try {
      // 对齐原版：width 320、margin 1。
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
      // 异步生成期间 URL 可能又被刷新；过期结果不落状态。
      if (renderedQrUrlRef.current !== url) return;
      setQr((prev) => ({ ...prev, qrDataUrl: dataUrl }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("[WebRemoteControlDialog] 二维码生成失败", { error: message });
      // 失败必须可见：停留在“正在准备二维码”会让用户无限等待。
      if (renderedQrUrlRef.current === url) {
        setQr((prev) => ({ ...prev, qrRenderError: message }));
      }
    }
  }, []);

  const applyRuntimeState = useCallback(
    (state: MobilePairingRuntimeState) => {
      setQr((prev) => ({
        status: state.status,
        url: state.url,
        qrDataUrl: state.url === prev.url ? prev.qrDataUrl : null,
        failureMessage: state.failure?.message ?? null,
        qrRenderError: state.url === prev.url ? prev.qrRenderError : null,
      }));
      if (state.url) void renderQrForUrl(state.url);
    },
    [renderQrForUrl],
  );

  const handleStart = useCallback(async () => {
    if (transportRef.current === "relay") {
      if (!platform.startMobileRelayControl) {
        setQr((prev) => ({
          ...prev,
          status: "error",
          failureMessage: "mobile relay control is unavailable in this build",
        }));
        return;
      }
      setQr((prev) => ({ ...prev, status: "starting", failureMessage: null, qrRenderError: null }));
      try {
        const result = await platform.startMobileRelayControl({
          workspacePath,
          workspaceIdentity,
        });
        applyRuntimeState({
          running: true,
          status: "running",
          connected: false,
          url: result.url,
          workspacePath,
          workspaceIdentity: workspaceIdentity ?? null,
          failure: null,
        });
      } catch (error) {
        logger.warn("[WebRemoteControlDialog] 启动 relay 远控失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        setQr((prev) => ({
          ...prev,
          status: "error",
          failureMessage: error instanceof Error ? error.message : String(error),
        }));
      }
      return;
    }
    if (!platform.startMobilePairing) {
      setQr((prev) => ({
        ...prev,
        status: "error",
        failureMessage: "mobile pairing is unavailable in this build",
      }));
      return;
    }
    setQr((prev) => ({ ...prev, status: "starting", failureMessage: null, qrRenderError: null }));
    try {
      const result = await platform.startMobilePairing({ workspacePath, workspaceIdentity });
      applyRuntimeState({
        running: true,
        status: "running",
        connected: false,
        url: result.url,
        workspacePath,
        workspaceIdentity: workspaceIdentity ?? null,
        failure: null,
      });
    } catch (error) {
      logger.warn("[WebRemoteControlDialog] 启动配对服务失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      setQr((prev) => ({
        ...prev,
        status: "error",
        failureMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [platform, workspacePath, workspaceIdentity, applyRuntimeState]);

  // 状态推送订阅（对齐原版 StatusChanged）：仅消费当前选中传输的推送。
  useEffect(() => {
    if (!platform.onMobilePairingStateChanged) return;
    return platform.onMobilePairingStateChanged((state) => {
      if (transportRef.current === "lan") applyRuntimeState(state);
    });
  }, [platform, applyRuntimeState]);

  useEffect(() => {
    if (!platform.onMobileRelayStateChanged) return;
    return platform.onMobileRelayStateChanged((state) => {
      if (transportRef.current === "relay") applyRuntimeState(state);
    });
  }, [platform, applyRuntimeState]);

  // 对齐原版：弹层打开即恢复展示；服务未运行则自动开启（每次打开至多自动开启一次）。
  // 传输切换时同样恢复对应链路的状态。
  useEffect(() => {
    if (!open) {
      autoStartedForOpenRef.current = false;
      return;
    }
    void (async () => {
      try {
        const state =
          transport === "relay"
            ? await platform.getMobileRelayControlState?.()
            : await platform.getMobilePairingState?.();
        applyRuntimeState(
          state ?? {
            running: false,
            status: "idle",
            connected: false,
            url: null,
            workspacePath: null,
            workspaceIdentity: null,
            failure: null,
          },
        );
        if (state?.status === "idle" && !autoStartedForOpenRef.current) {
          autoStartedForOpenRef.current = true;
          void handleStart();
        }
      } catch {
        // 查询失败静默；starting 态兜底显示
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅跟随 open/transport 变化触发恢复
  }, [open, transport]);

  // 对齐原版 resetPairing（"刷新二维码"）：LAN=换发票据踢除旧手机；relay=轮换设备凭据重启。
  const handleRefreshQr = async () => {
    if (pending) return;
    setPending(true);
    try {
      const result =
        transport === "relay"
          ? await platform.refreshMobileRelayControl?.()
          : await platform.refreshMobilePairing?.();
      if (!result) return;
      applyRuntimeState({
        running: true,
        status: "running",
        connected: false,
        url: result.url,
        workspacePath,
        workspaceIdentity: workspaceIdentity ?? null,
        failure: null,
      });
    } catch (error) {
      logger.warn("[WebRemoteControlDialog] 刷新配对二维码失败", {
        transport,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPending(false);
    }
  };

  const handleStopPairing = () => {
    setQr({ status: "idle", url: null, qrDataUrl: null, failureMessage: null, qrRenderError: null });
    renderedQrUrlRef.current = null;
    const stopping =
      transport === "relay"
        ? platform.stopMobileRelayControl?.()
        : platform.stopMobilePairing?.();
    void stopping?.catch((error: unknown) =>
      logger.warn("[WebRemoteControlDialog] 停止远控失败", {
        transport,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const handleCopyPairingLink = async () => {
    if (!qr.url) return;
    try {
      await navigator.clipboard.writeText(qr.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（权限/非安全上下文）时保持静默，二维码本身仍可用。
    }
  };

  const handleOpenBotEntry = (provider: RemoteControlBotProvider) => {
    setBotEntryProvider(provider);
    setBotsDialogOpen(true);
    logger.info("[WebRemoteControlDialog] 打开 Bot Channel 配置入口", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
      provider,
    });
  };

  const handleOpenBotsDialog = () => {
    setBotEntryProvider(null);
    setBotsDialogOpen(true);
    logger.info("[WebRemoteControlDialog] 打开 Bots 总配置入口", {
      workspacePath,
      workspaceIdentity: workspaceIdentity ?? "none",
    });
  };

  const statusText = intl.formatMessage({ id: STATUS_TEXT_ID[qr.status] });
  const statusDetail = intl.formatMessage({ id: STATUS_DETAIL_ID[qr.status] });
  const statusTag = intl.formatMessage({
    id:
      qr.status === "active"
        ? "webRemoteControl.statusTag.phone"
        : qr.status === "idle"
          ? "webRemoteControl.status.idle"
          : qr.status === "error"
            ? "webRemoteControl.status.error"
            : "webRemoteControl.statusTag.ready",
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100vh-6rem)] max-w-4xl gap-0 overflow-hidden rounded-2xl p-0"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            // Bugfix: 这个弹窗会贴近桌面窗口顶部显示，默认 close 在 Electron drag 区里容易点不中。
            // 这里改成显式点击关闭，并把按钮本身标成 no-drag，保证右上角关闭动作能稳定命中。
            // Bugfix: 远控弹层内可点击控件之前没有显式 pointer cursor，桌面端 hover 时不像可操作元素。
            // 这里仅给启用态补手指指针，禁用态仍沿用 Button 的 disabled 交互语义。
            className="absolute top-2 right-2 enabled:cursor-pointer [app-region:no-drag]"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
          <div className="max-h-[calc(100vh-6rem)] min-h-0 overflow-y-auto p-5">
            <DialogHeader className="space-y-2 pr-8">
              <div className="flex items-center gap-2">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-primary">
                  <MonitorSmartphone className="size-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle>{intl.formatMessage({ id: "webRemoteControl.title" })}</DialogTitle>
                  <DialogDescription>
                    {intl.formatMessage({ id: "webRemoteControl.description" })}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* 对齐原版：左扫码卡（1.45fr）+ 右 Bot Channel 卡（min 300px）双栏。 */}
            <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
              <section className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-start gap-2">
                  <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-ui-base font-medium text-foreground">
                      {intl.formatMessage({ id: "webRemoteControl.mobileQr.title" })}
                    </div>
                    <p className="text-ui-base/relaxed text-foreground-subtle">
                      {intl.formatMessage({
                        id:
                          transport === "relay"
                            ? "webRemoteControl.relay.description"
                            : "webRemoteControl.mobileQr.description",
                      })}
                    </p>
                  </div>
                  {/* 传输切换：LAN 直连（默认）↔ 官方 relay 云中继（跨网络）。 */}
                  <div className="flex shrink-0 rounded-lg border border-border bg-surface p-0.5">
                    {(
                      [
                        { value: "lan", labelId: "webRemoteControl.transport.lan" },
                        { value: "relay", labelId: "webRemoteControl.transport.relay" },
                      ] as const
                    ).map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        className={`rounded-md px-2.5 py-1 text-ui-xs font-medium transition-colors ${
                          transport === entry.value
                            ? "bg-card text-foreground"
                            : "text-foreground-subtle hover:text-foreground"
                        }`}
                        onClick={() => setTransport(entry.value)}
                      >
                        {intl.formatMessage({ id: entry.labelId })}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 连接状态卡：状态 + 圆点标签行、详情行；右侧停止。 */}
                <div className="mb-3 rounded-lg bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="text-ui-base font-medium text-foreground">{statusText}</div>
                        <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${statusDotClass(qr.status)}`}
                          />
                          <span className="truncate">{statusTag}</span>
                        </div>
                      </div>
                      <div className="text-ui-base/relaxed text-foreground-subtle">
                        {statusDetail}
                      </div>
                    </div>
                    {pending ? (
                      <Loader2 className="size-4 animate-spin text-foreground-subtle" />
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        className="shrink-0 gap-2 enabled:cursor-pointer"
                        onClick={handleStopPairing}
                        disabled={qr.status === "idle"}
                      >
                        <Square className="size-3.5" />
                        {intl.formatMessage({ id: "webRemoteControl.stop" })}
                      </Button>
                    )}
                  </div>
                  {qr.failureMessage ? (
                    <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-ui-base/relaxed text-destructive">
                      <p>{qr.failureMessage}</p>
                    </div>
                  ) : null}
                  {/* 无法扫码行：文案 + 刷新二维码 + 复制链接（对齐原版 copy-link-row）。 */}
                  <div className="mt-3 flex min-h-10 flex-wrap items-center gap-3 border-t border-border pt-3">
                    <div className="min-w-48 flex-1 text-ui-base/relaxed text-foreground-subtle">
                      {intl.formatMessage({ id: "webRemoteControl.copyLink.description" })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="shrink-0 gap-2 enabled:cursor-pointer"
                      onClick={() => void handleRefreshQr()}
                      disabled={pending}
                    >
                      <RefreshCw className="size-3.5" />
                      {intl.formatMessage({ id: "webRemoteControl.refreshQr" })}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="shrink-0 gap-2 enabled:cursor-pointer"
                      onClick={() => void handleCopyPairingLink()}
                      disabled={!qr.url || pending}
                    >
                      <Link2 className="size-3.5" />
                      {copied
                        ? intl.formatMessage({ id: "webRemoteControl.copyLink.copied" })
                        : intl.formatMessage({ id: "webRemoteControl.copyLink" })}
                    </Button>
                  </div>
                </div>
                {/* 二维码容器：虚线边框、居中；未就绪时显示准备中。 */}
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-background-alt p-4">
                  {qr.qrRenderError && !qr.qrDataUrl ? (
                    <div className="flex flex-col items-center gap-2 text-center text-ui-sm text-destructive">
                      <span>{intl.formatMessage({ id: "webRemoteControl.qr.renderFailed" })}</span>
                      <span className="text-ui-xs text-foreground-subtle">{qr.qrRenderError}</span>
                    </div>
                  ) : qr.qrDataUrl ? (
                    <img
                      src={qr.qrDataUrl}
                      alt={intl.formatMessage({ id: "webRemoteControl.qrAlt" })}
                      className="size-64 max-w-full rounded-lg bg-white p-3"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-center text-ui-base text-foreground-subtle">
                      <Loader2 className="size-5 animate-spin" />
                      <span>{intl.formatMessage({ id: "webRemoteControl.generating" })}</span>
                    </div>
                  )}
                </div>
              </section>
              <section className="flex min-h-[360px] flex-col rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-start gap-2">
                  <BotIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <div className="min-w-0 space-y-1">
                    <div className="text-ui-base font-medium text-foreground">
                      {intl.formatMessage({
                        id: "webRemoteControl.botChannel.title",
                      })}
                    </div>
                    <p className="text-ui-base/relaxed text-foreground-subtle">
                      {intl.formatMessage({
                        id: "webRemoteControl.botChannel.description",
                      })}
                    </p>
                  </div>
                </div>
                <div className="grid min-h-0 flex-1 gap-3">
                  {REMOTE_CONTROL_BOT_ENTRIES.map((entry) => {
                    const regionTagLabelId = getBotProviderRegionTagLabelId(entry.provider);

                    return (
                      <button
                        key={entry.provider}
                        type="button"
                        className="flex min-h-0 cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-surface px-3 py-3 text-left transition-colors hover:border-input-border-focused hover:bg-surface-hover focus-visible:border-input-border-focused"
                        onClick={() => handleOpenBotEntry(entry.provider)}
                      >
                        {/* Bugfix: 远控 Bot Channel 入口原来用通用 lucide 图标，用户无法一眼区分微信、飞书和 Telegram。
                            这里直接复用 BotsDialog 的渠道 logo，不再额外包裹容器，保证品牌图标本身作为视觉识别。 */}
                        <ProviderIcon provider={entry.provider} className="size-12 shrink-0" />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-ui-base font-medium text-foreground">
                            <span className="min-w-0 truncate">
                              {intl.formatMessage({
                                id: `webRemoteControl.botChannel.${entry.provider}.title`,
                              })}
                            </span>
                            {regionTagLabelId ? (
                              <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-ui-xs font-medium leading-none text-foreground-subtle">
                                {intl.formatMessage({ id: regionTagLabelId })}
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-ui-base/relaxed text-foreground-subtle">
                            {intl.formatMessage({
                              id: `webRemoteControl.botChannel.${entry.provider}.description`,
                            })}
                          </span>
                          <span className="block text-ui-base font-medium text-primary">
                            {intl.formatMessage({
                              id: "webRemoteControl.botChannel.configure",
                            })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full justify-center gap-2 enabled:cursor-pointer"
                    onClick={handleOpenBotsDialog}
                  >
                    <BotIcon className="size-3.5" />
                    {intl.formatMessage({
                      id: "webRemoteControl.botChannel.manageBots",
                    })}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <BotsDialog
        open={botsDialogOpen}
        onOpenChange={setBotsDialogOpen}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        entryProvider={botEntryProvider}
      />
    </>
  );
});
