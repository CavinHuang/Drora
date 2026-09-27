import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { BotProvider, MobilePairingRuntimeState } from "@drora/shared";
import {
  Bot as BotIcon,
  MonitorSmartphone,
  QrCode as QrCodeIcon,
  RefreshCw,
  Smartphone,
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

  // —— 手机扫码连接（LAN 直连，spec: mobile-web-remote.md）——
  // 生命周期对齐原版：服务独立于弹层运行，状态经 Main 推送（StatusChanged）驱动，
  // 停止仅通过显式"停止"按钮；弹层重开时按查询面恢复二维码展示。
  const platform = usePlatform();
  const [qr, setQr] = useState<{
    status: MobilePairingRuntimeState["status"];
    url: string | null;
    qrDataUrl: string | null;
    failureMessage: string | null;
  }>({ status: "idle", url: null, qrDataUrl: null, failureMessage: null });
  const [copied, setCopied] = useState(false);
  const renderedQrUrlRef = useRef<string | null>(null);

  const renderQrForUrl = useCallback(async (url: string) => {
    if (renderedQrUrlRef.current === url) return;
    renderedQrUrlRef.current = url;
    try {
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 200 });
      // 异步生成期间 URL 可能又被刷新；过期结果不落状态。
      if (renderedQrUrlRef.current !== url) return;
      setQr((prev) => ({ ...prev, qrDataUrl: dataUrl }));
    } catch (error) {
      logger.warn("[WebRemoteControlDialog] 二维码生成失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const applyRuntimeState = useCallback(
    (state: MobilePairingRuntimeState) => {
      setQr((prev) => ({
        status: state.status,
        url: state.url,
        qrDataUrl: state.url === prev.url ? prev.qrDataUrl : null,
        failureMessage: state.failure?.message ?? null,
      }));
      if (state.url) void renderQrForUrl(state.url);
    },
    [renderQrForUrl],
  );

  // 状态推送订阅：starting/running/connecting/active/error 全部由 Main 驱动，不再轮询。
  useEffect(() => {
    if (!platform.onMobilePairingStateChanged) return;
    return platform.onMobilePairingStateChanged(applyRuntimeState);
  }, [platform, applyRuntimeState]);

  // 弹层重开时恢复展示（服务可能在弹层关闭期间一直运行）。
  useEffect(() => {
    if (!open) return;
    void platform
      .getMobilePairingState?.()
      .then((state) => applyRuntimeState(state))
      .catch(() => {});
  }, [open, platform, applyRuntimeState]);

  const handleGenerateQr = async () => {
    if (!platform.startMobilePairing) return;
    setQr((prev) => ({ ...prev, status: "starting", failureMessage: null }));
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
  };

  // 对齐原版 resetPairing（"刷新二维码"）：踢除已连手机并换发票据，服务不重启。
  const handleRefreshQr = async () => {
    if (!platform.refreshMobilePairing) return;
    try {
      const result = await platform.refreshMobilePairing();
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
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleStopPairing = () => {
    setQr({ status: "idle", url: null, qrDataUrl: null, failureMessage: null });
    renderedQrUrlRef.current = null;
    void platform.stopMobilePairing?.().catch((error: unknown) =>
      logger.warn("[WebRemoteControlDialog] 停止配对服务失败", {
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100vh-6rem)] max-w-lg gap-0 overflow-hidden rounded-2xl p-0"
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

            <div className="mt-5 grid gap-4">
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <Smartphone className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-ui-base font-medium text-foreground">
                      {intl.formatMessage({ id: "webRemoteControl.qr.title" })}
                    </div>
                    <p className="text-ui-base/relaxed text-foreground-subtle">
                      {intl.formatMessage({ id: "webRemoteControl.qr.description" })}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  {qr.status === "idle" || qr.status === "error" ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="w-full justify-center gap-2 enabled:cursor-pointer"
                        onClick={() => void handleGenerateQr()}
                      >
                        <QrCodeIcon className="size-4" />
                        {intl.formatMessage({ id: "webRemoteControl.qr.generate" })}
                      </Button>
                      {qr.status === "error" ? (
                        <p className="text-center text-ui-xs text-destructive">
                          {intl.formatMessage({ id: "webRemoteControl.qr.generateFailed" })}
                          {qr.failureMessage ? `：${qr.failureMessage}` : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      {qr.qrDataUrl ? (
                        <img
                          src={qr.qrDataUrl}
                          alt={intl.formatMessage({ id: "webRemoteControl.qr.title" })}
                          className="size-[200px] rounded-lg bg-white p-1"
                        />
                      ) : (
                        <div className="flex size-[200px] items-center justify-center rounded-lg bg-surface text-foreground-subtle">
                          {intl.formatMessage({ id: "webRemoteControl.qr.generating" })}
                        </div>
                      )}
                      {/* 状态行对齐原版六态：等待手机连接 / 正在连接手机 / 手机已连接。 */}
                      <p className="text-center text-ui-xs font-medium text-foreground">
                        {qr.status === "active"
                          ? intl.formatMessage({ id: "webRemoteControl.status.active" })
                          : qr.status === "connecting"
                            ? intl.formatMessage({ id: "webRemoteControl.status.connecting" })
                            : qr.status === "starting"
                              ? intl.formatMessage({ id: "webRemoteControl.status.starting" })
                              : intl.formatMessage({ id: "webRemoteControl.status.waiting" })}
                      </p>
                      <p className="text-center text-ui-xs text-foreground-subtle">
                        {qr.status === "active"
                          ? intl.formatMessage({ id: "webRemoteControl.qr.connected" })
                          : intl.formatMessage({ id: "webRemoteControl.qr.hint" })}
                      </p>
                      <div className="grid w-full grid-cols-3 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-center enabled:cursor-pointer"
                          onClick={() => void handleCopyPairingLink()}
                        >
                          {copied
                            ? intl.formatMessage({ id: "webRemoteControl.qr.copied" })
                            : intl.formatMessage({ id: "webRemoteControl.qr.copyLink" })}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-center gap-1 enabled:cursor-pointer"
                          onClick={() => void handleRefreshQr()}
                        >
                          <RefreshCw className="size-3.5" />
                          {intl.formatMessage({ id: "webRemoteControl.qr.refresh" })}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-center enabled:cursor-pointer"
                          onClick={handleStopPairing}
                        >
                          {intl.formatMessage({ id: "webRemoteControl.qr.stop" })}
                        </Button>
                      </div>
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
