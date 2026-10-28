import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeSkillAdapter } from "@drora/adapters/skills";
import {
  AGENTS_TEAM_SKILL_NAME,
  type SkillLoadOutcome,
  type SkillMetadata,
  type SkillPort,
} from "@drora/contracts";
import { describe, expect, it } from "vitest";
import { resolveBundledSkillRoots } from "../src/app/bundled-skills.js";
import {
  filterAgentsTeamSkillOutcome,
  gateAgentsTeamSkillPort,
} from "../src/app/agents-team-skill-gate/contract.js";

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

const OUTCOME = outcomeOf([
  bundledSkill(AGENTS_TEAM_SKILL_NAME),
  bundledSkill("dynamic-workflows"),
  userSkill(AGENTS_TEAM_SKILL_NAME),
]);

describe("filterAgentsTeamSkillOutcome", () => {
  it("keeps the outcome untouched when the gate is enabled", () => {
    expect(filterAgentsTeamSkillOutcome(OUTCOME, true)).toBe(OUTCOME);
  });

  it("drops only the bundled agents-team skill when disabled", () => {
    const filtered = filterAgentsTeamSkillOutcome(OUTCOME, false);
    expect(filtered.skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      "bundled:dynamic-workflows",
      `agents:${AGENTS_TEAM_SKILL_NAME}`,
    ]);
    // totalDiscovered 保持全集口径：剔除是呈现层过滤，不是「从未发现」。
    expect(filtered.totalDiscovered).toBe(OUTCOME.totalDiscovered);
    expect(filtered.diagnostics).toBe(OUTCOME.diagnostics);
  });
});

describe("gateAgentsTeamSkillPort", () => {
  /** 按名路由解析来源的假 port：loads 记录透传请求，来源由用例决定。显式 SkillPort 标注，
   * 否则泛型 T 收窄成字面量签名，loadSkill 的入参会缺 workingDirectory 等字段。 */
  function fakePort(resolveSource: (name: string) => SkillMetadata) {
    const loads: string[] = [];
    const port: SkillPort = {
      discoverSkills: async () => OUTCOME,
      loadSkill: async (request) => {
        loads.push(request.name);
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
    };
    return { loads, port };
  }

  it("returns the same port when enabled", () => {
    const { port } = fakePort(bundledSkill);
    expect(gateAgentsTeamSkillPort(port, true)).toBe(port);
  });

  it("rejects the load when the resolved skill is the bundled agents-team", async () => {
    const gated = gateAgentsTeamSkillPort(fakePort(bundledSkill).port, false);
    await expect(
      gated.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: "/w" }),
    ).rejects.toThrow(`Skill not found: ${AGENTS_TEAM_SKILL_NAME}`);
  });

  it("filters discovery and lets a user-level same-name skill through when disabled", async () => {
    const { loads, port } = fakePort((name) =>
      name === AGENTS_TEAM_SKILL_NAME ? userSkill(name) : bundledSkill(name),
    );
    const gated = gateAgentsTeamSkillPort(port, false);

    const discovered = await gated.discoverSkills({ workingDirectory: "/w" });
    // 只剔除 bundled 来源；用户同名技能按发现顺序接位，不在剔除面内。
    expect(
      discovered.skills.some(
        (skill) => skill.source === "bundled" && skill.name === AGENTS_TEAM_SKILL_NAME,
      ),
    ).toBe(false);

    // 用户同名技能经底层解析接位后放行；其它 bundled 技能（dynamic-workflows）不受影响。
    const user = await gated.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: "/w" });
    expect(user.metadata.source).toBe("agents");
    await gated.loadSkill({ name: "dynamic-workflows", workingDirectory: "/w" });
    expect(loads).toEqual([AGENTS_TEAM_SKILL_NAME, "dynamic-workflows"]);
  });
});

/**
 * 运行时装配面（specs/agents-team.md §17 契约 1）：create-app.ts 的 runtimeAgentDeps.skillPort
 * 是模型会话内真正消费的端口（discoverSkillsForContext/loadSkill）。终局复核实证门此前只包在
 * skills.ts 目录清单面，模型面敞着——「说明书在、工具不在」的缝。这里照
 * dynamic-workflow-skill.test.ts 的钉资产纪律，用真实 bundled 技能根 + 真实 NodeSkillAdapter
 * 复现 create-app.ts 的装配形态再包同一道门：包路径/目录名/来源任一漂移，这条用例立刻红，
 * 而不是灰度门静默失效。
 */
describe("gateAgentsTeamSkillPort · runtime assembly face (create-app.ts skillPort)", () => {
  const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const AGENTS_TEAM_DIR = join(PACKAGES_ROOT, "bundled-skills", "skills", "agents-team");

  /** 与 create-app.ts runtimeAgentDeps.skillPort 同形：bundled 根并列注入 + 同一道门。 */
  function runtimeFacePort(enabled: boolean) {
    const bundledSkillRoots = resolveBundledSkillRoots({
      cliStorageRoot: join(tmpdir(), "drora-agents-team-gate-unused-cli-storage"),
    });
    return gateAgentsTeamSkillPort(
      createNodeSkillAdapter({ extraResolvedRoots: bundledSkillRoots }),
      enabled,
    );
  }

  it("门开：bundled agents-team 在真实磁盘资产上可发现、可加载", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-agents-team-gate-open-"));
    try {
      const port = runtimeFacePort(true);
      const outcome = await port.discoverSkills({ workingDirectory: root });
      const agentsTeam = outcome.skills.find(
        (skill) => skill.source === "bundled" && skill.name === AGENTS_TEAM_SKILL_NAME,
      );
      expect(agentsTeam?.path).toBe(join(AGENTS_TEAM_DIR, "SKILL.md"));
      const loaded = await port.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: root });
      expect(loaded.metadata.source).toBe("bundled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("门关：发现剔除 bundled agents-team，加载以 Skill not found 稳定拒绝，同包其余技能不连坐", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-agents-team-gate-closed-"));
    try {
      const port = runtimeFacePort(false);
      const outcome = await port.discoverSkills({ workingDirectory: root });
      expect(
        outcome.skills.some(
          (skill) => skill.source === "bundled" && skill.name === AGENTS_TEAM_SKILL_NAME,
        ),
      ).toBe(false);
      // 反向断言：门只剔 agents-team，同包的 dynamic-workflows 仍在。
      expect(
        outcome.skills.some(
          (skill) => skill.source === "bundled" && skill.name === "dynamic-workflows",
        ),
      ).toBe(true);
      await expect(
        port.loadSkill({ name: AGENTS_TEAM_SKILL_NAME, workingDirectory: root }),
      ).rejects.toThrow(`Skill not found: ${AGENTS_TEAM_SKILL_NAME}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
