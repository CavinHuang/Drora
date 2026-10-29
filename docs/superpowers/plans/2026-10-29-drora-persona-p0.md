# Drora Persona P0 实施计划（注入链路）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 personaEnabled 设置→env 桥→CLI 消费→persona 资产读取→system prompt 分节注入的完整链路（spec §3/§7/§8.2，验收 A1-A3、A9、A14、A15 的注入部分）。

**Architecture:** 照 agents-team 灰度桥的已验模式（settings→`desktopRuntimeEnv`→spawn env 烘焙→CLI `resolveXxxEnabled`），在 context builder 增加 stable persona 分节（四装配门），资产文件落 `${dataRoot}/persona/`（读取带 containedPath+realpath 校验）。P1（记忆）、P2（mood/气泡）各自另出计划。

**Tech Stack:** TypeScript monorepo（packages/shared·desktop·ui + apps/drora-cli core/contracts/bootstrap）、Zod、Vitest（CLI 测试必须在 `tests/` 目录）、Electron main。

**Spec:** `specs/drora-persona.md`（本计划从 spec 立论，执行者须同时读 spec §3/§7/§8 与 §10 验收表）。

## Global Constraints

- 所有 shell 命令先 `source /Users/cavinhuang/workspace/projects/Drora/.zcode/toolchain-env.sh`（pinned 工具链，裸 pnpm 会破坏 vendored node_modules）。
- **测试命令（计划审查实测，勿改写）**：shared/desktop 包无独立 test script——`pnpm --filter @drora/shared vitest run ...` 会报 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`，用根目录 `pnpm exec vitest run <path>`；CLI core 用 `pnpm --dir apps/drora-cli/packages/core exec vitest run tests/<file>`（必须带 `exec`，且勿用 `run test -- <file>`——script 是 `vitest tests`，会跑全量 288 文件）。
- CLI 测试只能放 `apps/drora-cli/packages/core/tests/`（bootstrap vitest 不收 `src/`）；**改 core 导出新符号后须先重建 core dist 再跑 bootstrap 相关测试**（stale dist 幻觉坑，同理 contracts/adapters）。
- `DRORA_PERSONA` 是既有 `DRORA_PERSONAL_*` env 的前缀——全链 grep 时注意辨别误命中。
- **`SANITIZED_RUNTIME_ENV_KEYS` 是剔除名单**：`DRORA_PERSONA_ENV` 只定义常量，绝不加入该名单（spec §7 反义措辞裁定）。
- 契约键单一出处：所有键字面量只出现在 `contracts/persona.ts`/`runtimeEnv.ts`，消费方 import。
- 不修改任何带「还原自发行 bundle」标记的文件；本计划涉及文件均经四轮审查确认无还原标记。
- bugfix 中文注释说明原因与依据；commit 粒度=每任务一提交。
- 门禁：根 `pnpm typecheck && pnpm lint && pnpm architecture:check --changed`；CLI 侧 `pnpm --dir apps/drora-cli check`（根 affected 不覆盖 apps/drora-cli）。

---

### Task 1: shared 契约层（persona.ts + 四处注册 + env 常量 + 设置键）

**Files:**
- Create: `packages/shared/src/contracts/persona.ts`
- Modify: `packages/shared/src/contracts/module.ts`（publicEntrypoints）
- Modify: `architecture-policy.yaml`（shared-contracts 段，与 module.ts 同步）
- Modify: `packages/shared/src/index.ts`（barrel re-export）
- Modify: `packages/shared/src/contracts/contract.ts:1-13`（头注释契约清单）
- Modify: `packages/shared/src/runtimeEnv.ts`（新常量，**不进** `SANITIZED_RUNTIME_ENV_KEYS`，L224 `DRORA_AGENTS_TEAM_ENV` 旁）
- Modify: `packages/shared/src/validationAppSettings.ts`（~L557 full schema 与 ~L692 patch schema 两处，`desktopPetEnabled` 邻位）
- Test: `packages/shared/test/personaContract.test.ts`（新建）

**Interfaces (Produces):**
- `PERSONA_CONTRACT.directory === "persona"`、`PERSONA_CONTRACT.soulFileName === "soul.md"`、`PERSONA_CONTRACT.worldviewFileName === "worldview.md"`、`PERSONA_CONTRACT.soulMaxChars === 4000`（草案值，spec §3.1）
- `DRORA_PERSONA_ENV: string`（runtimeEnv.ts 导出，值 `"DRORA_PERSONA"`）
- `AppSettings.personaEnabled: boolean`（default false）

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/test/personaContract.test.ts
import { describe, expect, it } from "vitest";
import { PERSONA_CONTRACT, DRORA_PERSONA_ENV, sanitizeDroraRuntimeEnv } from "../src/index.js";
import { appSettingsSchema } from "../src/validationAppSettings.js";

describe("persona contract", () => {
  it("路径段与文件名收口为单一出处", () => {
    expect(PERSONA_CONTRACT.directory).toBe("persona");
    expect(PERSONA_CONTRACT.soulFileName).toBe("soul.md");
    expect(PERSONA_CONTRACT.worldviewFileName).toBe("worldview.md");
  });
  it("DRORA_PERSONA_ENV 不在剔除名单（默认透传，spec §7）", () => {
    const env = { [DRORA_PERSONA_ENV]: "1", PATH: "/bin" };
    expect(sanitizeDroraRuntimeEnv(env)[DRORA_PERSONA_ENV]).toBe("1");
  });
  it("personaEnabled 默认 false，可 patch", () => {
    expect(appSettingsSchema.parse({}).personaEnabled).toBe(false);
    expect(appSettingsSchema.parse({ personaEnabled: true }).personaEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**：根目录 `pnpm exec vitest run packages/shared/test/personaContract.test.ts`（预期 import 报错不存在；`sanitizeDroraRuntimeEnv` 经 index.ts 星号导出 `export * from "./runtimeEnv.js"` 可直接 import；`appSettingsSchema` 是 preprocess 包装导出名，默认值实体在 `appSettingsObjectSchema` ~L509 起）
- [ ] **Step 3: 实现**——新建 `contracts/persona.ts`（照 desktopPet.ts 扁平 `as const` 风格：`export const PERSONA_CONTRACT = { directory: "persona", soulFileName: "soul.md", worldviewFileName: "worldview.md", soulMaxChars: 4000 } as const;`）；runtimeEnv.ts 加 `export const DRORA_PERSONA_ENV = "DRORA_PERSONA";`（注释：persona 灰度门 env 桥，不进剔除名单靠默认透传——照 DRORA_AGENTS_TEAM 语义）；validationAppSettings.ts 两处加 `personaEnabled: z.boolean().default(false)` / `personaEnabled: z.boolean().optional()`；四处注册（module.ts publicEntrypoints、architecture-policy.yaml、index.ts barrel、contract.ts 头注释）逐一补 `persona.ts`
- [ ] **Step 4: 跑测试确认通过**；再跑 `pnpm knip` 确认无未消费导出红线（本任务内 runtimeEnv 常量尚无消费方，若 knip 报，Task 5 接线后复跑——commit message 注明）
- [ ] **Step 5: Commit** `feat(shared): persona 契约常量、DRORA_PERSONA_ENV 与 personaEnabled 设置键`

### Task 2: desktop env 桥与 main 三段接线

**Files:**
- Modify: `packages/desktop/src/main/desktopRuntimeEnv.ts`（`resolveAgentsTeamHostEnv` ~L497-505 旁新增）
- Modify: `packages/desktop/src/main/index.ts`（三段：快照+refresh ~L1109-1117 / patch 分支 ~L1133-1135 / spawnHostProcess spread ~L1913-1919，全部照 agents-team 邻位代码）
- Test: `packages/desktop/test/desktopRuntimeEnv.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 1 的 `DRORA_PERSONA_ENV`
- Produces: `resolvePersonaHostEnv(setting: boolean | undefined): Record<string, string>`（语义：`setting === true ? { [DRORA_PERSONA_ENV]: "1" } : {}`——无 dev shell 透传过渡，persona 无历史 env 负担；off 不写键=已烘焙 Host 维持原状，spec §3.3 已知语义）

