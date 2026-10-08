// 第 48 轮：Claude Code 兼容「输出风格」服务回归测试（官方 pf/bG/uf/lke 逆向语义）。
// 覆盖：getActive/setActive 的 settings.json merge、内置三档逐字断言与 enabled 标记、
// 自定义档排序与坏文件容错、add/update/delete 的 id 前缀与平铺写盘格式、
// parse 的 name 回落链（头缺失 → 文件名 → "Custom Style"）。
// HOME 注入临时目录：官方 resolveUserHomeDir = env.HOME || USERPROFILE，
// 服务按调用时进程环境取 HOME，测试改写 process.env.HOME 即可隔离 ~/.claude。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createOutputStyleService } from "../src/outputStyle/outputStyleService.ts";

async function createIsolatedHome() {
  const originalHome = process.env.HOME;
  const homeDir = await mkdtemp(join(tmpdir(), "drora-output-style-"));
  process.env.HOME = homeDir;
  return {
    homeDir,
    claudeDir: join(homeDir, ".claude"),
    stylesDir: join(homeDir, ".claude", "output-styles"),
    settingsPath: join(homeDir, ".claude", "settings.json"),
    restore() {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      return rm(homeDir, { recursive: true, force: true });
    },
  };
}

test("getActiveStyle: settings.json 缺省或非 JSON 时返回 null", async () => {
  const home = await createIsolatedHome();
  try {
    const service = createOutputStyleService();
    assert.deepEqual(await service.getActiveStyle(), { styleId: null });

    await mkdir(home.claudeDir, { recursive: true });
    await writeFile(home.settingsPath, "not-json{", "utf8");
    assert.deepEqual(await service.getActiveStyle(), { styleId: null });
  } finally {
    await home.restore();
  }
});

test("setActiveStyle: merge 写 settings.json 并保留其它字段", async () => {
  const home = await createIsolatedHome();
  try {
    await mkdir(home.claudeDir, { recursive: true });
    await writeFile(
      home.settingsPath,
      JSON.stringify({ theme: "dark", outputStyle: "learning" }),
      "utf8",
    );
    const service = createOutputStyleService();

    await service.setActiveStyle({ styleId: "custom-my-style" });
    const merged = JSON.parse(await readFile(home.settingsPath, "utf8"));
    assert.equal(merged.theme, "dark", "merge 写入应保留其它字段");
    assert.equal(merged.outputStyle, "custom-my-style");
    assert.deepEqual(await service.getActiveStyle(), { styleId: "custom-my-style" });

    await service.setActiveStyle({ styleId: null });
    assert.equal(JSON.parse(await readFile(home.settingsPath, "utf8")).outputStyle, null);
    assert.deepEqual(await service.getActiveStyle(), { styleId: null });
  } finally {
    await home.restore();
  }
});

test("setActiveStyle: ~/.claude 不存在时先创建目录", async () => {
  const home = await createIsolatedHome();
  try {
    const service = createOutputStyleService();
    await service.setActiveStyle({ styleId: "default" });
    const merged = JSON.parse(await readFile(home.settingsPath, "utf8"));
    assert.equal(merged.outputStyle, "default");
  } finally {
    await home.restore();
  }
});

test("listStyles: 内置三档逐字对齐且 active 缺省 default", async () => {
  const home = await createIsolatedHome();
  try {
    const { styles } = await createOutputStyleService().listStyles();
    assert.equal(styles.length, 3);
    assert.deepEqual(styles[0], {
      id: "default",
      name: "Default",
      description: "Claude completes coding tasks efficiently and provides concise responses",
      content: "",
      isBuiltIn: true,
      enabled: true,
    });
    assert.deepEqual(styles[1], {
      id: "explanatory",
      name: "Explanatory",
      description: "Claude explains its implementation choices and codebase patterns",
      content: "",
      isBuiltIn: true,
      enabled: false,
    });
    assert.deepEqual(styles[2], {
      id: "learning",
      name: "Learning",
      description: "Claude pauses and asks you to write small pieces of code for hands-on practice",
      content: "",
      isBuiltIn: true,
      enabled: false,
    });
  } finally {
    await home.restore();
  }
});

test("listStyles: enabled 跟随 settings.json 的 active 档", async () => {
  const home = await createIsolatedHome();
  try {
    await mkdir(home.claudeDir, { recursive: true });
    await writeFile(home.settingsPath, JSON.stringify({ outputStyle: "explanatory" }), "utf8");
    const { styles } = await createOutputStyleService().listStyles();
    assert.equal(styles.find((s) => s.id === "explanatory").enabled, true);
    assert.equal(styles.find((s) => s.id === "default").enabled, false);
  } finally {
    await home.restore();
  }
});

