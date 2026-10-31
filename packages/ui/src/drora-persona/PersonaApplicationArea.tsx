import { useCallback, useRef, useState } from "react";
import type { IDroraAgentService } from "@drora/services";
import {
  PERSONA_CAPTURE_OMITTED_REASONS,
  PERSONA_ERROR_CODES,
  type DroraPersonaGetApplicationResult,
} from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import type { PersonaApplicationWorkspaceTarget } from "./contract.js";

type PersonaApplicationService = Pick<IDroraAgentService, "getPersonaApplication">;

/** 直接使用 wire 结果类型（含 optional 字段的扁平形状），不在 UI 侧另造一份词汇。 */
type PersonaApplicationQueryResult = DroraPersonaGetApplicationResult;

/**
 * 应用情况区（specs/drora-persona-system.md §10「P0 应用情况」、合同 §3 getPersonaApplication）：
 * 已保存版本（服务 coreRevision）与指定会话/轮的 applied/omitted 分开显示；无执行/已重启时
 * 如实显示「未应用」，不伪造冷历史。查询经本机 Host 按会话所在 CLI 连接代理（无会话管理路由，
 * 不调用 session/create、不生成占位会话）。
 */
export function PersonaApplicationArea({
  personaService,
  applicationWorkspace,
  savedRevisionLabel,
}: {
  personaService: PersonaApplicationService;
  /** 本地 workspace 路由目标；null（无本地 workspace）时禁用查询。 */
  applicationWorkspace: PersonaApplicationWorkspaceTarget | null;
  /** 已保存版本描述行（由父组件以服务快照渲染；未初始化时传未初始化文案）。 */
  savedRevisionLabel: React.ReactNode;
}) {
  const { intl } = useDroraIntl();
  const [sessionId, setSessionId] = useState("");
  const [turnId, setTurnId] = useState("");
  const [result, setResult] = useState<PersonaApplicationQueryResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 请求 generation：迟到响应不覆盖页面（合同 §3）。
  const queryGenRef = useRef(0);

  const handleQuery = useCallback(async () => {
    const trimmedSessionId = sessionId.trim();
    const trimmedTurnId = turnId.trim();
    if (!trimmedSessionId || !trimmedTurnId || !applicationWorkspace || pending) return;
    const generation = ++queryGenRef.current;
    setPending(true);
    setError(null);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.drora",
          action: "query_persona_application",
          trigger: "button",
        },
        operation: async () => {
          const queryResult = await personaService.getPersonaApplication({
            workspacePath: applicationWorkspace.workspacePath,
            ...(applicationWorkspace.workspaceIdentity
              ? { workspaceIdentity: applicationWorkspace.workspaceIdentity }
              : {}),
            sessionId: trimmedSessionId,
            turnId: trimmedTurnId,
          });
          if (generation !== queryGenRef.current) return;
          setResult(queryResult);
        },
        completed: { resultSource: "platform_result" },
        failureStage: "persona_read",
      });
    } catch (cause) {
      if (generation !== queryGenRef.current) return;
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === queryGenRef.current) setPending(false);
    }
  }, [sessionId, turnId, applicationWorkspace, pending, personaService]);

  const resultNode = error
    ? intl.formatMessage({ id: "settings.drora.application.queryFailed" }, { message: error })
    : result?.status === "applied"
      ? intl.formatMessage({ id: "settings.drora.application.applied" })
      : result?.status === "omitted"
        ? intl.formatMessage(
            { id: "settings.drora.application.omittedWithReason" },
            {
              reason: describeOmittedReason(intl, result.reason),
            },
          )
        : intl.formatMessage({ id: "settings.drora.application.notApplied" });

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.drora.application.title" })}
        description={savedRevisionLabel}
        control={null}
      />
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.drora.application.turnTitle" })}
        description={intl.formatMessage({ id: "settings.drora.application.turnDescription" })}
        control={
          applicationWorkspace ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Input
                size="lg"
                className="min-w-0 flex-1 font-mono"
                placeholder={intl.formatMessage({
                  id: "settings.drora.application.sessionPlaceholder",
                })}
                aria-label={intl.formatMessage({
                  id: "settings.drora.application.sessionPlaceholder",
                })}
                data-testid="settings-persona-application-session"
                value={sessionId}
                onChange={(event) => setSessionId(event.currentTarget.value)}
              />
              <Input
                size="lg"
                className="min-w-0 flex-1 font-mono"
                placeholder={intl.formatMessage({
                  id: "settings.drora.application.turnPlaceholder",
                })}
                aria-label={intl.formatMessage({
                  id: "settings.drora.application.turnPlaceholder",
                })}
                data-testid="settings-persona-application-turn"
                value={turnId}
                onChange={(event) => setTurnId(event.currentTarget.value)}
              />
              <Button
                type="button"
                size="lg"
                data-testid="settings-persona-application-query"
                disabled={!sessionId.trim() || !turnId.trim() || pending}
                onClick={() => {
                  void handleQuery();
                }}
              >
                {intl.formatMessage({ id: "settings.drora.application.query" })}
              </Button>
            </div>
          ) : (
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.drora.application.noWorkspace" })}
            </span>
          )
        }
        detail={
          <p
            className="w-full text-ui-sm text-foreground"
            data-testid="settings-persona-application-result"
          >
            {resultNode}
          </p>
        }
      />
    </SettingsGroupCard>
  );
}

/** 捕获省略原因的用户文案映射；未知原因原样展示，不冒充其它语义。 */
function describeOmittedReason(
  intl: { formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string },
  reason: string | undefined,
): string {
  if (!reason) {
    return intl.formatMessage({ id: "settings.drora.application.omittedReasonUnknown" });
  }
  // 省略原因是 wire 上的不透明字符串；已知来源引用 shared contracts 同一常量
  // （契约键单一出处，AGENTS.md——UI 不反向 import bootstrap 内部模块，字面量只在
  // shared/contracts 定义一次）：permission_not_granted ＝ E off 快速省略（spec §5）、
  // compile_failed ＝ 已存核心编译失败只省略扩展（spec §6）、uninitialized ＝ 管理错误码
  // PERSONA_ERROR_CODES.uninitialized。未知原因原样展示，不冒充其它语义。
  if (reason === PERSONA_CAPTURE_OMITTED_REASONS.permissionNotGranted) {
    return intl.formatMessage({ id: "settings.drora.application.omittedReasonPermission" });
  }
  if (reason === PERSONA_ERROR_CODES.uninitialized) {
    return intl.formatMessage({ id: "settings.drora.application.omittedReasonUninitialized" });
  }
  if (reason === PERSONA_CAPTURE_OMITTED_REASONS.compileFailed) {
    return intl.formatMessage({ id: "settings.drora.application.omittedReasonCompileFailed" });
  }
  return reason;
}