- [ ] **Step 1: 写失败测试**（desktopRuntimeEnv.test.ts 追加；**坑：该文件顶部 `vi.mock("@drora/shared")` 用显式键表工厂（~L50 含 DRORA_AGENTS_TEAM_ENV），新用例前必须把 `DRORA_PERSONA_ENV` 加进 mock 工厂导出，否则测试里恒 undefined**——照 ~L804-820 既有扩展风格）

```ts
it("persona env 桥：开=下发 1，关/缺省=不写键（off 不清已烘焙值）", () => {
  expect(resolvePersonaHostEnv(true)).toEqual({ [DRORA_PERSONA_ENV]: "1" });
  expect(resolvePersonaHostEnv(false)).toEqual({});
  expect(resolvePersonaHostEnv(undefined)).toEqual({});
});
```

- [ ] **Step 2: 确认失败**（函数未定义）→ **Step 3: 实现函数 + main/index.ts 三段接线**（每段照同文件 agents-team 邻位的写法：快照变量读 `AppSettings.personaEnabled`、patch 分支处理设置增量、spawn spread 合并 `resolvePersonaHostEnv` 结果；中文注释「persona 灰度 env 桥，生效单位=新 Host 进程（spec §3.3）」）
- [ ] **Step 4: 跑 desktop 包测试通过** → **Step 5: Commit** `feat(desktop): persona env 桥接线（新 Host 生效语义）`

