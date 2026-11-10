// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// broker 对端校验（2026-11-10 R10 认证模型换代逐字还原，官方 3.17.2 SEA
// createPeerVerifier @ 85656175）：verifyPeer 返回 **verdict 对象**
// （{ok:true, pid, parentPid, teamIdentifier?, identifier?}）供 authenticate 的
// presentation 角色门复核；false=拒连。uid 门 → dev 逃生 → audit_token 签名门 →
// 父进程签名门，全部 fail-closed。旧血统（3.11.2 形态）的 launcher 祖先链布尔版
// 一并退役——官方 3.14.3 起 peer 校验即签名门模型，launcher 归责只保留在
// presentation 资格（isPresentationPeerEligible 的世系回溯）里。

export function createPeerVerifier(options) {
  return (socket) => {
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
      return { ok: true, pid: cred.pid, parentPid: null };
    }
    if (!cred.auditToken || cred.auditToken.byteLength === 0) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: peer pid ${cred.pid} delivered no audit_token; rejecting`,
      );
      return false;
    }
    let summary = null;
    if (options.describePeer) {
      try {
        summary = options.describePeer(cred.auditToken);
      } catch {
        summary = null;
      }
    }
    const forensic = `pid=${cred.pid} team=${summary?.teamIdentifier ?? "?"} identifier=${summary?.identifier ?? "?"}`;
    let senderSigned = false;
    try {
      senderSigned = options.verifyPeerCodeSignature(cred.auditToken) === true;
    } catch (error51) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: audit_token code-sig check threw (${formatError(error51)}); rejecting`,
      );
      return false;
    }
    if (!senderSigned) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: peer is not signed by an allowed Team (${forensic}); rejecting`,
      );
      return false;
    }
    const parentPid = options.resolveResponsibleOrParentPid(cred.pid);
    if (parentPid === null || !Number.isInteger(parentPid) || parentPid <= 1 || parentPid === cred.pid) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: peer has no verifiable responsible/parent process (${forensic} parent=${String(parentPid)}); rejecting`,
      );
      return false;
    }
    let parentSigned = false;
    try {
      parentSigned = options.verifyProcessCodeSignature(parentPid) === true;
    } catch (error51) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: parent pid ${parentPid} code-sig check threw (${formatError(error51)}); rejecting`,
      );
      return false;
    }
    if (!parentSigned) {
      options.logger?.warn(
        void 0,
        `cua broker verifyPeer: parent pid ${parentPid} is not signed by an allowed Team (${forensic}); rejecting`,
      );
      return false;
    }
    return {
      ok: true,
      pid: cred.pid,
      parentPid,
      ...summary ? { teamIdentifier: summary.teamIdentifier, identifier: summary.identifier } : {},
    };
  };
}
function formatError(error51) {
  return error51 instanceof Error ? error51.message : String(error51);
}

// —— presentation 角色资格（官方 SEA @ 85326144-85326600 逐字）——
// 资格三路：identifier 白名单（宿主主进程 bundle id 族）＞ 双 dev 逃生并开 ＞
// launcher 世系回溯（PRESENTATION_LINEAGE_MAX_DEPTH=8 防
// 环/深链）。verdict.identifier 依赖 addon 的 peerCodeSigningSummary——
// 缺导出时 verdict 无 identifier，自动落到世系回溯路。
// 白名单/安全字符集/开发态判定单一出处：helperVerifier.ts / helperRuntimeTrustPolicy.ts。
import {
  DEFAULT_CUA_LAUNCHER_BUNDLE_IDS,
} from "./helperVerifier.js";
import { isCuaLocalDevelopmentRuntime } from "./helperRuntimeTrustPolicy.js";

var SAFE_CODESIGN_TOKEN = /^[A-Za-z0-9._*-]+$/u;
export var PRESENTATION_LINEAGE_MAX_DEPTH = 8;

export function resolveCuaPresentationPeerIdentifiers(env = process.env) {
  const override = isCuaLocalDevelopmentRuntime(env)
    ? env.ZCODE_CUA_LAUNCHER_BUNDLE_ID?.trim()
    : void 0;
  const ids = [...DEFAULT_CUA_LAUNCHER_BUNDLE_IDS];
  if (override && SAFE_CODESIGN_TOKEN.test(override) && !ids.includes(override))
    ids.push(override);
  return ids;
}

export function isPresentationPeerEligible(options) {
  const { verdict, allowedIdentifiers, unsignedLauncherLocalDev, launcherPid } = options;
  const sameUidExternalPeerLocalDev = options.sameUidExternalPeerLocalDev === true;
  if (typeof verdict.identifier === "string" && allowedIdentifiers.includes(verdict.identifier)) {
    return true;
  }
  if (unsignedLauncherLocalDev && sameUidExternalPeerLocalDev) return true;
  if (launcherPid === null) return false;
  if (verdict.pid === launcherPid || verdict.parentPid === launcherPid) return true;
  const resolve = options.resolveResponsibleOrParentPid;
  if (!resolve) return false;
  const seen = new Set([verdict.pid]);
  let current = verdict.pid;
  for (let depth = 0; depth < PRESENTATION_LINEAGE_MAX_DEPTH; depth += 1) {
    const parent = resolve(current);
    if (parent === null || parent <= 1 || seen.has(parent)) return false;
    if (parent === launcherPid) return true;
    seen.add(parent);
    current = parent;
  }
  return false;
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
