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

const assetNames = await readdir(assetDir);
const provenance = "还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。";
for (const name of assetNames) {
  const path = join(assetDir, name);
  if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
  const source = await readFile(path, "utf8");
  const header = name.endsWith(".css") ? `/* ${provenance} */\n` : `// ${provenance}\n`;
  await writeFile(path, `${header}${source}`);
}

// 修复依据：部分 3.14.3 极端压缩 chunk 首次展开后，oxfmt 二次排版才稳定。
// 两遍后 --check 覆盖全资产，恢复结果可重复生成。
for (let pass = 0; pass < 2; pass += 1) {
  await new Promise((resolvePromise, reject) => {
    const processHandle = spawn(
      process.platform === "win32" ? "pnpm.exe" : "pnpm",
      ["exec", "oxfmt", assetDir],
      {
        cwd: packageRoot,
        stdio: "inherit",
      },
    );
    processHandle.once("error", reject);
    processHandle.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`oxfmt failed with exit code ${code}`));
    });
  });
}

console.log(`[mobile-web] recovered ${assetNames.length} versioned assets into ${recovered}`);