### Task 3: persona 共享内核 + CLI 资产读取（含路径对抗校验）

**Files:**
- Create: `packages/shared/src/personaAssets.ts`（**共享内核：模板文案+回退判定+路径校验纯函数——经计划审查裁定单一出处，desktop main 侧 Task 6 复用，防模板双出处**）+ barrel 导出
- Create: `apps/drora-cli/packages/core/src/persona/persona-assets.ts`（仅 IO 层：读盘+调 shared 纯函数）
- Create: `apps/drora-cli/packages/core/src/persona/persona-config.ts`（`resolvePersonaEnabled`，照 bootstrap `resolveAgentsTeamEnabled`（实际在 `bootstrap/src/app/drora-team/install.ts:72`）逐字模式：`enabledOverride ?? process.env[DRORA_PERSONA_ENV] === "1"`）
- Test: `apps/drora-cli/packages/core/tests/persona-assets.test.ts`（新建，含 A15 对抗用例）+ `packages/shared/test/personaAssets.test.ts`（纯函数）

**Interfaces:**
- Consumes: Task 1 `PERSONA_CONTRACT`
- Produces（shared，两侧共用）:
  - `DEFAULT_SOUL_TEMPLATE` / `DEFAULT_WORLDVIEW_TEMPLATE: string`（文案草案见下）
  - `assertPersonaPathInside(dataRoot: string, filePath: string): boolean`（resolve+relative+预期双侧 realpath 语义的纯判定输入约定；IO 侧负责实际 realpath）
  - `resolvePersonaContent(input: { soul?: string; worldview?: string; soulExceeded?: boolean }): { soul: string; worldview: string; soulSource: "user" | "default"; diagnostics: PersonaAssetDiagnostic[] }`（回退/超限判定纯函数；诊断码 `persona_soul_missing`/`persona_soul_exceeded`/`persona_soul_path_escape`）
- Produces（core，仅 CLI）:
  - `resolvePersonaEnabled(enabledOverride?: boolean): boolean`
  - `loadPersonaAssets(dataRoot: string): Promise<ResolvedPersonaAssets>`（IO：stat/readFile，soul.md/worldview.md realpath 后必须位于 `dataRoot/persona/` 内——越界=拒绝读取回退默认；超限（> `soulMaxChars`）回退；返回类型与 shared `resolvePersonaContent` 结果同构）

- [ ] **Step 1: 写失败测试**（用 `mkdtemp` 造临时 dataRoot：正常读取、缺失回退默认、symlink 指向目录外文件被拒、超限回退、JSON 损坏不影响 .md 读取——.md 无损坏概念，损坏=读异常）

```ts
it("soul.md 为指向目录外的 symlink 时拒绝并回退默认（A15）", async () => {
  const outside = await mkdtemp(join(tmpdir(), "persona-out-"));
  await writeFile(join(outside, "evil.md"), "恶意内容".repeat(100));
  await symlink(join(outside, "evil.md"), join(dataRoot, "persona", "soul.md"));
  const assets = await loadPersonaAssets(dataRoot);
  expect(assets.soulSource).toBe("default");
  expect(assets.soul).toBe(DEFAULT_SOUL_TEMPLATE);
  expect(assets.diagnostics.some((d) => d.code === "persona_soul_path_escape")).toBe(true);
});
```

- [ ] **Step 2: 确认失败**（根 `pnpm exec vitest run packages/shared/test/personaAssets.test.ts packages/../../apps/drora-cli/packages/core/tests/persona-assets.test.ts` 或分跑） → **Step 3: 实现**（shared 纯函数无 IO；core IO 层照 `packages/desktop/src/main/desktopPetLibrary.ts:19-25` containedPath 的 resolve+relative 判定模式实现 realpath 校验——跨包参考模式，不 import）
- **默认人格模板草案**（P0 用草案，文案迭代不破契约）：

