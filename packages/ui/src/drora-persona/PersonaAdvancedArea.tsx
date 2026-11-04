import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/components/lib/utils.js";
import { PersonaApplicationArea } from "./PersonaApplicationArea.js";
import type { PersonaApplicationWorkspaceTarget } from "./contract.js";
import type { PersonaControlService, PersonaCoreEditor } from "./usePersonaCoreEditor.js";
import type { PersonaPreferences } from "./usePersonaPreferences.js";
import { noticeClassName } from "./PersonaExpressionSection.js";

/**
 * 「高级」折叠区（spec §10 第十六批）：确定性预览、应用情况查询、只读 JSON 导出与
 * 恢复产品默认四个低频面默认收起，日常编辑不被打扰。全部行为保持既有合同：
 * 预览零模型请求、应用情况不伪造冷历史、导出取消/失败不虚报、恢复默认只动五字段。
 */
export function PersonaAdvancedArea({
  personaService,
  editor,
  preferences,
  applicationWorkspace,
  exportSupported,
}: {
  /** 应用情况查询经本机 Host 代理到本地 CLI（与分区其余读面同一服务端口）。 */
  personaService: PersonaControlService;
  editor: PersonaCoreEditor;
  preferences: PersonaPreferences;
  /** 应用情况查询的本地 workspace 路由目标；null（无本地 workspace）时禁用查询。 */
  applicationWorkspace: PersonaApplicationWorkspaceTarget | null;
  /** IPlatformService.saveFile 是否可用（仅桌面）；Web 缺席时导出如实降级。 */
  exportSupported: boolean;
}) {
  const { intl } = useDroraIntl();
  const [open, setOpen] = useState(false);
  const { saved, preview, previewPending, previewErrorCode } = editor;
  const { exportPending, exportNotice, handleExport } = preferences;
  // 分区根部已保证 saved 就绪才渲染；这里收窄类型（编辑器快照是唯一权威来源）。
  if (!saved) return null;

  const savedRevisionLabel = saved.initialized ? (
    <>
      {intl.formatMessage(
        { id: "settings.drora.application.savedVersion" },
        {
          revision: String(saved.revision),
          template: String(saved.template.templateVersion),
        },
      )}
      <span className="mt-1 block">
        {intl.formatMessage({ id: "settings.drora.application.savedVersionHint" })}
      </span>
    </>
  ) : (
    intl.formatMessage({ id: "settings.drora.application.uninitialized" })
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="settings-persona-advanced">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-start"
            data-testid="settings-persona-advanced-trigger"
          >
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.drora.advanced.title" })}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.drora.advanced.hint" })}
            </span>
            <ChevronDown
              className={cn(
                "ms-auto size-4 shrink-0 text-foreground-subtle transition-transform",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-4 space-y-6">
          {/* 确定性预览：本地模板编译，不请求模型；明确不是实际输出保证。 */}
          <SettingsGroupCard>
            <SettingsRow
              controlLayout="wide"
              label={intl.formatMessage({ id: "settings.drora.preview.title" })}
              description={intl.formatMessage({ id: "settings.drora.preview.disclaimer" })}
              control={previewPending ? <Spinner className="size-4" /> : null}
              detail={
                <div
                  className="w-full whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-ui-sm leading-5 text-foreground"
                  data-testid="settings-persona-preview"
                >
                  {preview
                    ? preview.text
                    : previewErrorCode
                      ? intl.formatMessage(
                          { id: "settings.drora.preview.failed" },
                          { code: previewErrorCode },
                        )
                      : intl.formatMessage({ id: "settings.drora.preview.empty" })}
                </div>
              }
            />
          </SettingsGroupCard>

          {/* 应用情况：已保存版本与指定会话/轮的应用事实分开显示；不伪造冷历史。 */}
          <PersonaApplicationArea
            personaService={personaService}
            applicationWorkspace={applicationWorkspace}
            savedRevisionLabel={savedRevisionLabel}
          />

          {/* 只读导出（合同 §7）：无资料不为导出初始化；取消/失败不虚报已保存。 */}
          <SettingsGroupCard>
            <SettingsRow
              label={intl.formatMessage({ id: "settings.drora.export.title" })}
              description={intl.formatMessage({ id: "settings.drora.export.description" })}
              control={
                <Button
                  type="button"
                  size="lg"
                  data-testid="settings-persona-export"
                  disabled={exportPending || !exportSupported}
                  onClick={() => {
                    void handleExport();
                  }}
                >
                  {exportPending
                    ? intl.formatMessage({ id: "settings.drora.export.pending" })
                    : intl.formatMessage({ id: "settings.drora.export.action" })}
                </Button>
              }
              detail={
                <div className="w-full space-y-2">
                  {!exportSupported ? (
                    <p className="text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "settings.drora.export.unsupported" })}
                    </p>
                  ) : null}
                  {exportNotice ? (
                    <p
                      role="status"
                      className={noticeClassName(exportNotice.tone)}
                      data-testid="settings-persona-export-notice"
                    >
                      {exportNotice.kind === "saved"
                        ? exportNotice.path
                          ? intl.formatMessage(
                              { id: "settings.drora.export.savedPath" },
                              { path: exportNotice.path },
                            )
                          : intl.formatMessage({ id: "settings.drora.export.saved" })
                        : exportNotice.kind === "canceled"
                          ? intl.formatMessage({ id: "settings.drora.export.canceled" })
                          : exportNotice.kind === "noData"
                            ? intl.formatMessage({ id: "settings.drora.export.noData" })
                            : exportNotice.kind === "unsupported"
                              ? intl.formatMessage({ id: "settings.drora.export.unsupported" })
                              : exportNotice.kind === "failed"
                                ? exportNotice.message
                                  ? intl.formatMessage(
                                      { id: "settings.drora.export.failed" },
                                      { message: exportNotice.message },
                                    )
                                  : intl.formatMessage({ id: "settings.drora.export.failedPlain" })
                                : exportNotice.kind === "code"
                                  ? intl.formatMessage(
                                      { id: "settings.drora.export.code" },
                                      { code: exportNotice.code },
                                    )
                                  : intl.formatMessage(
                                      { id: "settings.drora.notice.rpc" },
                                      { message: exportNotice.message },
                                    )}
                    </p>
                  ) : null}
                </div>
              }
            />

            {/* 恢复产品默认（合同 §1.1）：显式危险动作，确认对话框在分区根部。 */}
            <SettingsRow
              label={intl.formatMessage({ id: "settings.drora.reset.title" })}
              description={intl.formatMessage({ id: "settings.drora.reset.description" })}
              control={
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  data-testid="settings-persona-reset-defaults"
                  disabled={
                    !saved.initialized ||
                    editor.savePending ||
                    editor.initializePending ||
                    editor.resetPending
                  }
                  onClick={() => editor.setResetConfirmOpen(true)}
                >
                  {editor.resetPending
                    ? intl.formatMessage({ id: "settings.drora.identity.resetting" })
                    : intl.formatMessage({ id: "settings.drora.identity.resetDefaults" })}
                </Button>
              }
            />
          </SettingsGroupCard>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
