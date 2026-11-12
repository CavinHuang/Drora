// hostComponents 唯一写方落盘（specs/obsidian-vault-plugin-extraction.md §3 D1a，B1）：
// updateHostComponentsInFileConfig 原子写 plugins.hostComponents（键名引用 shared
// DRORA_PLUGINS_CONFIG_KEYS 单一出处），不触碰 enabledPlugins/options/suppressedBuiltins；
// 存储路径基迁移断言（shared 常量 → getDefaultConfigPath 拼出 ~/.drora/cli/config.json）。
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRORA_PLUGIN_CONFIG_BASE_DIR,
  DRORA_PLUGIN_CONFIG_FILE_NAME,
  DRORA_PLUGINS_CONFIG_KEYS,
  DRORA_PLUGIN_HOST_COMPONENTS_DEFAULT,
} from "@drora/shared";
import {
  getDefaultConfigPath,
  updateHostComponentsInFileConfig,
} from "../src/config/file-config.adapter.js";

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "drora-host-components-"));
  return join(dir, "config.json");
}

describe("updateHostComponentsInFileConfig（hostComponents 唯一写方）", () => {
  it("写入 false：只改 plugins.hostComponents，其余键原样保留", async () => {
    const path = await tempConfigPath();
    await writeFile(
      path,
      `${JSON.stringify(
        {
          ui: { locale: "zh-CN" },
          plugins: {
            enabledPlugins: { "demo@inline": true },
            options: { "demo@inline": { verbose: true } },
            suppressedBuiltins: [],
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const result = await updateHostComponentsInFileConfig(path, false);
    expect(result).toEqual({ enabled: false, path });

    const saved = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const plugins = saved.plugins as Record<string, unknown>;
    // 键名来自 shared 单一出处：断言写的是 DRORA_PLUGINS_CONFIG_KEYS.hostComponents 键。
    expect(plugins[DRORA_PLUGINS_CONFIG_KEYS.hostComponents]).toBe(false);
    // 不与 hooks 启用位混写：enabledPlugins/options/suppressedBuiltins 原样。
    expect(plugins.enabledPlugins).toEqual({ "demo@inline": true });
    expect(plugins.options).toEqual({ "demo@inline": { verbose: true } });
    expect(plugins.suppressedBuiltins).toEqual([]);
    // 非插件配置不受影响。
    expect(saved.ui).toEqual({ locale: "zh-CN" });
  });

  it("写入 true：开关可重新打开", async () => {
    const path = await tempConfigPath();
    await updateHostComponentsInFileConfig(path, false);
    await updateHostComponentsInFileConfig(path, true);
    const saved = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const plugins = saved.plugins as Record<string, unknown>;
    expect(plugins[DRORA_PLUGINS_CONFIG_KEYS.hostComponents]).toBe(true);
  });

  it("配置文件缺失时创建仅含开关的合法配置（原子 temp+rename 同链路）", async () => {
    const path = await tempConfigPath();
    const result = await updateHostComponentsInFileConfig(path, false);
    expect(result.enabled).toBe(false);
    const saved = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    expect(saved).toEqual({ plugins: { hostComponents: false } });
  });
});

describe("启用状态存储契约单一出处（shared 契约区）", () => {
  it("存储路径基：shared 常量与 getDefaultConfigPath 拼出同一路径", () => {
    // 迁移断言（spec §3 B1）：基目录/文件名定义已上移 shared，adapters 侧引用同一常量。
    expect(DRORA_PLUGIN_CONFIG_BASE_DIR).toBe("~/.drora/cli");
    expect(DRORA_PLUGIN_CONFIG_FILE_NAME).toBe("config.json");
    expect(getDefaultConfigPath()).toBe(
      join(homedir(), ".drora", "cli", DRORA_PLUGIN_CONFIG_FILE_NAME),
    );
  });

  it("键名单一出处：hostComponents 新键与既有启用状态键同表", () => {
    expect(DRORA_PLUGINS_CONFIG_KEYS).toEqual({
      enabledPlugins: "enabledPlugins",
      suppressedBuiltins: "suppressedBuiltins",
      hostComponents: "hostComponents",
    });
    // D1a：缺省在场（不写键即 true）。
    expect(DRORA_PLUGIN_HOST_COMPONENTS_DEFAULT).toBe(true);
  });
});