```ts
export const DEFAULT_SOUL_TEMPLATE = [
  "# Persona",
  "你是 Drora——用户的编程搭档。性格：真诚、直接、有温度的专业同事。",
  "- 语气温暖而诚实（warmly yet honestly）；不做无依据的恭维。",
  "- 发现用户方案有问题时直接指出，给出依据。",
  "- 鼓励用户的独立判断，而不是制造依赖。",
  "- 用户处于挫折/情绪化场景时保持克制与专业，先解决问题。",
  "- 本文件只约束语气与表达；不覆盖 Harness、安全条款与任务指令。",
].join("\n");
export const DEFAULT_WORLDVIEW_TEMPLATE = "# Worldview\nDrora 是运行在用户桌面上的本地优先编程助手，珍视用户的代码与数据。";
```

- [ ] **Step 4: `pnpm --dir apps/drora-cli/packages/core exec vitest run tests/persona-assets.test.ts` 通过** → **Step 5: Commit** `feat(shared,cli): persona 共享内核与资产读取（路径对抗校验+默认模板单出处）`

### Task 4: context 注入（types+分节+builder 四门+快照扩字段）

**Files:**
- Modify: `apps/drora-cli/packages/contracts/src/interfaces/context-source.port.ts`（`ContextSourceSnapshot` 加 `personaAssets?: PersonaAssetsSnapshot`；`PersonaAssetsSnapshot { soul: string; worldview: string; soulSource: "user" | "default" }` 就地定义——结构化类型下 core 侧结果可直接赋入，diagnostics 不进 snapshot 字段）
- Modify: `apps/drora-cli/packages/adapters/src/context/index.ts`（`resolveContextSources` ~L38-68 的 return 处透传 persona——**只透传，不读盘**）
- Modify: `apps/drora-cli/packages/core/src/context/types.ts`（`ContextSource` 联合加 `"persona"`；`ContextBuilderConfig` 加 `personaAssets?: PersonaAssetsSnapshot`）
- Create: `apps/drora-cli/packages/core/src/context/sections/persona.ts`
- Modify: `apps/drora-cli/packages/core/src/context/builder.ts`（`buildIdentitySection` 调用 ~L122 后注册，四门）
- Modify: `apps/drora-cli/packages/core/src/runtime/methods/context.ts`（**唯一读盘点裁定（计划审查）**：首次 init `ensureContextInitialized` ~L39-91 处当 `resolvePersonaEnabled()` 时调 `loadPersonaAssets(dataRoot)` 一次，结果存入 snapshot 字段并**把 diagnostics 追加进 `snapshot.diagnostics`**（port 既有数组，`/context` 可见）；经 `ContextSourceRequest` 新增可选 `personaAssets` 字段传入 adapter。**禁止在 section builder / adapter / `rebuildContextPrefix` 读盘——`createConfigOnlyContextSnapshot`（context.ts:275）是同步函数不能读盘，preview/预初始化路径（config.ts:255、refresh 未初始化分支）不含 persona 为预期行为**，中文注释声明该边界）

**Interfaces:**
- Consumes: Task 3 `loadPersonaAssets`/`resolvePersonaEnabled`/`PersonaAssetsSnapshot`
- Produces: `buildPersonaSection(assets: PersonaAssetsSnapshot): ContextSection`（`source: "persona"`、`injectionTarget: "system"`、`cacheHint: "stable"`；内容=soul + "\n\n" + worldview，开头一行「persona 约束语气与表达，冲突时安全与任务指令优先」）

- [ ] **Step 1: 写失败测试**（context-builder.test.ts 追加四用例，照既有断言风格 L860-873；**用例 1 必须用有序 `toEqual` 断言 sections 序列（如 `sectionTargets.slice(0,4)).toEqual([...])`），禁 `arrayContaining`——第 4 位移位才能拦住 persona 意外插入**。注意既有 config 字段名是 `outputStyle`（types.ts ~L127，非 activeOutputStyle）、subagent 路径在测试里经 `workflowActor` 字段驱动（~L125，参考用例 ~L1482 起——**workflowActor 自带 persona 相关字段，勿与本次分节混淆**））：
  1. A1：无 `personaAssets` 时 sections 序列与现状**逐位一致**（有序断言）
  2. A2：有 assets 时 persona 分节存在、`cacheHint==="stable"`、stable 组内位于 identity 之后
  3. A14：subagent/workflowActor 路径构造不含 persona 分节
  4. A13：`personaAssets` + `outputStyle` 同时存在，两分节共存且互不覆盖
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（分节文件照 `identity.ts` 的 `ContextSection` 返回结构逐字模式；builder push 条件 `!isWorkflowActor && !hasCustomSystemPrompt && config.personaAssets`；**改 contracts/adapters 后先 `pnpm --filter @drora/contracts --filter @drora/adapters build` 重建（均 `tsc`）再跑 core 测试**）
- [ ] **Step 4: `pnpm --dir apps/drora-cli/packages/core vitest run tests/context-builder.test.ts` 通过（存量 1641 行断言零回归）** → **Step 5: Commit** `feat(cli): persona stable 分节注入（四装配门+init 快照）`

