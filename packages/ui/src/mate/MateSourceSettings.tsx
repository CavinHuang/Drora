import { memo, useEffect, useState } from "react";
import type { IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useMateStore } from "@/store/mateStore.js";
import { resolveMateErrorMessageId } from "./view-model.js";

/** Source 开关配置的 UI 草稿形态（与服务 MateSourcesConfig 同形；保存=整体替换）。 */
interface SourcesDraft {
  feishuEnabled: boolean;
  phoneEnabled: boolean;
  githubEnabled: boolean;
  githubRepo: string;
  githubMentionName: string;
}

function draftFromConfig(
  config:
    | {
        feishu?: { enabled?: boolean };
        phone?: { enabled?: boolean };
        github?: { enabled?: boolean; repo?: string; mentionName?: string };
      }
    | undefined,
): SourcesDraft {
  return {
    feishuEnabled: config?.feishu?.enabled === true,
    phoneEnabled: config?.phone?.enabled === true,
    githubEnabled: config?.github?.enabled === true,
    githubRepo: config?.github?.repo ?? "",
    githubMentionName: config?.github?.mentionName ?? "",
  };
}

/**
 * Source 设置区（P5 设置中心，06 号详设 §5）：三 Source 开关+GitHub repo/点名词+
 * 身份映射行编辑。保存走服务 setter（publish 即 reconcile——启停即时生效，06 §2）；
 * 身份映射键值非空/≤50 条的 bounds 在服务侧 fail-closed，本地只做去空白与行管理。
 * GitHub PAT 不在此面（凭据走 credentialService 域，提示文案指引）。
 */
