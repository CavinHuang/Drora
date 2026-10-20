import { describe, expect, it } from "vitest";
import {
  convertToDroraAgentMcpServer,
  isDroraCuaMcpCommand,
  isDroraCuaMcpPackageArg,
} from "../src/mcp.js";

describe("drora-cua MCP matcher (single source of truth for services + CLI bootstrap)", () => {
  it("matches the drora-cua command by leaf name", () => {
    expect(isDroraCuaMcpCommand("drora-cua")).toBe(true);
    expect(isDroraCuaMcpCommand("/opt/homebrew/bin/drora-cua")).toBe(true);
    expect(isDroraCuaMcpCommand("uvx")).toBe(false);
    expect(isDroraCuaMcpCommand("drora-cua-server")).toBe(false);
  });

  it("matches uvx/pip package spec forms", () => {
    for (const arg of [
      "drora-cua",
      "drora-cua[macos]",
      "drora-cua@v0.1.3",
      "drora-cua[macos]@v0.1.3",
    ]) {
      expect(isDroraCuaMcpPackageArg(arg)).toBe(true);
    }
  });

  it("matches git and local-path forms (the drift that broke desktop/services parity)", () => {
    expect(isDroraCuaMcpPackageArg("drora-cua.git")).toBe(true);
    expect(isDroraCuaMcpPackageArg("git+https://github.com/x/drora-cua.git@v0.1.3")).toBe(true);
    expect(isDroraCuaMcpPackageArg("/Users/me/src/drora-cua")).toBe(true);
    expect(isDroraCuaMcpPackageArg("C:\\src\\drora-cua")).toBe(true);
  });

  it("does not match unrelated args", () => {
    for (const arg of ["--from", "run", "drora-cua-server", "not-drora-cua", "server.js"]) {
      expect(isDroraCuaMcpPackageArg(arg)).toBe(false);
    }
  });

  it("recognizes a package spec placed in COMMAND position (command/arg matchers stay consistent)", () => {
    // 之前 command matcher 只认精确叶子 drora-cua，会漏判把包规格直接当 command 的配置 → 漏注入 broker。
    for (const command of [
      "drora-cua@1.2.3",
      "drora-cua[macos]",
      "drora-cua.git",
      "/opt/tools/drora-cua@1.2.3",
    ]) {
      expect(isDroraCuaMcpCommand(command), command).toBe(true);
    }
  });

  it("recognizes pip == pins and the drora_cua underscore distribution name (PyPI treats _ == -)", () => {
    for (const arg of ["drora-cua==1.2.3", "drora_cua", "drora_cua==1.2.3", "drora_cua@v0.1.3"]) {
      expect(isDroraCuaMcpPackageArg(arg), arg).toBe(true);
    }
    expect(isDroraCuaMcpCommand("drora_cua")).toBe(true);
  });

  it("does not false-positive on sibling packages like drora-cua-proxy", () => {
    for (const value of ["drora-cua-proxy", "drora-cua-proxy@1.0.0", "drora-cua-helper"]) {
      expect(isDroraCuaMcpCommand(value), value).toBe(false);
      expect(isDroraCuaMcpPackageArg(value), value).toBe(false);
    }
  });

  it("recognizes `python -m drora_cua.server` submodule form (M1 fail-open fix)", () => {
    // `python -m drora_cua.server` → arg 是 `drora_cua.server`；旧 matcher 漏判 → 不注入 broker → fail-open。
    for (const arg of [
      "drora_cua.server",
      "drora-cua.server",
      "drora_cua.main",
      "drora-cua.__main__",
    ]) {
      expect(isDroraCuaMcpPackageArg(arg), arg).toBe(true);
    }
  });

  it("recognizes local paths with a trailing separator (M1 fail-open fix)", () => {
    // `.../drora-cua/` 直接取叶子会得到空串 → 漏判 → fail-open。
    expect(isDroraCuaMcpPackageArg("/Users/me/src/drora-cua/")).toBe(true);
    expect(isDroraCuaMcpPackageArg("C:\\src\\drora-cua\\")).toBe(true);
    expect(isDroraCuaMcpCommand("/opt/homebrew/bin/drora-cua/")).toBe(true);
    // 但带尾斜杠的 sibling 仍不误判。
    expect(isDroraCuaMcpPackageArg("/Users/me/src/drora-cua-proxy/")).toBe(false);
  });
});

