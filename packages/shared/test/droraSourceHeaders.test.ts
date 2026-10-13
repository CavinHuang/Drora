import { describe, expect, it } from "vitest";
import {
  buildDroraSourceHeadersFromContext,
  DRORA_SOURCE_HEADERS,
} from "../src/drora-source-headers.js";

describe("buildDroraSourceHeadersFromContext", () => {
  it("builds the shared Drora endpoint attribution headers", () => {
    expect(
      buildDroraSourceHeadersFromContext({
        appVersion: " 2.14.0 ",
        arch: "arm64",
        clientLanguage: "zh-CN",
        clientTimezone: "Asia/Shanghai",
        deviceMid: "mid-1",
        endpointOrigin: "https://zcode.z.ai",
        osVersion: "Darwin 25.0.0",
        platform: "darwin",
        releaseChannel: "test",
        sourceTitle: "cli",
      }),
    ).toEqual({
      ...DRORA_SOURCE_HEADERS,
      "HTTP-Referer": "https://zcode.z.ai",
      "User-Agent": "Drora/2.14.0",
      "X-Zcode-App-Version": "2.14.0",
      "X-Title": "Z Code@cli",
      "X-Platform": "darwin-arm64",
      "X-Release-Channel": "test",
      "X-Client-Language": "zh-CN",
      "X-Client-Timezone": "Asia/Shanghai",
      "X-Os-Category": "macos",
      "X-Os-Version": "Darwin 25.0.0",
      "X-Device-Mid": "mid-1",
    });
  });

  it("drops invalid optional values without emitting malformed headers", () => {
    const headers = buildDroraSourceHeadersFromContext({
      appVersion: "bad\nversion",
      clientLanguage: "\n",
      clientTimezone: "",
      deviceMid: "bad\nmid",
      platform: "win32",
      sourceTitle: "electron",
    });

    expect(headers).toMatchObject({
      "User-Agent": "Drora/unknown",
      "X-Client-Language": "unknown",
      "X-Client-Timezone": "unknown",
      "X-Os-Category": "windows",
      "X-Title": "Z Code@electron",
    });
    expect(headers).not.toHaveProperty("X-Device-Mid");
    expect(headers).not.toHaveProperty("X-Zcode-App-Version");
  });
});
