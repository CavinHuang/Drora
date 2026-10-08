import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { canonicalizeCuaBundleId } from "./cuaAppIdentity.js";
import { MACOS_SYSTEM_COMMANDS } from "./macosSystemCommands.js";

var MAX_APPLICATION_NAME_LENGTH = 255;
var MAX_APPLICATION_NAME_UTF8_BYTES = 1024;
var defaultApplicationBundleIdLookup = {
  async listApplicationPaths() {
    const allowedRoots = ["/Applications/", "/System/Applications/", `${homedir()}/Applications/`];
    const paths = /* @__PURE__ */ new Set();
    for (const root of allowedRoots) {
      let entries;
      try {
        entries = await readdir(root);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".app")) continue;
        paths.add(`${root}${entry}`);
      }
    }
    return [...paths];
  },
  async readApplicationAliases(path) {
    const aliases = /* @__PURE__ */ new Set([basename(path, ".app")]);
    try {
      const resources = join(path, "Contents", "Resources");
      const entries = await readdir(resources, { withFileTypes: true });
      const localeDirectories: any = entries.filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(".lproj"),
      );
      for (const entry of localeDirectories.slice(0, 128)) {
        try {
          const content = await readFile(join(resources, entry.name, "InfoPlist.strings"), "utf8");
          for (const name of parseLocalizedApplicationNames(content)) aliases.add(name as string);
        } catch {}
      }
    } catch {}
    const localizedTable: any = await execFileText2(
      MACOS_SYSTEM_COMMANDS.plist,
      ["-convert", "json", "-o", "-", join(path, "Contents", "Resources", "InfoPlist.loctable")],
      1e3,
      2 * 1024 * 1024,
    );
    if (localizedTable) {
      try {
        const table: any = JSON.parse(localizedTable);
        for (const values of Object.values(table)) {
          for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
            const value: any = values[key];
            if (typeof value === "string" && value.trim()) aliases.add(value.trim());
          }
        }
      } catch {}
    }
    return [...aliases];
  },
  async readApplicationBundleId(path) {
    const value: any = await execFileText2(
      MACOS_SYSTEM_COMMANDS.plistBuddy,
      ["-c", "Print :CFBundleIdentifier", join(path, "Contents", "Info.plist")],
      1e3,
    );
    if (!value?.trim()) return null;
    try {
      return canonicalizeCuaBundleId(value.trim());
    } catch {
      return null;
    }
  },
};
export async function resolveApplicationBundleId(name, lookup = defaultApplicationBundleIdLookup) {
  const normalized = normalizeApplicationName(name);
  if (!normalized) return null;
  const matchingPaths = [];
  for (const path of await lookup.listApplicationPaths()) {
    const aliases = await lookup.readApplicationAliases(path);
    if (aliases.some((alias) => normalizeApplicationName(alias) === normalized)) {
      matchingPaths.push(path);
    }
  }
  const bundleIds = /* @__PURE__ */ new Set();
  for (const path of matchingPaths) {
    const bundleId = await lookup.readApplicationBundleId(path);
    if (bundleId) bundleIds.add(bundleId);
  }
  return bundleIds.size === 1 ? bundleIds.values().next().value : null;
}
function parseLocalizedApplicationNames(content) {
  const bytes = Buffer.from(content);
  let text;
  if (bytes[0] === 255 && bytes[1] === 254) {
    text = bytes.subarray(2).toString("utf16le");
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    const swapped = Buffer.allocUnsafe(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    text = swapped.toString("utf16le");
  } else {
    text = bytes.toString("utf8");
  }
  const names = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(
    /(?<![A-Za-z0-9_])"?(?:CFBundleDisplayName|CFBundleName)"?\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gu,
  )) {
    const value = match[1]?.replaceAll('\\"', '"').replaceAll("\\\\", "\\").trim();
    if (value) names.add(value);
  }
  return [...names];
}
function normalizeApplicationName(value) {
  const trimmed = value.trim();
  // 有意用控制字符类拒绝应用名中的 \0 与换行，属业务校验而非误用。
  if (
    !trimmed ||
    trimmed.length > MAX_APPLICATION_NAME_LENGTH ||
    Buffer.byteLength(trimmed, "utf8") > MAX_APPLICATION_NAME_UTF8_BYTES ||
    /[\0\r\n]/u.test(trimmed)
  ) {
    return null;
  }
  let withoutSuffix = trimmed.replace(/(?:\.app|\s+app|应用程序|应用)$/iu, "");
  if (withoutSuffix.toLocaleLowerCase().endsWith("app")) {
    const prefix = withoutSuffix.slice(0, -3);
    const lastCodePoint = prefix.codePointAt(prefix.length - 1);
    if (lastCodePoint !== void 0 && lastCodePoint > 127) withoutSuffix = prefix;
  }
  return withoutSuffix.trim().normalize("NFKC").toLocaleLowerCase();
}
function execFileText2(command, args, timeout, maxBuffer = 16 * 1024) {
  return new Promise((resolve2) => {
    execFile(command, args, { encoding: "utf8", maxBuffer, timeout }, (error51, stdout) => {
      resolve2(error51 ? void 0 : stdout);
    });
  });
}
