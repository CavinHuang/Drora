/* OMCP-011 相关 —— 官方 MCP 身份头协议 schema（spec §7.2）。
   请求侧不得携带任何秘密；响应侧失败原因必须可枚举且无自由文本。 */
import { describe, expect, it } from "vitest";
import {
  droraOfficialMcpAuthHeadersRequestParamsSchema,
  droraOfficialMcpAuthHeadersResponseSchema,
  droraProtocolMethods,
} from "../src/drora-protocol/index.js";

const VALID_REQUEST = {
  mcpKey: "image-search",
  pluginId: "drora-tools@drora-plugins-official",
  requestId: "mcp-auth-1",
  targetOrigin: "https://mcp.drora.example",
  workspace: { workspaceKey: "local:/repo", workspacePath: "/repo" },
};

describe("official mcp auth headers protocol", () => {
  it("registers the reverse request under the interaction namespace", () => {
    expect(droraProtocolMethods.interactionRequestOfficialMcpAuthHeaders).toBe(
      "interaction/requestOfficialMcpAuthHeaders",
    );
  });

  it("accepts a minimal request and a remote workspace identity", () => {
    expect(droraOfficialMcpAuthHeadersRequestParamsSchema.parse(VALID_REQUEST)).toMatchObject({
      mcpKey: "image-search",
      targetOrigin: "https://mcp.drora.example",
    });
    expect(
      droraOfficialMcpAuthHeadersRequestParamsSchema.safeParse({
        ...VALID_REQUEST,
        workspace: {
          workspaceIdentity: "ssh:host/repo",
          workspaceKey: "ssh:host/repo",
          workspacePath: "/repo",
        },
      }).success,
    ).toBe(true);
  });

  it("is strict, so a smuggled credential field is rejected", () => {
    for (const extra of [
      { jwt: "leaked" },
      { headers: { Authorization: "Bearer leaked" } },
      { codingPlanApiKey: "leaked" },
    ]) {
      expect(
        droraOfficialMcpAuthHeadersRequestParamsSchema.safeParse({ ...VALID_REQUEST, ...extra })
          .success,
      ).toBe(false);
    }
  });

  it("requires every identifying field to be a non-empty string", () => {
    for (const field of ["mcpKey", "pluginId", "requestId", "targetOrigin"]) {
      expect(
        droraOfficialMcpAuthHeadersRequestParamsSchema.safeParse({
          ...VALID_REQUEST,
          [field]: "",
        }).success,
      ).toBe(false);
    }
  });

  it("accepts both response branches", () => {
    expect(
      droraOfficialMcpAuthHeadersResponseSchema.parse({
        headers: { Authorization: "Bearer jwt", "Bigmodel-Target-Type": "TEAM" },
        ok: true,
      }),
    ).toMatchObject({ ok: true });
    for (const reason of ["official_auth_unavailable", "official_auth_plan_required"]) {
      expect(
        droraOfficialMcpAuthHeadersResponseSchema.parse({ ok: false, reason }),
      ).toMatchObject({ ok: false, reason });
    }
  });

  it("rejects unknown reasons, free-text errors and cross-branch fields", () => {
    const invalid = [
      { ok: false, reason: "start_plan_not_supported" },
      { ok: false, reason: "official_auth_rejected" },
      { errorMessage: "something went wrong", ok: false, reason: "official_auth_unavailable" },
      { headers: {}, ok: false, reason: "official_auth_unavailable" },
      { ok: true, reason: "official_auth_unavailable" },
      { ok: true },
    ];
    for (const value of invalid) {
      expect(droraOfficialMcpAuthHeadersResponseSchema.safeParse(value).success).toBe(false);
    }
  });
});
