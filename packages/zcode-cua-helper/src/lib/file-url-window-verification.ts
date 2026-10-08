// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// file:// URL 目标窗口核验（防误触非目标窗口）。

var FILE_URL_WINDOW_VERIFY_ATTEMPTS = 30;
function fileTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  const encodedName = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!encodedName) return null;
  let filename;
  try {
    filename = decodeURIComponent(encodedName);
  } catch {
    filename = encodedName;
  }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return { filename, stem };
}
function windowIds(windows) {
  return new Set(
    windows
      .map((window) => window.window_id)
      .filter((id) => typeof id === "number" && Number.isInteger(id)),
  );
}
function titleMatches(title, target) {
  const normalized = title?.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return target.titleCandidates.some(
    (candidate) => normalized === candidate.trim().toLocaleLowerCase(),
  );
}
function distinguishableTargets(targets) {
  const normalize = (value) => value.trim().toLocaleLowerCase();
  const filenameOwners = /* @__PURE__ */ new Map();
  for (const [targetIndex, target] of targets.entries()) {
    const filename = normalize(target.filename);
    const ownerIndex = filenameOwners.get(filename);
    if (ownerIndex !== void 0) {
      throw new Error(
        `file URL window verification cannot distinguish duplicate filename ${JSON.stringify(filename)} for ${JSON.stringify(targets[ownerIndex].filename)} and ${JSON.stringify(target.filename)}; the requested files cannot be verified safely.`,
      );
    }
    filenameOwners.set(filename, targetIndex);
  }
  const stemCounts = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const stem = normalize(target.stem);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  return targets.map((target, targetIndex) => {
    const filename = normalize(target.filename);
    const stem = normalize(target.stem);
    const stemConflictsWithFilename = [...filenameOwners.entries()].some(
      ([candidate, ownerIndex]) => candidate === stem && ownerIndex !== targetIndex,
    );
    const stemIsUnambiguous =
      stem !== filename && stemCounts.get(stem) === 1 && !stemConflictsWithFilename;
    return {
      ...target,
      titleCandidates: stemIsUnambiguous ? [target.filename, target.stem] : [target.filename],
    };
  });
}
function hasOneToOneWindowMatch(windows, baseline) {
  const targets = baseline.targets;
  const baselineWindowIds = baseline.windowIds;
  const candidateWindows = windows.filter(
    (window) => typeof window.window_id === "number" && Number.isInteger(window.window_id),
  );
  const targetForWindow = /* @__PURE__ */ new Map();
  const assign = (targetIndex, visited) => {
    for (const window of candidateWindows) {
      const target = targets[targetIndex];
      const isFresh = !baselineWindowIds.has(window.window_id);
      const baselineTitle = baseline.windowTitles?.get(window.window_id);
      const existingWindowNavigated =
        baselineWindowIds.has(window.window_id) &&
        !titleMatches(baselineTitle, target) &&
        titleMatches(window.title, target);
      if (
        (!isFresh && !existingWindowNavigated) ||
        visited.has(window.window_id) ||
        !titleMatches(window.title, target)
      ) {
        continue;
      }
      visited.add(window.window_id);
      const previousTarget = targetForWindow.get(window.window_id);
      if (previousTarget === void 0 || assign(previousTarget, visited)) {
        targetForWindow.set(window.window_id, targetIndex);
        return true;
      }
    }
    return false;
  };
  return targets.every((_target, targetIndex) => assign(targetIndex, /* @__PURE__ */ new Set()));
}
async function captureFileUrlWindowBaseline(listWindows, urls) {
  if (!listWindows || !urls) return null;
  const parsedTargets = urls.map(fileTarget).filter((target) => target !== null);
  if (parsedTargets.length === 0) return null;
  const targets = distinguishableTargets(parsedTargets);
  try {
    const windows = await listWindows();
    if (!windows) return null;
    return {
      targets,
      windowIds: windowIds(windows),
      windowTitles: new Map(
        windows
          .filter(
            (window) => typeof window.window_id === "number" && Number.isInteger(window.window_id),
          )
          .map((window) => [window.window_id, window.title]),
      ),
    };
  } catch {
    return null;
  }
}
async function verifyFileUrlWindowEffect(listWindows: any, baseline: any, options: any = {}) {
  if (!baseline || !listWindows) return "unavailable";
  const attempts = options.attempts ?? FILE_URL_WINDOW_VERIFY_ATTEMPTS;
  const delay2 =
    options.delay ??
    ((milliseconds) => new Promise((resolve3) => setTimeout(resolve3, milliseconds)));
  let lastWindows = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const windows = await listWindows();
    if (windows) {
      lastWindows = windows;
      if (hasOneToOneWindowMatch(windows, baseline)) {
        return "verified";
      }
    }
    if (attempt + 1 < attempts) await delay2(100);
  }
  throw new Error(
    `the app process resolved, but the requested file URL did not produce a matching accessibility window. Requested files: ${baseline.targets.map((target) => target.filename).join(", ")}; before window_ids=${JSON.stringify([...baseline.windowIds])}; after window_ids=${JSON.stringify([...windowIds(lastWindows)])}.`,
  );
}