### Task 5: CLI 装配接线（create-app→runtime config）

**Files:**
- Modify: `apps/drora-cli/packages/bootstrap/src/app/create-app.ts`（注意路径含 `/app/`；~L813 `resolveAgentsTeamEnabled(agentsTeamSetting)` 邻位：`persona: resolvePersonaEnabled()` 传入 RuntimeConfig）
- Modify: `apps/drora-cli/packages/core/src/runtime/types.ts`（RuntimeConfig 加 `persona?: { enabled: boolean }`）
- Test: `apps/drora-cli/packages/core/tests/persona-config.test.ts`（Task 3 已建文件追加装配用例；grep 参考命中：`tests/protocol-slash-commands.test.ts`、`tests/agents-team-skill-gate.test.ts` 为 bootstrap 侧邻域测试）

**Interfaces:**
- Consumes: Task 3 `resolvePersonaEnabled`；Task 4 config 字段
- Produces: env `DRORA_PERSONA=1` 的桌面新 Host 会话 → `/context` 可见 Persona 分节（A2 全链路）

- [ ] **Step 1: 写失败测试**：`resolvePersonaEnabled` 三态（env "1"→true、缺省→false、override 显式优先）
- [ ] **Step 2-4: 实现+通过**（create-app 接线一行 + types 扩展；**`resolvePersonaEnabled` 须从 core 的 index 导出且先重建 core dist（`pnpm --filter @drora/core build`）**——bootstrap 经 dist 引用 core；注释「persona 生效单位=新 Host 进程，env 烘焙语义见 spec §3.3」）
- [ ] **Step 5: Commit** `feat(cli): persona env 装配进 RuntimeConfig`

### Task 6: IPlatformService 只读四层链（设置页人格状态）

