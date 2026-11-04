import { resolve } from "node:path";
import { git, run } from "./process.mjs";
import { checkPushWorktree } from "../check-push-worktree.mjs";

async function commit(root, ref) {
  try {
    return (await git(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]))
      .toString()
      .trim();
  } catch (error) {
    throw new Error(`无法解析基线或提交 ${ref}：${error.message}`, { cause: error });
  }
}
async function isAncestor(root, ancestor, head) {
  const check = await run("git", ["merge-base", "--is-ancestor", ancestor, head], {
    cwd: root,
    allowFailure: true,
  });
  return check.code === 0;
}

// rebase / force-push 后远端 SHA 不再是 HEAD 的祖先；直接拿它当基线会让 Vitest
// 找不到公共祖先而退化成全量选择。回退到双方 merge-base，永远给官方选择一个
// 真实分叉点（最坏也只是比严格推送范围多选 staging 侧的新增改动，不会全量）。
async function resolvePushBase(root, head, remote) {
  if (await isAncestor(root, remote, head)) {
    return remote;
  }

  return (await git(root, ["merge-base", remote, head])).toString().trim();
}

async function firstPushBase(root, head) {
  // 首次推送没有 remote SHA。基线选择（台账 8/10 裁定，v3.17.2 合并曾覆盖本回退、
  // 依台账 10「drora/main 回退必须保留」恢复）：上游集成分支 origin/staging 存在且
  // 为 HEAD 祖先时用之；否则回退产品远端 drora/main——不猜测其他分支；两者都缺失
  // 时保持「无基线严格报错」语义（照抄台账 8 的 origin/main 字面回退会让 merge-base
  // 退回上一上游锚点导致全量误选，不得采用）。
  const staging = await tryResolveCommit(root, "origin/staging");
  if (staging && (await isAncestor(root, staging, head))) {
    return (await git(root, ["merge-base", staging, head])).toString().trim();
  }
  const droraMain = await commit(root, "drora/main");
  return (await git(root, ["merge-base", droraMain, head])).toString().trim();
}

/** 可失败版 commit：引用不存在返回 null，不抛错（首推基线的探测语义）。 */
async function tryResolveCommit(root, ref) {
  try {
    return await commit(root, ref);
  } catch {
    return null;
  }
}

/** 只解析比较基线；改动文件与关联测试全部由 Vitest 官方选择。 */
export async function resolveScope(root, options = {}, env = process.env) {
  if (options.scope && !["worktree", "push"].includes(options.scope))
    throw new Error(`未知范围：${options.scope}`);
  const explicit = options.base ?? env.DRORA_AFFECTED_TEST_BASE ?? env.DRORA_PRE_PUSH_BASE;
  if (options.files && (options.scope === "push" || explicit))
    throw new Error("--files 不能与 push 或 --base 混用");
  if (options.files)
    return { files: [...new Set(options.files.map((file) => resolve(root, file)))], bases: [true] };
  if (options.scope !== "push") return { bases: [explicit ? await commit(root, explicit) : true] };

  await checkPushWorktree(root, env);
  const head = await commit(root, "HEAD");
  const entries = (env.DRORA_PRE_PUSH_STDIN ?? "")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u));
  const bases = [];
  if (entries.length) {
    for (const entry of entries) {
      if (/^0+$/u.test(entry[1])) continue;
      // hook 曾直接使用 remote SHA，导致显式基线变量失效；校验目标后优先使用调用方指定基线。
      bases.push(
        explicit
          ? await commit(root, explicit)
          : /^0+$/u.test(entry[3])
            ? await firstPushBase(root, head)
            : await resolvePushBase(root, head, await commit(root, entry[3])),
      );
    }
    return { bases: [...new Set(bases)], deletedOnly: !bases.length };
  }
  if (explicit) return { bases: [await commit(root, explicit)] };
  const upstream = await run("git", ["rev-parse", "--verify", "@{upstream}^{commit}"], {
    cwd: root,
    allowFailure: true,
  });
  return {
    bases: [
      upstream.code === 0
        ? await resolvePushBase(root, head, upstream.stdout.toString().trim())
        : await firstPushBase(root, head),
    ],
  };
}
