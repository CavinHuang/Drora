import { memo, useMemo, useState } from "react";
import { DRORA_AGENT_PROVIDER } from "@drora/shared";
import type { IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useModelSelectionView } from "@/hooks/useModelSelectionView.js";
import { buildRegistryModelSelectGroups } from "@/lib/modelSelectionGroups.js";
import {
  decodeCustomModelValue,
  encodeCustomModelValue,
} from "@/lib/droraCustomModelValue.js";
import { useMateStore } from "@/store/mateStore.js";
import { resolveMateErrorMessageId } from "./view-model.js";

/**
 * 模型偏好选择（P5 设置中心，06 号详设 §5）：大副模型作用于 Router 会话与
 * Mode A/B 新建 worker 会话（createSession config.modelSelection 原生字段）——
 * **下一次建会话生效**（在途会话不热切，避免第二条模型写路径）；清除=回落
 * CLI 缺省模型。
 *
 * 清单构建复用 workflow 子代理模型选择的同一份（useModelSelectionView+
 * buildRegistryModelSelectGroups+encodeCustomModelValue——「两处选同一件事就该是
 * 同一份清单」先例，useWorkflowSettingsModelChoices 文件头）；渲染用轻量原生
 * select（ModelConfigSelect 绑 composer 合并入口，对设置区过重）。
 */
export const MateModelPreference = memo(function MateModelPreference({
  service,
  workspaceKey,
  preference,
}: {
  service: IAssistantTicketService;
  /** 模型清单 resolution 作用域（registry 全局清单；workspace 只影响服务路由）。 */
  workspaceKey: string;
  /** 当前偏好（快照 modelPreference 投影；null=未设置→CLI 缺省）。 */
  preference: { providerId: string; modelId: string; reasoningLevel?: string } | null;
}) {
  const { intl } = useDroraIntl();
  const format = (id: string) => intl.formatMessage({ id });
  const setModelPreference = useMateStore((state) => state.setModelPreference);
  // 保存失败反馈（审查修复 F2，照 MateConfigSection run() 先例）：store 对传输异常
  // 原样上抛（不吞不转义），此处须 catch 落 generic；错误码臂出 role=alert 行。
  const [failure, setFailure] = useState<string | null>(null);
  const modelRead = useModelSelectionView(workspaceKey || undefined);
  const groups = useMemo(
    () =>
      modelRead.state.status === "ready"
        ? buildRegistryModelSelectGroups(DRORA_AGENT_PROVIDER, modelRead.state.view)
        : [],
    [modelRead.state],
  );
  // 编码形态=两参（providerId, modelName）：清单项与当前值同一值域（思考档不进
  // 设置面——选择器不带档位，「换模型取默认思考档」与 workflow 子代理同规则）。
  const currentValue = preference
    ? encodeCustomModelValue(preference.providerId, preference.modelId)
    : "";

  const loading = modelRead.state.status !== "ready";

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-ui-xs text-foreground-subtlest">
        {format("mate.config.model.label")}
      </label>
      <select
        className="rounded border border-input-border bg-transparent px-2 py-1.5 text-ui-sm text-foreground"
        value={currentValue}
        disabled={loading}
        aria-label={format("mate.config.model.label")}
        onChange={(event) => {
          const value = event.target.value;
          // 空值=清除（回落 CLI 缺省）；清单项=decode 出 provider/model（含思考档）。
          if (!value) {
            setModelPreference(service, workspaceKey, null)
              .then((result) => {
                setFailure(result.ok ? null : resolveMateErrorMessageId(result.error));
              })
              .catch(() => setFailure("mate.error.generic"));
            return;
          }
          const decoded = decodeCustomModelValue(value);
          if (decoded?.modelName) {
            void setModelPreference(service, workspaceKey, {
              providerId: decoded.providerId,
              modelId: decoded.modelName,
            })
              .then((result) => {
                setFailure(result.ok ? null : resolveMateErrorMessageId(result.error));
              })
              .catch(() => setFailure("mate.error.generic"));
          }
        }}
      >
        <option value="">
          {loading ? format("mate.config.model.loading") : format("mate.config.model.default")}
        </option>
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.items.map((item) => (
              <option key={item.key} value={item.value}>
                {item.name}
                {item.badgeLabel ? `（${item.badgeLabel}）` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-ui-xs text-foreground-subtlest">
        {format("mate.config.model.hint")}
      </p>
      {failure ? (
        <p role="alert" className="text-ui-xs text-foreground-destructive">
          {format(failure)}
        </p>
      ) : null}
    </div>
  );
});