test("listStyles: 自定义档按 name localeCompare 排序、enabled 标记、坏文件容错", async () => {
  const home = await createIsolatedHome();
  try {
    await mkdir(home.stylesDir, { recursive: true });
    await writeFile(
      join(home.stylesDir, "zeta.md"),
      "name: Bravo\ndescription: second\n\nBravo body",
      "utf8",
    );
    await writeFile(
      join(home.stylesDir, "alpha.md"),
      "name: Alpha\ndescription: first\n\nAlpha body",
      "utf8",
    );
    await writeFile(
      home.settingsPath,
      JSON.stringify({ outputStyle: "custom-zeta" }),
      "utf8",
    );
    // 坏文件容错：同名目录触发读取失败（EISDIR），官方语义是记录后跳过。
    await mkdir(join(home.stylesDir, "bad.md"));

    const { styles } = await createOutputStyleService().listStyles();
    const custom = styles.filter((s) => !s.isBuiltIn);
    assert.equal(custom.length, 2, "读取失败的 bad.md 应被跳过");
    assert.deepEqual(
      custom.map((s) => s.name),
      ["Alpha", "Bravo"],
      "自定义按 name localeCompare 排序",
    );
    const bravo = custom.find((s) => s.id === "custom-zeta");
    assert.equal(bravo.description, "second");
    assert.equal(bravo.enabled, true, "active 自定义档 enabled");
    assert.equal(bravo.filePath, join(home.stylesDir, "zeta.md"));
    assert.equal(styles.find((s) => s.id === "default").enabled, false, "激活自定义时内置档关闭");
  } finally {
    await home.restore();
  }
});

test("addStyle: name slug 文件名 + 官方平铺格式写盘 + 回读 parse", async () => {
  const home = await createIsolatedHome();
  try {
    const service = createOutputStyleService();
    await service.addStyle({
      config: { name: "My Cool Style", description: "a desc", content: "Be very terse." },
    });
    const filePath = join(home.stylesDir, "my-cool-style.md");
    const raw = await readFile(filePath, "utf8");
    // 官方模板 `name: ${name}\ndescription: ${description}\n\n${content}`（平铺头，无围栏）。
    assert.equal(raw, "name: My Cool Style\ndescription: a desc\n\nBe very terse.");
    const directory = await service.getUserStylesDirectory();
    assert.equal(directory.path, home.stylesDir);
    assert.ok(
      (await readdir(home.stylesDir)).includes("my-cool-style.md"),
      "getUserStylesDirectory 应已创建目录",
    );

    const { styles } = await service.listStyles();
    const added = styles.find((s) => s.id === "custom-my-cool-style");
    assert.equal(added.name, "My Cool Style");
    assert.equal(added.description, "a desc");
    assert.equal(added.content, raw, "content 保持文件原文（头 + prompt 正文）");
    assert.equal(added.isBuiltIn, false);
  } finally {
    await home.restore();
  }
});

test("updateStyle / deleteStyle: id 去 custom- 前缀定位文件", async () => {
  const home = await createIsolatedHome();
  try {
    const service = createOutputStyleService();
    await service.addStyle({
      config: { name: "Old Name", description: "old", content: "old body" },
    });

    await service.updateStyle({
      id: "custom-old-name",
      config: { name: "New Name", description: "new", content: "new body" },
    });
    const updatedRaw = await readFile(join(home.stylesDir, "old-name.md"), "utf8");
    assert.equal(updatedRaw, "name: New Name\ndescription: new\n\nnew body");
    const { styles } = await service.listStyles();
    assert.equal(styles.find((s) => s.id === "custom-old-name").description, "new");

    await service.deleteStyle({ id: "custom-old-name" });
    assert.deepEqual(
      (await createOutputStyleService().listStyles()).styles.filter((s) => !s.isBuiltIn),
      [],
      "删除后自定义列表为空",
    );
  } finally {
    await home.restore();
  }
});

test("parse 回落链: 无 name 头 → 文件名去 .md → 'Custom Style'", async () => {
  const home = await createIsolatedHome();
  try {
    await mkdir(home.stylesDir, { recursive: true });
    await writeFile(join(home.stylesDir, "fallback.md"), "Just a prompt body.", "utf8");
    await writeFile(join(home.stylesDir, ".md"), "No headers at all.", "utf8");

    const { styles } = await createOutputStyleService().listStyles();
    const fallback = styles.find((s) => s.id === "custom-fallback");
    assert.equal(fallback.name, "fallback", "name 缺省回落文件名去 .md");
    assert.equal(fallback.description, "");
    const edge = styles.find((s) => s.id === "custom-");
    assert.equal(edge.name, "Custom Style", "文件名去 .md 仍为空时回落 Custom Style");
  } finally {
    await home.restore();
  }
});
