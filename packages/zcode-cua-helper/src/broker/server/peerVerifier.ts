// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// broker 对端校验：audit_token 签名快路径 + 祖先链回退，全部 fail-closed。

export function createPeerVerifier(options) {
  const maxDepth = options.maxAncestryDepth ?? 64;
  const verifyCodeSig = options.verifyPeerCodeSignature;
  return (socket) => {
    if (!Number.isInteger(options.launcherPid) || options.launcherPid <= 1) {
      options.logger?.warn(
        void 0,
        "cua broker verifyPeer: missing/invalid launcher pid; rejecting",
      );
      return false;
    }
    const cred = options.resolvePeerCredentials(socket);
    if (!cred) {
      options.logger?.warn(
        void 0,
        "cua broker verifyPeer: peer credentials unavailable; rejecting",
      );
      return false;
    }
    if (cred.uid !== options.currentUid) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: peer uid ${cred.uid} != ${options.currentUid}; rejecting`,
      );
      return false;
    }
    if (options.allowSameUidExternalPeerLocalDev === true) {
      return true;
    }
    if (verifyCodeSig && cred.auditToken && cred.auditToken.byteLength > 0) {
      try {
        if (verifyCodeSig(cred.auditToken) === true) {
          return true;
        }
      } catch (error51) {
        options.logger?.warn(
          void 0,
          `cua broker verifyPeer: audit_token code-sig check threw (${formatError(error51)}); falling back to ancestry`,
        );
      }
    }
    let pid = cred.pid;
    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (pid === options.launcherPid) return true;
      if (pid <= 1) break;
      const ppid = options.resolveParentPid(pid);
      if (ppid === null || ppid === pid) break;
      pid = ppid;
    }
    options.logger?.warn(
      void 0,
      `cua broker verifyPeer: peer pid ${cred.pid} is not a descendant of launcher ${options.launcherPid}; rejecting`,
    );
    return false;
  };
}
function formatError(error51) {
  return error51 instanceof Error ? error51.message : String(error51);
}
export function isLauncherTrustedZCode(gate) {
  if (gate.launcherPid === null || !Number.isInteger(gate.launcherPid) || gate.launcherPid <= 1) {
    gate.logger?.warn(
      void 0,
      "cua broker launcher identity: missing/invalid launcher pid; rejecting",
    );
    return false;
  }
  if (typeof gate.verifyProcessCodeSignature !== "function") {
    gate.logger?.warn(
      void 0,
      "cua broker launcher identity: native verifyProcessCodeSignature unavailable; rejecting",
    );
    return false;
  }
  if (!gate.requirement.trim()) return false;
  try {
    return gate.verifyProcessCodeSignature(gate.launcherPid, gate.requirement) === true;
  } catch {
    gate.logger?.warn(void 0, "cua broker launcher identity: native verify threw; rejecting");
    return false;
  }
}