**Files:**
- Modify: `packages/shared/src/platform.ts`（~L913-920 可选方法邻位加 `readPersonaAssets?(): Promise<PersonaAssetsOverview | null>`，`PersonaAssetsOverview = { soulSource: "user" | "default"; soulPreview: string; directory: string }`——类型定义放 platform.ts 就地，soulPreview 截 200 字符）
- Modify: `packages/desktop/src/drora-extensions/`（新实现文件 `personaAssetsExtension.ts`，调 main 的读取；**该目录属 managed 模块，新文件登记其 module.ts publicEntrypoints**）+ preload/renderer 桥接（`packages/desktop/src/preload/index.ts` ~L793 desktopPet 邻位 + renderer `desktopPlatform.ts`）
- Test: `packages/desktop/test/personaAssetsExtension.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `PERSONA_CONTRACT`；Task 3 shared 内核（**desktop 无 CLI core 依赖——经计划审查裁定：main 侧 IO 自行读文件，模板/回退/校验全部调 shared `personaAssets.ts` 纯函数，无复制**）
- Produces: hook `usePersonaAssets()`（packages/ui/src/hooks/）供设置行消费

- [ ] **Step 1: 写失败测试**（路径校验纯函数两侧共用用例 + overview 截断）
- [ ] **Step 2-4: 四层逐层实现并跑通单测**（Web 平台方法缺席=hook 返回 null，不报错——照桌宠 Web 无控件先例）
- [ ] **Step 5: Commit** `feat(platform): persona 资产只读四层链（校验函数单一出处）`

### Task 7: 设置行 UI + i18n 双词典

**Files:**
- Create: `packages/ui/src/settings/PersonaSettingsRow.tsx`（照 `DesktopPetSettingsRow` 结构：Switch + 状态文案「自定义人格/默认人格」+ 打开目录按钮；**外层 `isDesktop` 门由 SettingsPage 控制，与 DesktopPetSettingsRow 同位**）
- Modify: `packages/ui/src/SettingsPage.tsx`（~L2252-2256 general 区、DesktopPetSettingsRow 后追加）
- Modify: `packages/ui/src/i18n/locales/zh-CN.ts` + `en-US.ts`（键：`settings.persona`、`settings.personaDescription`、`settings.personaCustom`、`settings.personaDefault`、`settings.personaOpenFolder`；两文件同批加，漏加无 CI 兜底只显示 key id——测试断言双词典）
- Test: `packages/ui/test/personaSettingsI18n.test.ts`（新建，照 `chatErrorBannerI18n` 双语断言惯例）

- [ ] **Step 1: 写失败测试**（zh/en 两词典均含五键且值非空；组件渲染快照含开关与状态徽标）
- [ ] **Step 2-4: 实现通过**（文案注明「开启后需新窗口/重启生效」——spec §3.3 生效粒度的用户可见文案）
- [ ] **Step 5: Commit** `feat(ui): persona 设置行（isDesktop 门+双词典）`

### Task 8: 治理登记与 P0 门禁总验收

**Files:**
- Modify: `specs/drora-divergence-ledger.md`（新条目：**「台账 9」**，现有至台账 8；四要素格式照旧）
- Modify: `.agents/skills/feature-boundary-planner/references/drora-feature-graph.yaml`（**两个新节点**：`surface.persona` 与人格设置分区；**10 条 must-inspect 边**——spec §9 实列 10 条：app-settings 1 + project-memory 系 4 + env/host 3 + subagent 2）
- Modify: `specs/drora-persona.md`（Status 行改 `P0 shipped`；范围裁剪回写两处：§11 P0 的「读写」改为「读」、**§10 A15 拆分为读侧（P0：symlink 拒绝+尺寸上限）与写侧（P1：设置页写入校验）**）

- [ ] **Step 1: 登记 divergence ledger 与 feature-graph**（照两个文件既有条目格式逐字对齐）
- [ ] **Step 2: 全量门禁**：`pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm architecture:check --changed && pnpm --dir apps/drora-cli check && pnpm knip`——全部真实通过并记录输出（A10）
- [ ] **Step 3: 手动验收 A2/A9**（dev 环境 `pnpm dev:desktop` 重启序=TaskStop→pgrep 停净→cd 仓库根；开关开→新窗口→会话 `/context` 见 Persona 分节；关→新窗口回基线）。**A2 为 P0 shipped 的硬性条件：本步未执行不得将 spec Status 标为 P0 shipped（可标 P0 code-complete 待手验）**
- [ ] **Step 4: Commit** `chore(spec): persona divergence/feature-graph 登记与 P0 状态回写`

---

## Self-Review 结论

- **Spec 覆盖**：§3.1 资产=Task 3；§3.2 注入与四门=Task 4；§3.3 开关/env=Task 1/2/5；§7 契约=Task 1/6；§8.2 路径校验=Task 3/6；§8.3 agent 写 deny=P0 无 agent 写路径（结构性满足，P1 记忆任务再显式守护）；§9 登记=Task 8。验收 A1/A2/A3/A9/A14/A15 覆盖（A15 拆读写：读侧 P0/写侧 P1，随 Task 8 回写 spec）；A13 在 Task 4 顺带锁定。
- **计划审查修订（两路 subagent）已并入**：3 个必爆命令修正（shared/desktop 用根 `pnpm exec vitest run`、CLI core 用 `--dir ... exec vitest run`）；Task 4 唯一读盘点裁定（core init 一次、adapter 只透传、`createConfigOnlyContextSnapshot` 同步路径不含 persona 为预期）；Task 3/6 共享内核方案（模板/回退/校验纯函数落 shared 单出处，IO 各自实现）；测试符号修正（`outputStyle` 非 activeOutputStyle、workflowActor 驱动 subagent 用例、有序 toEqual 断言）；vi.mock 键表坑、`/app/` 路径、core dist 重建、台账 9、10 边两节点、A2 shipped 硬条件。
- **已知范围裁剪**（显式声明）：persona 文件**写**路径延至 P1（A15 拆分随 Task 8 回写 spec）；soul 文案为草案（Task 3，迭代不破契约）。
- **类型一致性**：`PersonaAssetsSnapshot`（port 就地定义）与 core `ResolvedPersonaAssets` 结构兼容（diagnostics 只进 `snapshot.diagnostics` 不进分节）；`readPersonaAssets`/`usePersonaAssets` 命名 Task 6/7 对齐。
