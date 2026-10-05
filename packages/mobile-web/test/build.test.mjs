// R3 P2a 构建验收（specs/mobile-relay-r3-frontend.md §13）：
// - dist 形状：官方路径形状入口 + 资产图闭合 + 无官方 URL 字面量 / sourceMappingURL；
// - i18n 同构：zh-CN / en-US 键集一致（D6 本地化验收面）；
// - 源码边界：src/ui、src/intl 自包含，任务面仅经公开入口复用 UI 时间线。
// 纯 node 运行（package.json test 脚本无 tsx loader），TS 字典按文本解析键集。
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(packageRoot, "dist", "remote", "v4", "index.html");
const distAssets = join(packageRoot, "dist", "remote", "v4", "3.14.3", "assets");

test("dist：官方路径形状入口存在", async () => {
  const info = await stat(distEntry);
  assert.ok(info.isFile());
});

test("dist：资产图闭合（入口引用全部存在）且无违面字面量", async () => {
  const entry = await readFile(distEntry, "utf8");
  // P4a E2E 实证（spec §17）：入口在 /remote/v4（无尾斜杠）下服务，相对引用会解析
  // 到 /remote/ 下丢 v4 段——必须为绝对官方形状引用。
  const refs = [...entry.matchAll(/(?:src|href)="(\/remote\/v4\/3\.14\.3\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(refs.length >= 2, `entry should reference >=2 assets, got ${refs.length}`);
  const assetNames = new Set(await readdir(distAssets));
  for (const ref of refs) {
    const name = ref.slice("/remote/v4/3.14.3/assets/".length);
    assert.ok(assetNames.has(name), `missing referenced asset: ${name}`);
  }
  for (const name of assetNames) {
    const text = await readFile(join(distAssets, name), "utf8");
    assert.equal(text.includes("zcode.z.ai"), false, `${name} contains official relay URL`);
    assert.equal(text.includes("sourceMappingURL"), false, `${name} contains sourcemap comment`);
  }
  assert.equal(entry.includes("zcode.z.ai"), false);
});

test("i18n：zh-CN / en-US 键集同构", async () => {
  const keySet = async (locale) => {
    const text = await readFile(join(packageRoot, "src", "intl", `${locale}.ts`), "utf8");
    // 全文解析（oxfmt 可能把长值折行，逐行解析会漏键/误报）：先剥离整行注释，
    // 再以键值对正则抽取；值内转义引号不跨界。
    const stripped = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const keys = new Set();
    for (const match of stripped.matchAll(/"((?:[^"\\]|\\.)+)"\s*:\s*"(?:[^"\\]|\\.)*"/g)) {
      keys.add(match[1]);
    }
    return keys;
  };
  const zh = await keySet("zh-CN");
  const en = await keySet("en-US");
  assert.ok(zh.size >= 100, `zh dictionary unexpectedly small: ${zh.size}`);
  const zhOnly = [...zh].filter((key) => !en.has(key));
  const enOnly = [...en].filter((key) => !zh.has(key));
  assert.deepEqual({ zhOnly, enOnly }, { zhOnly: [], enOnly: [] });
});

test("自包含边界：仅受控远控入口可导入 UI（D6 §§22–25 例外）", async () => {
  const walk = async (dir) => {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = [
    ...(await walk(join(packageRoot, "src", "ui"))),
    ...(await walk(join(packageRoot, "src", "app"))),
  ];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    // 静态和动态 import 都检查；注释里的字样不算违面。
    const imports = text.match(/^\s*import[\s\S]*?from\s+["'][^"']+["']/gm) ?? [];
    const uiImports = [
      ...imports.filter((statement) => statement.includes("@zcode/ui")),
      ...[...text.matchAll(/\bimport\(["'](@zcode\/ui[^"']*)["']\)/g)].map((match) => match[1]),
    ];
    const allowed =
      file === join(packageRoot, "src", "app", "RemoteTaskTimeline.tsx")
        ? ["@zcode/ui/remote-timeline"]
        : file === join(packageRoot, "src", "app", "main.tsx")
          ? ["@zcode/ui/remote-frame"]
          : file === join(packageRoot, "src", "app", "RemoteGitSidePane.tsx")
          ? ["@zcode/ui/git-pane"]
          : // §33.18.18 输入面换装：ui LexicalChatInput 窄入口（官方富文本编辑器）。
            file === join(packageRoot, "src", "app", "ComposerRichInput.tsx")
          ? ["@zcode/ui/git-pane", "@zcode/ui/lexical-chat-input"]
          : // §33.18.20 附件上传链：ui uploadAttachmentTransaction 窄入口（begin/chunk/commit）。
            file === join(packageRoot, "src", "app", "composerAttachmentUpload.ts")
          ? ["@zcode/ui/attachment-upload-transaction"]
          : // §33.18.21 草稿持久化：ui composerDraftStore 窄入口（官方 parity 键空间）。
            file === join(packageRoot, "src", "app", "composerDraftPersistence.ts")
          ? ["@zcode/ui/composer-draft-store"]
          : // §33.18.15 终端侧板换装：ui SidePaneTerminalPane 窄入口（xterm+PTY）。
            file === join(packageRoot, "src", "app", "RemoteSidePaneTerminal.tsx")
          ? ["@zcode/ui/git-pane", "@zcode/ui/side-pane-terminal"]
          : file === join(packageRoot, "src", "app", "App.tsx")
          ? // GitPane 一期姊妹件+App 塔（spec §25/§27.1/§30.2）：官方复原件窄入口装配。
            // §32.12 队列面板（spec）：官方复原件受控窄入口（composer 上方逐条卡片）。
            // §32.20 文件 chip 相对目录基准（官方 zCe 语义窄入口）。
            ["@zcode/ui/file-display", "@zcode/ui/git-pane", "@zcode/ui/remote-queue-panel"]
          : [];
    assert.deepEqual(
      [...new Set(uiImports.map((statement) => statement.match(/@zcode\/ui[^"']*/)?.[0]))].sort(),
      allowed,
      `${file} has an unexpected @zcode/ui dependency`,
    );
  }
  assert.ok(files.length >= 8, "self-contained ui/app tree is missing files");
});
