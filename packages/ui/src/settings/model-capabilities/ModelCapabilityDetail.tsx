/**
 * 「模型能力」条目详情渲染入口（specs/model-capabilities.md §5.1）。
 *
 * ModelProviderSection 左导航选中 capability:* 节点时由 Detail 分支渲染本组件；
 * 按 purpose 分派到五个条目表单（顺序 = MODEL_CAPABILITY_PURPOSES 契约顺序）。
 * 数据一律经 useModelCapabilities（档案服务唯一读路径）；embedding 状态面与
 * Jev 连接测试复用 knowledgeIndexService（Host 侧既有 RPC 面，语义不变）。
 */
import type { ModelCapabilityPurpose } from "@drora/shared";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { DecisionJevCapabilityForm } from "./DecisionJevCapabilityForm.js";
import { EmbeddingCapabilityForm } from "./EmbeddingCapabilityForm.js";
import { AsrCapabilityForm } from "./AsrCapabilityForm.js";
import { TtsCapabilityForm } from "./TtsCapabilityForm.js";
import { ImageGenerationCapabilityForm } from "./ImageGenerationCapabilityForm.js";

const DETAIL_TITLE_IDS: Record<ModelCapabilityPurpose, string> = {
  "decision-jev": "settings.modelCapability.detail.decisionJev.title",
  embedding: "settings.modelCapability.detail.embedding.title",
  asr: "settings.modelCapability.detail.asr.title",
  tts: "settings.modelCapability.detail.tts.title",
  "image-generation": "settings.modelCapability.detail.imageGeneration.title",
};

export function ModelCapabilityDetail({ purpose }: { purpose: ModelCapabilityPurpose }) {
  const { intl } = useDroraIntl();
  const { service, loading, error } = useModelCapabilities();

  return (
    <div className="space-y-4">
      <h3 className="text-ui-base font-semibold text-foreground">
        {intl.formatMessage({ id: DETAIL_TITLE_IDS[purpose] })}
      </h3>
      {error ? (
        <p role="alert" className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "settings.modelCapability.loadFailed" })}
        </p>
      ) : null}
      {!service ? (
        // 档案是本机桌面 Host 事实（spec §4）：当前 ServiceProvider 未提供档案服务
        //（远端 workspace / 独立 Web）时按 fail-closed 呈现不可用态，不建第二数据源。
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelCapability.unavailable" })}
        </p>
      ) : loading ? (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "common.loading" })}
        </p>
      ) : (
        <ModelCapabilityDetailBody purpose={purpose} />
      )}
    </div>
  );
}

function ModelCapabilityDetailBody({ purpose }: { purpose: ModelCapabilityPurpose }) {
  switch (purpose) {
    case "decision-jev":
      return <DecisionJevCapabilityForm />;
    case "embedding":
      return <EmbeddingCapabilityForm />;
    case "asr":
      return <AsrCapabilityForm />;
    case "tts":
      return <TtsCapabilityForm />;
    case "image-generation":
      return <ImageGenerationCapabilityForm />;
  }
}
