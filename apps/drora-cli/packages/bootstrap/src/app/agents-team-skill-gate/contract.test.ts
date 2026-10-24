import { describe, expect, it } from "vitest";
import {
  AGENTS_TEAM_SKILL_NAME,
  type SkillLoadOutcome,
  type SkillMetadata,
  type SkillPort,
} from "@drora/contracts";
import { filterAgentsTeamSkillOutcome, gateAgentsTeamSkillPort } from "./contract.js";

/**
 * agents-team-skill-gate 模块契约测试（§21 E，2026-10-24 补件：受管模块五件套缺
 * contract.test.ts 使 architecture:check 报 missing-module-artifact）。
 *
 * 放置与收集口径（照 src/drora-protocol/mcp-ui/contract.test.ts 先例如实登记，
 * 本会话实测验证）：根 vitest 配置的 include（test/** 与 tests/** 目录）**不收集
 * src/ 内测试**——本文件不进默认套件（`pnpm test`/`vitest run` 均不收集，显式传
 * 文件路径也会被 include 交集滤掉，与 mcp-ui 先例同口径），真实覆盖面在模块外
 * `tests/agents-team-skill-gate.test.ts`（195 行，含 bundled adapter 集成）。
 * 直跑方式：以显式 include 覆盖的临时 config 经
 * `npx vitest run --config <config with test.include=["src/app/agents-team-skill-gate/contract.test.ts"]>`
 * 在 bootstrap 包内运行（本会话按此实测 3 用例全绿；裸 `node --test` 不可行——
 * 依赖链模块解析依赖 vite 条件）。
 *
 * 契约依据：specs/agents-team.md §17 契约 1（技能同门灰度——「教工具的技能与工具
 * 同生共死」；门关时模型不得拿到只有说明书的团队工具面）。
 */

function bundledSkill(name: string): SkillMetadata {
  return {
    description: `${name} description`,
    directory: `/pack/skills/${name}`,
    frontmatterKeys: [],
    name,
    path: `/pack/skills/${name}/SKILL.md`,
    rootPath: "/pack",
    safeToAutoLoad: false,
    scope: "system",
    source: "bundled",
  };
}

function userSkill(name: string): SkillMetadata {
  return {
    description: `${name} description`,
    directory: `/home/.agents/skills/${name}`,
    frontmatterKeys: [],
    name,
    path: `/home/.agents/skills/${name}/SKILL.md`,
    rootPath: "/home/.agents/skills",
    safeToAutoLoad: false,
    scope: "user",
    // SkillSource 无 "user"：用户级（~/.agents）技能的来源枚举是 "agents"。
    source: "agents",
  };
}

function outcomeOf(skills: SkillMetadata[]): SkillLoadOutcome {
  return { diagnostics: [], skills, totalDiscovered: skills.length };
}

describe("agents-team-skill-gate contract (§17 契约 1)", () => {
  it("门关时发现列表只剔除 bundled 来源的 agents-team 技能（同名用户技能不误伤）", () => {
    const outcome = outcomeOf([
      bundledSkill(AGENTS_TEAM_SKILL_NAME),
      bundledSkill("dynamic-workflows"),
      userSkill(AGENTS_TEAM_SKILL_NAME),
    ]);
    const filtered = filterAgentsTeamSkillOutcome(outcome, false);
    expect(filtered.skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      "bundled:dynamic-workflows",
      `agents:${AGENTS_TEAM_SKILL_NAME}`,
    ]);
    // totalDiscovered 保持全集口径：剔除是呈现层过滤，不是「从未发现」。
    expect(filtered.totalDiscovered).toBe(outcome.totalDiscovered);
    expect(filtered.diagnostics).toBe(outcome.diagnostics);
  });

  it("门开时发现结果原样透传（零包装开销，泛型不降型）", () => {
    const outcome = outcomeOf([bundledSkill(AGENTS_TEAM_SKILL_NAME)]);
    expect(filterAgentsTeamSkillOutcome(outcome, true)).toBe(outcome);
  });

  it("门关时 loadSkill 仅对解析确为 bundled 的 agents-team 稳定拒绝；其余照常解析", async () => {
    // 照模块外测试 fakePort 先例：显式 SkillPort 标注防泛型 T 收窄成字面量签名
    //（loadSkill 入参含 workingDirectory 等字段）。
    const fakePort = (resolveSource: (name: string) => SkillMetadata): SkillPort => ({
      discoverSkills: async () => outcomeOf([userSkill(AGENTS_TEAM_SKILL_NAME)]),
      loadSkill: async (request) => {
        const metadata = resolveSource(request.name);
        const content = `content of ${request.name}`;
        return {
          content,
          metadata,
          baseDirectory: metadata.directory,
          bytesRead: Buffer.byteLength(content),
          sizeBytes: Buffer.byteLength(content),
          truncated: false,
        };
      },
    });
    // 用户同名技能优先接位（发现顺序语义）：解析非 bundled 来源 → 不误伤。
    const gated = gateAgentsTeamSkillPort(
      fakePort((name) => userSkill(name)),
      false,
    );
    const loaded = await gated.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: "/w" });
    expect(loaded.metadata.source).toBe("agents"); // 不按请求名直接拦

    // 解析确为 bundled 的 agents-team → 「Skill not found」稳定拒绝（与缺失技能同文案）。
    const rejected = gateAgentsTeamSkillPort(
      fakePort((name) => bundledSkill(name)),
      false,
    );
    await expect(
      rejected.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: "/w" }),
    ).rejects.toThrow(`Skill not found: ${AGENTS_TEAM_SKILL_NAME}`);
  });
});
