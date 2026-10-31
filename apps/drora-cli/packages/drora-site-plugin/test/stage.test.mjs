// packStage / checkStage 测试：在临时目录里搭 stage，检查产物包内容、契约检查和本地启动检查。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { checkStage, classifyBinary, packStage } from "../scripts/stage.mjs";

/**
 * Windows 修复：不用外部 `tar` 校验包内容。本机实证（中文 Windows）：无论 GNU tar
 * 还是 System32 bsdtar，经管道输出文件名都会被 ANSI 代码页转码（中文变 ???）且行尾
 * 为 CRLF，utf8 解码必错。tar 是 packStage 自己在 Node 里写出来的（tarEntries+
 * zlib），这里直接解包读 512 字节头的 ustar 条目，跨平台确定。
 */
function readTarEntries(gzipBody) {
  const tar = gunzipSync(gzipBody);
  const entries = [];
  let pendingPaxPath;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const mode = parseInt(block.subarray(100, 108).toString("utf8").replace(/\0.*$/s, ""), 8) || 0;
    const sizeField = block.subarray(124, 136).toString("utf8").replace(/[\0 ]/g, "");
    const size = parseInt(sizeField, 8) || 0;
    const type = block[156];
    const payload = tar.subarray(offset + 512, offset + 512 + size);
    if (type === 0x78) {
      // PAX 扩展头：长名/非 ASCII 名在 `path=` 记录里，作用于下一个条目。
      const pathMatch = payload.toString("utf8").match(/(?:^|\n)\d+ path=([^\n]*)/);
      pendingPaxPath = pathMatch?.[1];
    } else if (type === 0x30 || type === 0) {
      const ustarName = prefix ? `${prefix}/${name}` : name;
      entries.push({ mode, name: pendingPaxPath ?? ustarName, size });
      pendingPaxPath = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function stage(files) {
  const dir = await mkdtemp(join(tmpdir(), "drora-site-stage-"));
  const root = join(dir, "stage");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return { dir, root };
}

function elf(machine) {
  const head = Buffer.alloc(64);
  head.write("\x7fELF", 0, "latin1");
  head[4] = 2; // 64 位
  head[5] = 1; // 小端
  head.writeUInt16LE(machine, 18);
  return head;
}

function macho() {
  const head = Buffer.alloc(64);
  head.writeUInt32LE(0xfeedfacf, 0);
  return head;
}

test("classifyBinary tells linux x86-64 apart from other native code", () => {
  assert.deepEqual(classifyBinary(elf(0x3e)), { linux: true });
  assert.equal(classifyBinary(elf(0xb7)).linux, false); // aarch64
  assert.equal(classifyBinary(macho()).linux, false);
  assert.equal(classifyBinary(Buffer.from("#!/usr/bin/env bash\n")), undefined);
});

test("pack writes the stage as a gzip tar and skips local-only files", async () => {
  const { dir, root } = await stage({
    "start.sh": "exec node server.js\n",
    "server.js": "",
    [`public/${"a".repeat(120)}.html`]: "long name",
    "public/中文.html": "non-ascii name",
    "lib/addon.node": elf(0x3e),
    ".DS_Store": "",
    ".drora-site.json": "{}",
    ".git/HEAD": "ref",
  });
  await chmod(join(root, "server.js"), 0o755);
  const packed = await packStage(root, { cwd: dir });
  assert.deepEqual(packed.warnings, []);
  assert.equal(packed.result.packageBytes, packed.body.length);
  const out = join(dir, "package.tar.gz");
  await writeFile(out, packed.body);
  assert.equal(packed.result.files, 5);
  assert.equal(packed.result.linuxBinaries, 1);

  // Windows 修复：见文件头 readTarEntries 说明——tar 名单与模式位改为在 Node 内解包校验。
  const entries = readTarEntries(packed.body);
  const names = entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, [
    "lib/addon.node",
    `public/${"a".repeat(120)}.html`,
    "public/中文.html",
    "server.js",
    "start.sh",
  ]);
  const modeOf = (name) => entries.find((entry) => entry.name === name)?.mode.toString(8);
  assert.equal(modeOf("lib/addon.node"), "755");
  // Windows：chmod 不产生可执行位、stat 读不到 0111，脚本按设计落 644（打包器注释：
  // 二进制靠内容探测给 755，不依赖可执行位）。POSIX 上 chmod 生效为 755。
  assert.equal(modeOf("server.js"), process.platform === "win32" ? "644" : "755");
  assert.equal(modeOf("start.sh"), "644");
});

test("pack lists every contract problem and builds no package", async () => {
  const { dir, root } = await stage({
    "start.sh": "exec node server.js\r\n",
    "package.json": JSON.stringify({ dependencies: { express: "^5" } }),
    ".env": "SECRET=1",
    ".env.example": "SECRET=",
    "bin/tool": macho(),
    ".__drora/x": "",
  });
  await symlink("missing", join(root, "broken"));
  const packed = await packStage(root, { cwd: dir });
  assert.equal(packed.body, undefined);
  const text = packed.problems.join("\n");
  for (const word of ["CRLF", "node_modules", ".env", "bin/tool", ".__drora", "broken"])
    assert.ok(text.includes(word), `${word} in:\n${text}`);
  assert.ok(!text.includes(".env.example"));

  const allowed = await packStage(root, { cwd: dir, allowForeignBinaries: true });
  assert.ok(allowed.problems.every((p) => !p.includes("bin/tool")));
});

test("pack rejects a missing start.sh and a missing stage", async () => {
  const { dir, root } = await stage({ "index.html": "" });
  assert.ok((await packStage(root, { cwd: dir })).problems.some((p) => p.includes("start.sh")));
  assert.equal((await packStage(join(dir, "none"), { cwd: dir })).error, "STAGE_NOT_FOUND");
});

const posix = process.platform !== "win32";

test("check reports a server that answers as live", { skip: !posix }, async () => {
  const { dir, root } = await stage({
    "start.sh": `exec node -e 'require("http").createServer((q,s)=>{s.end("ok")}).listen(process.env.PORT,"0.0.0.0",()=>console.log("up"))'\n`,
  });
  const checked = await checkStage(root, { cwd: dir, port: 13871, timeoutMs: 20000 });
  assert.equal(checked.result?.status, "live", JSON.stringify(checked));
  assert.equal(checked.result.httpStatus, 200);
});

test("check reports a start.sh that exits", { skip: !posix }, async () => {
  const { dir, root } = await stage({ "start.sh": "echo starting; exit 0\n" });
  const checked = await checkStage(root, { cwd: dir, port: 13872, timeoutMs: 20000 });
  assert.ok(checked.failed, JSON.stringify(checked));
  assert.ok(checked.failed.log.includes("starting"));
});

test("check skips a stage with linux binaries on another platform", async () => {
  const { dir, root } = await stage({ "start.sh": "exec ./app\n", app: elf(0x3e) });
  const checked = await checkStage(root, { cwd: dir, platform: "darwin", arch: "arm64" });
  assert.equal(checked.result?.status, "skipped", JSON.stringify(checked));
});
