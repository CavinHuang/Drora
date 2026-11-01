import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureElectronRuntime } from "../scripts/ensure-electron-runtime.mjs";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), "drora-electron-runtime-"));
  roots.push(packageRoot);
  await writeFile(join(packageRoot, "install.js"), "");
  const binary = join(packageRoot, "dist", "electron");
  const install = async () => {
    await mkdir(join(packageRoot, "dist"), { recursive: true });
    await writeFile(join(packageRoot, "path.txt"), "electron\n");
    await writeFile(binary, "fixture binary");
  };
  return { packageRoot, binary, install };
}

describe("Electron runtime readiness", () => {
  it.each([
    [undefined, "https://npmmirror.com/mirrors/electron/"],
    ["", "https://npmmirror.com/mirrors/electron/"],
    ["   ", "https://npmmirror.com/mirrors/electron/"],
    ["https://electron.example.com/", "https://electron.example.com/"],
  ])("安装子进程镜像为 %s 时使用 %s，且不改写父进程环境", async (mirror, expected) => {
    vi.stubEnv("ELECTRON_MIRROR", mirror);
    const { packageRoot, binary } = await fixture();
    await writeFile(
      join(packageRoot, "install.js"),
      `
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
(async () => {
  await mkdir(join(__dirname, 'dist'), { recursive: true });
  await writeFile(join(__dirname, 'dist', 'electron'), process.env.ELECTRON_MIRROR || 'missing');
  await writeFile(join(__dirname, 'path.txt'), 'electron');
})();
`,
    );
    expect(await ensureElectronRuntime({ packageRoot })).toBe(binary);
    expect(await readFile(binary, "utf8")).toBe(expected);
    expect(process.env.ELECTRON_MIRROR).toBe(mirror);
  });

  it("保留 npm 显式镜像配置及其他安装环境变量", async () => {
    // 修复原因（Windows）：`pnpm run` 会把用户 ~/.npmrc 的 electron_mirror 以
    // npm_config_electron_mirror 注入脚本进程，volta/pnpm 链路还会再补一条仅大小写
    // 不同的 NPM_CONFIG_ELECTRON_MIRROR；threads 池 worker 的 process.env 是区分
    // 大小写的普通对象，两条目并存。只 stub 其一会让子进程（Windows env 块大小写
    // 不敏感解析）仍取到注入值。这里把所有大小写形态一起 stub 成目标值，Linux/macOS
    // 只有一条小写形态，行为不变。
    const mirrorKeyVariants = Object.keys(process.env).filter(
      (key) => key.toLowerCase() === "npm_config_electron_mirror",
    );
    const mirrorKeys =
      mirrorKeyVariants.length > 0 ? mirrorKeyVariants : ["npm_config_electron_mirror"];
    for (const key of mirrorKeys) {
      vi.stubEnv(key, "https://electron.example.com/");
    }
    const { packageRoot, binary } = await fixture();
    await writeFile(
      join(packageRoot, "install.js"),
      `
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
(async () => {
  await mkdir(join(__dirname, 'dist'), { recursive: true });
  await writeFile(join(__dirname, 'dist', 'electron'), process.env.npm_config_electron_mirror);
  await writeFile(join(__dirname, 'path.txt'), 'electron');
})();
`,
    );
    expect(await ensureElectronRuntime({ packageRoot })).toBe(binary);
    expect(await readFile(binary, "utf8")).toBe("https://electron.example.com/");
  });

  it("复用官方 path.txt 中已存在的二进制，不重复安装", async () => {
    const { packageRoot, binary, install } = await fixture();
    await install();
    const installRuntime = vi.fn();
    expect(await ensureElectronRuntime({ packageRoot, installRuntime })).toBe(binary);
    expect(installRuntime).not.toHaveBeenCalled();
  });

  it("无 postinstall 的干净安装等待官方安装脚本完成后才返回路径", async () => {
    const { packageRoot, binary, install } = await fixture();
    const installation = Promise.withResolvers<void>();
    const installRuntime = vi.fn(async () => {
      await installation.promise;
      await install();
    });
    const completed = vi.fn();
    const pending = ensureElectronRuntime({ packageRoot, installRuntime }).then(completed);
    await vi.waitFor(() => expect(installRuntime).toHaveBeenCalledOnce());
    expect(completed).not.toHaveBeenCalled();
    installation.resolve();
    await pending;
    expect(completed).toHaveBeenCalledWith(binary);
  });

  it("path.txt 残留但二进制缺失时重新准备", async () => {
    const { packageRoot, binary, install } = await fixture();
    await writeFile(join(packageRoot, "path.txt"), "electron");
    const installRuntime = vi.fn(install);
    expect(await ensureElectronRuntime({ packageRoot, installRuntime })).toBe(binary);
    expect(installRuntime).toHaveBeenCalledOnce();
  });

  it("安装失败直接传播；成功退出但缺失二进制也不返回旧路径", async () => {
    const { packageRoot } = await fixture();
    const failure = new Error("installer failed");
    await expect(
      ensureElectronRuntime({
        packageRoot,
        installRuntime: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    await expect(
      ensureElectronRuntime({ packageRoot, installRuntime: async () => {} }),
    ).rejects.toThrow("Electron binary unavailable");
  });

  it("实际异步子进程安装脚本产出可执行路径", async () => {
    const { packageRoot, binary } = await fixture();
    await writeFile(
      join(packageRoot, "install.js"),
      `
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
(async () => {
  await mkdir(join(__dirname, 'dist'), { recursive: true });
  await writeFile(join(__dirname, 'dist', 'electron'), 'binary');
  await writeFile(join(__dirname, 'path.txt'), 'electron');
})();
`,
    );
    expect(await ensureElectronRuntime({ packageRoot })).toBe(binary);
  });
});
