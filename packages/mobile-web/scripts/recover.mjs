import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = join(packageRoot, "upstream");
const recovered = join(packageRoot, "src", "recovered");
const assetDir = join(recovered, "remote", "v4", "3.14.3", "assets");
const targetRelative = relative(packageRoot, recovered);

if (
  targetRelative !== join("src", "recovered") ||
  recovered === packageRoot ||
  targetRelative.startsWith(`..${sep}`)
) {
  throw new Error("recovery target must stay inside mobile-web/src/recovered");
}

if (!(await stat(join(snapshot, "remote", "v4", "index.html"))).isFile()) {
  throw new Error("3.14.3 upstream snapshot is missing");
}

await rm(recovered, { recursive: true, force: true });
await mkdir(dirname(recovered), { recursive: true });
await cp(snapshot, recovered, { recursive: true });

// 修复依据：刚落盘的 2600+ 文件会被 Windows Defender 立即扫描并短暂锁句柄，
// 等待一拍再进入回写阶段，降低首文件即撞锁(errno -4094)的概率。
await new Promise((r) => setTimeout(r, 2000));

const assetNames = await readdir(assetDir);
const provenance = "还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。";

// 修复依据：Windows Defender 会短暂锁住刚拷贝完成的大批资产文件，
// 紧随 cp 的首轮回写偶发 errno -4094(UNKNOWN)。带退避重试后可稳定通过。
async function writeFileWithRetry(path, data) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      if (attempt >= 4 || error.code !== "UNKNOWN") throw error;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

for (const name of assetNames) {
  const path = join(assetDir, name);
  if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
  const source = await readFile(path, "utf8");
  const header = name.endsWith(".css") ? `/* ${provenance} */\n` : `// ${provenance}\n`;
  await writeFileWithRetry(path, `${header}${source}`);
}

// 修复依据：部分 3.14.3 极端压缩 chunk 首次展开后，oxfmt 二次排版才稳定。
// 两遍后 --check 覆盖全资产，恢复结果可重复生成。
// 修复依据：cp 大批资产后 Windows Defender 会短暂锁定新文件，oxfmt(Rust 多线程)
// 并发回写偶发 panic(写入失败即整进程退出)。oxfmt 幂等，带退避整轮重试可收敛。
async function runOxfmtPass() {
  for (let attempt = 0; ; attempt += 1) {
    const code = await new Promise((resolvePromise, reject) => {
      const processHandle = spawn(
        process.platform === "win32" ? "pnpm.exe" : "pnpm",
        ["exec", "oxfmt", assetDir],
        {
          cwd: packageRoot,
          stdio: "inherit",
        },
      );
      processHandle.once("error", reject);
      processHandle.once("exit", (code2) => resolvePromise(code2));
    });
    if (code === 0) return;
    if (attempt >= 4) throw new Error(`oxfmt failed with exit code ${code}`);
    console.warn(`[mobile-web] oxfmt pass failed (exit ${code}), retry ${attempt + 1}/4...`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

for (let pass = 0; pass < 2; pass += 1) {
  await runOxfmtPass();
}

console.log(`[mobile-web] recovered ${assetNames.length} versioned assets into ${recovered}`);
