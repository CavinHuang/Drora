#!/usr/bin/env node
// 编译系统级听写全局触发 key-tap 辅助程序（specs/voice-agent-integration.md §5.6）。
//
// 形态照 build-macos-window-bounds.mjs 先例：非 darwin 跳过；缺 swiftc 只警告不失败
// ——系统级听写是增强能力，key-tap 缺位时开关置灰 fail-closed，不该挡整个构建。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "native", "macos-key-tap", "main.swift");
const outputDir = join(packageRoot, "resources", "macos-key-tap");
const outputPath = join(outputDir, "drora-key-tap");

if (process.platform !== "darwin") {
  console.log("[key-tap] 跳过：仅 macOS 需要");
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error(`[key-tap] 源文件缺失：${sourcePath}`);
  process.exit(1);
}

function hasSwiftc() {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasSwiftc()) {
  console.warn("[key-tap] 未找到 swiftc（需 Xcode Command Line Tools）；跳过构建。");
  console.warn("[key-tap] 系统级听写不可用（设置页开关置灰）。");
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });

try {
  // 与 window-bounds 同款 universal 双架构产物，避免发布包在另一架构上无法执行。
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "arm64-apple-macos11", sourcePath, "-o", `${outputPath}-arm64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "x86_64-apple-macos11", sourcePath, "-o", `${outputPath}-x86_64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "lipo",
    ["-create", `${outputPath}-arm64`, `${outputPath}-x86_64`, "-output", outputPath],
    { stdio: "inherit" },
  );
  execFileSync("rm", ["-f", `${outputPath}-arm64`, `${outputPath}-x86_64`]);
  console.log(`[key-tap] 已构建 universal 二进制：${outputPath}`);
} catch (error) {
  console.warn(
    "[key-tap] 构建失败；系统级听写不可用：",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(0);
}