describe("MCP config helpers", () => {
  it("passes legacy http_headers through to Drora Agent MCP servers", () => {
    expect(
      convertToDroraAgentMcpServer("web-search-prime", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 5000,
        http_headers: {
          Authorization: "Bearer token",
        },
      }),
    ).toEqual({
      name: "web-search-prime",
      type: "http",
      url: "https://bigmodel.example.test/mcp",
      headers: [{ name: "Authorization", value: "Bearer token" }],
      timeoutMs: 5000,
    });
  });

  it("preserves timeoutMs when converting stdio MCP servers for Drora Agent", () => {
    expect(
      convertToDroraAgentMcpServer("context7", {
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        timeoutMs: 3,
      }),
    ).toEqual({
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: [],
      timeoutMs: 3,
    });
  });

  it("preserves timeoutMs when converting sse MCP servers for Drora Agent", () => {
    expect(
      convertToDroraAgentMcpServer("stream", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        timeoutMs: 8000,
      }),
    ).toEqual({
      name: "stream",
      type: "sse",
      url: "https://bigmodel.example.test/sse",
      headers: [],
      timeoutMs: 8000,
    });
  });

  it("preserves HTTP OAuth client credentials when converting MCP servers for Drora Agent", () => {
    expect(
      convertToDroraAgentMcpServer("protected", {
        type: "http",
        url: "https://mcp.example.test/mcp",
        oauth: {
          type: "client_credentials",
          clientId: "drora-client",
          clientSecret: "secret",
          scope: "mcp:tools",
        },
      }),
    ).toMatchObject({
      name: "protected",
      type: "http",
      oauth: {
        type: "client_credentials",
        clientId: "drora-client",
        clientSecret: "secret",
        scope: "mcp:tools",
      },
    });
  });

  it("preserves HTTP OAuth authorization code config when converting MCP servers for Drora Agent", () => {
    expect(
      convertToDroraAgentMcpServer("figma", {
        type: "http",
        url: "https://mcp.figma.com/mcp",
        oauth: {
          type: "authorization_code",
          clientName: "Drora",
          redirectPath: "/oauth/callback/mcp/figma",
          scope: "mcp:connect",
        },
      }),
    ).toMatchObject({
      name: "figma",
      type: "http",
      oauth: {
        type: "authorization_code",
        clientName: "Drora",
        redirectPath: "/oauth/callback/mcp/figma",
        scope: "mcp:connect",
      },
    });
  });

  it("does not persist implicit OAuth defaults when converting bare HTTP MCP servers", () => {
    expect(
      convertToDroraAgentMcpServer("notion", {
        type: "http",
        url: "https://mcp.notion.com/mcp",
        timeoutMs: 30000,
      }),
    ).toEqual({
      name: "notion",
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: [],
      timeoutMs: 30000,
    });
  });

  it("drops invalid timeoutMs when converting MCP servers for Drora Agent", () => {
    expect(
      convertToDroraAgentMcpServer("zero", {
        type: "stdio",
        command: "npx",
        timeoutMs: 0,
      }),
    ).not.toHaveProperty("timeoutMs");

    expect(
      convertToDroraAgentMcpServer("fractional", {
        type: "http",
        url: "https://bigmodel.example.test/mcp",
        timeoutMs: 1.5,
      }),
    ).not.toHaveProperty("timeoutMs");
  });

  it("keeps headers ahead of legacy http_headers when both are present", () => {
    expect(
      convertToDroraAgentMcpServer("web-reader", {
        type: "sse",
        url: "https://bigmodel.example.test/sse",
        headers: {
          Authorization: "Bearer fresh",
        },
        http_headers: {
          Authorization: "Bearer stale",
        },
      }),
    ).toMatchObject({
      headers: [{ name: "Authorization", value: "Bearer fresh" }],
    });
  });
});
