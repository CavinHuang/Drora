import { useMemo, useRef, useState } from "react";
import type { IServiceAccessor } from "@drora/services";
import {
  deriveSessionTeamActivity,
  type CommandAck,
  type CommandEnvelope,
} from "@drora/shared/drora-protocol-v4";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { RemoteConversationTimeline } from "../../src/v4/RemoteConversationTimeline.js";
import { TeamSessionLine } from "../../src/team/TeamSessionLine.js";
import { createTeamFixture } from "./agents-team.fixture.js";

/** 真实手机 UI 装配；服务代理使用 synthetic ACK，不代表 relay/Host 集成证据。 */
export function RemoteTeamFixture() {
  const [scope, setScope] = useState("a");
  const [requests, setRequests] = useState<unknown[]>([]);
  const [opened, setOpened] = useState(0);
  const mode = useRef<"error" | "ok" | "deferred">("error");
  const release = useRef<(() => void) | null>(null);
  const team = useMemo(createTeamFixture, []);
  const services = useMemo(
    () =>
      ({
        droraAgentService: {
          async sendConversationCommandV4(input: {
            workspacePath: string;
            workspaceIdentity?: string;
            envelope: CommandEnvelope;
          }): Promise<CommandAck> {
            setRequests((previous) => [...previous, input]);
            const ack: CommandAck = {
              commandId: input.envelope.commandId,
              status: mode.current === "error" ? "failed" : "accepted",
              revisionAtDecision: 0,
              result: {
                type: "getTeamHistory",
                teamId: team.teamId,
                throughSeq: 1,
                skippedEntries: 0,
                events: [
                  {
                    seq: 1,
                    at: "2026-10-20T00:00:00Z",
                    kind: "resumed",
                    reason: `Saved scope ${scope}`,
                  },
                ],
              },
            };
            if (mode.current === "deferred" && scope === "a")
              await new Promise<void>((resolve) => {
                release.current = resolve;
              });
            return ack;
          },
        },
      }) as unknown as IServiceAccessor,
    [scope, team],
  );
  return (
    <ServiceProvider services={services}>
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <DroraIntlProvider initialLocale="zh-CN">
          <button
            type="button"
            data-testid="remote-task-row"
            onClick={() => setOpened((value) => value + 1)}
          >
            Open task
            <TeamSessionLine activity={deriveSessionTeamActivity(team)} />
          </button>
        </DroraIntlProvider>
        <output data-testid="remote-opened">{opened}</output>
        <output data-testid="remote-requests">{JSON.stringify(requests)}</output>
        <button
          type="button"
          data-testid="remote-recover"
          onClick={() => {
            mode.current = "ok";
          }}
        >
          Recover
        </button>
        <button
          type="button"
          data-testid="remote-delay"
          onClick={() => {
            mode.current = "deferred";
          }}
        >
          Delay
        </button>
        <button type="button" data-testid="remote-switch" onClick={() => setScope("b")}>
          Switch scope
        </button>
        <button type="button" data-testid="remote-release" onClick={() => release.current?.()}>
          Release old ACK
        </button>
        <RemoteConversationTimeline
          rows={[]}
          totalCount={0}
          sessionKey={`lead-${scope}`}
          workspacePath="/same-path"
          workspaceIdentity={`host-${scope}/team-workspace`}
          locale="zh-CN"
          theme="light"
          statusSnapshot={{ team }}
        />
      </div>
    </ServiceProvider>
  );
}
