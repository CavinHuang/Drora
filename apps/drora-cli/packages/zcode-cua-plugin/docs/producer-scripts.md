# Producer 脚本链：官方仓 verbatim 移植登记（休眠态）

> 登记于 2026-11-15，`docs/upstream-v3.18.0-diff-2026-11-11/10-plugin-audit.md` §三.1 用户裁定 A 方案（保 verbatim + 登记）；台账见 `specs/drora-divergence-ledger.md` 台账 43。

## 哪些脚本

`scripts/` 下 5 件为官方仓 **verbatim 移植**（上游同步参照物，官方便携自比本仓跟踪树 `refs/upstream-trees/v3.18.2` 更新的 producer 链形态；v3.18.2 树仅含 check-sdk / computer-use-client / sync-cache 三件）：

| 脚本 | 角色 |
|---|---|
| `check-version-coherence.mjs` | producer 版本一致性门（CI gate） |
| `check-cua-baseline.mjs` | pin/provenance 快速门禁 |
| `bump-zcode-cua-producer.mjs` | 原子 producer bump 命令 |
| `sync-skill-from-zcode-cua.mjs` | 从官方 zcode-cua 仓同步 Skill/manifest 回写 wrapper |
| `resolve-pnpm-invocation.mjs` | bump 脚本的可测 pnpm 调用解析模块 |

## 为什么在本仓不可运行（休眠态，按 verbatim 豁免保真不适配）

- 断言**官方契约名** `@zcode/zcode-cua`：本仓 workspace 包名为 `@drora/drora-cua`（`packages/zcode-cua/package.json`），断言必红（如 `check-version-coherence.mjs:130` 的 `packageJson?.name !== "@zcode/zcode-cua"`，实测 exit 1）。
- 硬编码**官方仓路径** `apps/zcode-cli/...`（如 `check-version-coherence.mjs:59`、`bump-zcode-cua-producer.mjs:250`）：本仓为 `apps/drora-cli/...` 拓扑，走到即 ENOENT（`check-cua-baseline.mjs:30` 读 `upstream.json` 实测 ENOENT exit 1）。
- 本仓以 workspace 包 `packages/zcode-cua` 替代官方 `@zcode/zcode-cua` producer 安装，`upstream.json` / catalog git pin 等 producer 链材料不存在。

## 处置

保持 verbatim 不做适配（保真优先：这些脚本的价值在于下次从官方同步时做字面量/行为对照，改写即失去参照物）；不接 CI、不进任何测试清单。消费面仅限 `package.json` 的 `sync:*` / `check:baseline` / `version:check` / `bump:producer` 休眠入口与上游同步战役的人工参照。