export const MateSourceSettings = memo(function MateSourceSettings({
  service,
  workspaceKey,
  sourcesConfig,
  identityMap,
}: {
  service: IAssistantTicketService;
  workspaceKey: string;
  sourcesConfig:
    | {
        feishu?: { enabled?: boolean };
        phone?: { enabled?: boolean };
        github?: { enabled?: boolean; repo?: string; mentionName?: string };
      }
    | undefined;
  identityMap:
    | { feishu?: Readonly<Record<string, string>>; github?: Readonly<Record<string, string>> }
    | undefined;
}) {
  const { intl } = useDroraIntl();
  const format = (id: string) => intl.formatMessage({ id });
  const setSourcesConfig = useMateStore((state) => state.setSourcesConfig);
  const setSourceIdentityMap = useMateStore((state) => state.setSourceIdentityMap);

  const [draft, setDraft] = useState<SourcesDraft>(() => draftFromConfig(sourcesConfig));
  // 映射草稿按 kind 分组（MateSourceIdentityMap 嵌套形态；保存时整体替换）。
  const [mapDraft, setMapDraft] = useState<{
    feishu: ReadonlyArray<[string, string]>;
    github: ReadonlyArray<[string, string]>;
  }>(() => ({
    feishu: Object.entries(identityMap?.feishu ?? {}),
    github: Object.entries(identityMap?.github ?? {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  // 快照回填（未 dirty 时跟随服务事实源；照 MateConfigSection quotaDraft 纪律）。
  useEffect(() => {
    setDraft(draftFromConfig(sourcesConfig));
  }, [sourcesConfig]);
  useEffect(() => {
    setMapDraft({
      feishu: Object.entries(identityMap?.feishu ?? {}),
      github: Object.entries(identityMap?.github ?? {}),
    });
  }, [identityMap]);

  const save = async (): Promise<void> => {
    setError(null);
    const configResult = await setSourcesConfig(service, workspaceKey, {
      feishu: { enabled: draft.feishuEnabled },
      phone: { enabled: draft.phoneEnabled },
      github: {
        enabled: draft.githubEnabled,
        ...(draft.githubRepo.trim() ? { repo: draft.githubRepo.trim() } : {}),
        ...(draft.githubMentionName.trim()
          ? { mentionName: draft.githubMentionName.trim() }
          : {}),
      },
    });
    if (!configResult.ok) {
      setError(
        format(resolveMateErrorMessageId(configResult.error)) ||
          configResult.error.reason ||
          configResult.error.code,
      );
      return;
    }
    const map: { feishu?: Record<string, string>; github?: Record<string, string> } = {};
    for (const kind of ["feishu", "github"] as const) {
      const table: Record<string, string> = {};
      for (const [externalId, identity] of mapDraft[kind]) {
        const key = externalId.trim();
        const value = identity.trim();
        if (key && value) table[key] = value;
      }
      if (Object.keys(table).length > 0) map[kind] = table;
    }
    const mapResult = await setSourceIdentityMap(service, workspaceKey, map);
    if (!mapResult.ok) {
      setError(
        format(resolveMateErrorMessageId(mapResult.error)) ||
          mapResult.error.reason ||
          mapResult.error.code,
      );
      return;
    }
    setSavedAt(Date.now());
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-ui-xs text-foreground-subtlest">
          {format("mate.config.source.title")}
        </label>
        <span
          role="status"
          className={savedAt > 0 ? "text-[11px] text-[var(--mate-fg-secondary)]" : "hidden"}
        >
          {format("mate.config.source.saved")}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm text-foreground">
          {format("mate.config.source.feishu")}
        </span>
        <Switch
          checked={draft.feishuEnabled}
          onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, feishuEnabled: checked }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm text-foreground">
          {format("mate.config.source.phone")}
        </span>
        <Switch
          checked={draft.phoneEnabled}
          onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, phoneEnabled: checked }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm text-foreground">
          {format("mate.config.source.github")}
        </span>
        <Switch
          checked={draft.githubEnabled}
          onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, githubEnabled: checked }))}
        />
      </div>
      {draft.githubEnabled ? (
        <div className="flex flex-col gap-1.5 pl-1" data-testid="mate-github-fields">
          <input
            className="rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none"
            placeholder={format("mate.config.source.githubRepo")}
            value={draft.githubRepo}
            aria-label={format("mate.config.source.githubRepo")}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, githubRepo: event.target.value }))
            }
          />
          <input
            className="rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none"
            placeholder={format("mate.config.source.githubMention")}
            value={draft.githubMentionName}
            aria-label={format("mate.config.source.githubMention")}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, githubMentionName: event.target.value }))
            }
          />
          <p className="text-ui-xs text-foreground-subtlest">
            {format("mate.config.source.githubPatHint")}
          </p>
        </div>
      ) : null}

      <label className="mt-1 text-ui-xs text-foreground-subtlest">
        {format("mate.config.source.identityMap")}
      </label>
      <div className="flex flex-col gap-2" data-testid="mate-identity-map">
        {(["feishu", "github"] as const).map((kind) => (
          <div key={kind} className="flex flex-col gap-1.5" data-testid={`mate-identity-map-${kind}`}>
            <span className="text-ui-xs text-foreground-subtlest">
              {format(kind === "feishu" ? "mate.config.source.feishu" : "mate.config.source.github")}
            </span>
            {mapDraft[kind].map(([externalId, identity], index) => (
              <div key={`identity-${kind}-${index}`} className="flex items-center gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none"
                  placeholder={format("mate.config.source.externalId")}
                  value={externalId}
                  aria-label={format("mate.config.source.externalId")}
                  onChange={(event) =>
                    setMapDraft((prev) => ({
                      ...prev,
                      [kind]: prev[kind].map((row, i) =>
                        i === index ? [event.target.value, row[1]] : row,
                      ),
                    }))
                  }
                />
                <span className="text-ui-xs text-foreground-subtlest">→</span>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none"
                  placeholder={format("mate.config.source.localIdentity")}
                  value={identity}
                  aria-label={format("mate.config.source.localIdentity")}
                  onChange={(event) =>
                    setMapDraft((prev) => ({
                      ...prev,
                      [kind]: prev[kind].map((row, i) =>
                        i === index ? [row[0], event.target.value] : row,
                      ),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={format("mate.config.source.removeRow")}
                  onClick={() =>
                    setMapDraft((prev) => ({
                      ...prev,
                      [kind]: prev[kind].filter((_, i) => i !== index),
                    }))
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setMapDraft((prev) => ({ ...prev, [kind]: [...prev[kind], ["", ""]] }))
              }
            >
              + {format("mate.config.source.addRow")}
            </Button>
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-ui-xs text-foreground-destructive">
          {error}
        </p>
      ) : null}
      <Button size="sm" className="self-start" onClick={() => void save()}>
        {format("mate.config.source.save")}
      </Button>
    </div>
  );
});
