/**
 * R7 验收包（安全写边界）：G31 + G32 + G40 + L1 hook 边界，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 * 语义按 2026-10-17 S03_CLOSEOUT_2026-10-17.md / specs/obsidian-knowledge.md
 * §5e.12 现行口径验收：desktop-local 装配门已定向放行（node.ts 经
 * isReleasedReviewWriteAuthority），L1/L2 两个用户开关默认双关；
 * 旧「L2 永不可开 / 生产恒 writeSafetyGatePassed=false」表述不再作为断言。
 *
 * - G31（现行口径）：生产桌面打开审核视图——装配门放行（L2 开关可用、
 *   无 S03 NO-GO 横幅）但默认双关（L2 与 agent writes 均未勾选）；
 *   L2 关闭时提案浏览/精确预览/批准/拒绝全部可用；纯查看与审批不落盘。
 * - G32：双开缺一不可。手改 vault-config.json reviewWritePathEnabled=true
 *   （不重启、不走 UI 开关）不能获得写权限：引擎 isWritePathEnabled 仍
 *   false、UI 开关仍未勾选、绕过 UI 直调 applyProposal 返回结构化
 *   write_path_disabled、文件零触碰。经 UI 双开（L1+L2）后 apply 才真实
 *   落盘；撤销 L2 后 undo 直调同样 write_path_disabled、文件保持 applied 态。
 * - G40：L2 关闭时只读 reconcile 不被写开关阻断（reconcileOperation 返回
 *   not_applicable 而非 write_path_disabled）；undo 必须检查当前写授权。
 * - L1 边界：真实 host 写出的 vault-config.json + 仓库真实 hook 产物
 *   （build-desktop-agent-cli.mjs 构建 @drora/obsidian-plugin，与 agent
 *   runtime seed 同源，official-plugin-definitions.ts requiredSeedPaths）
 *   spawn 实调：allowAgentWrites=false 时 Write/Edit 一律静默（不自动放行）；
 *   =true 时仅根内普通非隐藏 .md 的 Write/Edit 自动 allow；隐藏段/点文件/
 *   非 .md/根外相对/根外绝对/软链目录/软链文件一律静默；Bash/node_repl/MCP
 *   工具名不经本 hook 放行（静默交回运行时默认问询）。
 *
 * 边界：真实 Electron main/host/renderer RPC + 真实托管 Vault 文件（隔离
 * E2E HOME）；无模型调用。apply/undo/reconcile 直调从 renderer React
 * Context 拿到与 UI 相同的 knowledgeReviewService 代理，证明服务端硬门
 * 不依赖 UI 按钮 disabled 状态（renderer 被绕过时仍 fail-closed）。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";

const E2E_HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || E2E_HOME);
const PLUGIN_DATA_DIR = join(DATA_BASE, ".drora", "cli", "data", "obsidian@drora-plugins-official");
const VAULT_ROOT = join(PLUGIN_DATA_DIR, "managed-vault");
const VAULT_CONFIG = join(PLUGIN_DATA_DIR, "vault-config.json");
const OUTSIDE_DIR = join(E2E_HOME, ".drora", "r7-l1-outside");
// 与 agent runtime seed 同源的真实 hook 产物（requiredDevPluginRuntimeBuilds
// 构建 @drora/obsidian-plugin；运行时 requiredSeedPaths 同样取 dist/hooks）。
const PERMISSION_HOOK = resolve(
  process.cwd(),
  "../../apps/drora-cli/packages/obsidian-plugin/dist/hooks/permission-request.mjs",
);
const NOTE_NAME = "R7-Write-Boundary-Note.md";
const NOTE_FILE = join(VAULT_ROOT, NOTE_NAME);
const NOTE_BODY = [
  "# R7 write boundary evidence",
  "",
  "R7WriteBoundaryToken2026 is the protected original for L2 apply/undo checks.",
  "",
].join("\n");
const PROPOSED_A = NOTE_BODY + "\nR7 proposal A: dual opt-in approved write.\n";
const PROPOSED_B = NOTE_BODY + "\nR7 proposal B: to be rejected, never written.\n";
const TITLE_A = "R7 dual-switch proposal A";
const TITLE_B = "R7 reject-path proposal B";
const SUB_NOTE = join(VAULT_ROOT, "notes", "sub.md");
const APPROVE_ZH_EN = ["批准", "Approve"];
const REJECT_ZH_EN = ["拒绝", "Reject"];

interface ToggleSnapshot {
  noGo: boolean;
  enabled: boolean;
  checked: string | null;
  agentChecked: string | null;
}

interface ReviewRpcOutcome {
  accessorFound: boolean;
  proposalFound: boolean;
  writePathEnabled: boolean | null;
  outcome: string | null;
  reason: string | null;
  message: string | null;
}

interface HookProbeResult {
  name: string;
  expect: "allow" | "silent";
  status: number | null;
  stdout: string;
}

function assertSandbox(): void {
  assert.equal(DATA_BASE, E2E_HOME, "R7 refuses a different DRORA_DATA_BASE_DIR");
  assert.match(E2E_HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R7 requires isolated .e2e-home");
  assert.ok(NOTE_FILE.startsWith(join(E2E_HOME, ".drora") + sep));
  assert.ok(OUTSIDE_DIR.startsWith(join(E2E_HOME, ".drora") + sep));
}

async function waitForVisible(selector: string, label: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute((target) => {
        const element = document.querySelector<HTMLElement>(target);
        return Boolean(
          element &&
          element.getClientRects().length > 0 &&
          !(element instanceof HTMLButtonElement && element.disabled),
        );
      }, selector),
    { timeout, timeoutMsg: `R7 ${label} not visible/enabled: ${selector}` },
  );
}

async function clickControl(selector: string, label: string): Promise<void> {
  await waitForVisible(selector, label);
  const clicked = await browser.execute((target) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  assert.equal(clicked, true, `R7 failed clicking ${label}`);
}

/** 关闭可能阻塞真实输入的后台 alert（只点用户可见的 Cancel，绝不点确认）。 */
async function dismissBlockingVaultDialog(): Promise<void> {
  const modal = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"][data-state="open"]');
    if (!dialog) return null;
    return {
      title: dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent?.trim() ?? "",
      cancel: Boolean(
        dialog.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]:not(:disabled)'),
      ),
    };
  });
  if (!modal) return;
  assert.equal(modal.cancel, true, `R7 found an un-dismissable modal: ${modal.title}`);
  await browser.execute(() => {
    const cancel = document.querySelector<HTMLButtonElement>(
      '[role="alertdialog"][data-state="open"] [data-slot="alert-dialog-cancel"]',
    );
    cancel?.click();
  });
  await browser.waitUntil(
    () =>
      browser.execute(
        () => !document.querySelector('[data-slot="alert-dialog-overlay"][data-state="open"]'),
      ),
    { timeout: 10_000, timeoutMsg: `R7 modal failed to close: ${modal.title}` },
  );
}

async function readToggleState(): Promise<ToggleSnapshot> {
  return browser.execute(() => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="review-write-path-toggle"] [role="switch"]',
    );
    const agent = document.querySelector<HTMLButtonElement>(
      '[data-testid="review-agent-writes-toggle"] [role="switch"]',
    );
    return {
      noGo: Boolean(document.querySelector('[data-testid="review-write-safety-gate-blocked"]')),
      enabled: !toggle?.disabled,
      checked: toggle?.getAttribute("aria-checked") ?? null,
      agentChecked: agent?.getAttribute("aria-checked") ?? null,
    };
  });
}

async function waitForProposalCard(
  title: string,
  phase: string | null,
  timeout = 30_000,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (cardTitle, cardPhase) =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
          ).some(
            (card) =>
              (card.textContent ?? "").includes(cardTitle) &&
              (cardPhase === null || card.getAttribute("data-proposal-phase") === cardPhase),
          ),
        title,
        phase ?? null,
      ),
    { timeout, timeoutMsg: `R7 proposal card missing: ${title} (${phase ?? "any"})` },
  );
}

/** 卡片内作用域控件点击（提案列表按创建倒序，同名 testid 会命中其他卡片）。 */
async function clickCardScopedControl(
  title: string,
  selector: string,
  label: string,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (cardTitle, target) => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
          ).find((el) => (el.textContent ?? "").includes(cardTitle));
          const control = card?.querySelector<HTMLElement>(target);
          return Boolean(
            control &&
            control.getClientRects().length > 0 &&
            !(control instanceof HTMLButtonElement && control.disabled),
          );
        },
        title,
        selector,
      ),
    { timeout: 30_000, timeoutMsg: `R7 ${label} not visible/enabled` },
  );
  const clicked = await browser.execute(
    (cardTitle, target) => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
      ).find((el) => (el.textContent ?? "").includes(cardTitle));
      const control = card?.querySelector<HTMLElement>(target);
      if (!control) return false;
      control.click();
      return true;
    },
    title,
    selector,
  );
  assert.equal(clicked, true, `R7 failed clicking ${label}`);
}

async function previewProposalChange(title: string, marker: string): Promise<void> {
  const opened = await browser.execute((cardTitle) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
    ).find((el) => (el.textContent ?? "").includes(cardTitle));
    const toggle = card?.querySelector<HTMLButtonElement>('[data-testid="review-change-toggle"]');
    if (!toggle || toggle.disabled) return false;
    toggle.click();
    return true;
  }, title);
  assert.equal(opened, true, `R7 change preview toggle unavailable for ${title}`);
  await browser.waitUntil(
    () =>
      browser.execute(
        (cardTitle, token) => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
          ).find((el) => (el.textContent ?? "").includes(cardTitle));
          return Boolean(
            card
              ?.querySelector('[data-testid="review-change-content"]')
              ?.textContent?.includes(token),
          );
        },
        title,
        marker,
      ),
    { timeout: 30_000, timeoutMsg: `R7 preview content missing for ${title}` },
  );
}

async function clickCardAction(title: string, labels: string[]): Promise<void> {
  const clicked = await browser.execute(
    (cardTitle, actionLabels) => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
      ).find((el) => (el.textContent ?? "").includes(cardTitle));
      const action = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (button) => actionLabels.includes(button.textContent?.trim() ?? ""),
      );
      if (!action || action.disabled) return false;
      action.click();
      return true;
    },
    title,
    labels,
  );
  assert.equal(clicked, true, `R7 card action ${labels.join("/")} unavailable for ${title}`);
}

async function fillProposal(params: {
  title: string;
  reason: string;
  content: string;
  clearFirst: boolean;
}): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const editor = document.querySelector<HTMLInputElement>(
          '[data-testid="review-proposal-title"]',
        );
        return Boolean(editor && !editor.disabled && editor.getClientRects().length > 0);
      }),
    { timeout: 30_000, timeoutMsg: "R7 proposal form is still locked" },
  );
  const selectAll = [process.platform === "darwin" ? "Meta" : "Control", "a"];
  await dismissBlockingVaultDialog();
  await $('[data-testid="review-proposal-kind"]').selectByAttribute("value", "write");
  await dismissBlockingVaultDialog();
  await $('[data-testid="review-proposal-title"]').click();
  if (params.clearFirst) await browser.keys(selectAll);
  await browser.keys(params.title);
  await dismissBlockingVaultDialog();
  await $('[data-testid="review-proposal-path"]').click();
  if (params.clearFirst) await browser.keys(selectAll);
  await browser.keys(NOTE_NAME);
  await dismissBlockingVaultDialog();
  await $('[data-testid="review-proposal-reason"]').click();
  if (params.clearFirst) await browser.keys(selectAll);
  await browser.keys(params.reason);
  await browser.waitUntil(
    () =>
      browser.execute((path) => {
        const input = document.querySelector<HTMLInputElement>(
          '[data-testid="review-proposal-path"]',
        );
        const select = document.querySelector<HTMLSelectElement>(
          '[data-testid="review-proposal-kind"]',
        );
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="review-proposal-load"]',
        );
        return (
          input?.value === path && select?.value === "write" && Boolean(button && !button.disabled)
        );
      }, NOTE_NAME),
    { timeout: 30_000, timeoutMsg: "R7 form did not accept real WebDriver inputs" },
  );
  await clickControl('[data-testid="review-proposal-load"]', "load current Vault Markdown");
  await browser.waitUntil(
    () =>
      browser.execute((body) => {
        const status = document.querySelector<HTMLElement>(
          '[data-testid="review-proposal-load-status"]',
        );
        const editor = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="review-proposal-content"]',
        );
        return (
          status?.getAttribute("data-loaded") === "true" &&
          Boolean(editor && !editor.disabled && editor.value === body)
        );
      }, NOTE_BODY),
    { timeout: 30_000, timeoutMsg: "R7 original note never finished loading" },
  );
  const contentEditor = await $('[data-testid="review-proposal-content"]');
  await dismissBlockingVaultDialog();
  await contentEditor.click();
  await browser.keys(selectAll);
  await browser.keys(params.content);
  await browser.waitUntil(async () => (await contentEditor.getValue()) === params.content, {
    timeout: 30_000,
    timeoutMsg: "R7 React editor did not accept keyboard-entered Markdown",
  });
  await clickControl('[data-testid="review-proposal-submit"]', "persist real L2 proposal");
  await waitForVisible('[data-testid="review-proposal-created"]', "L2 proposal created");
}

/**
 * 绕过 UI 的 disabled 按钮直调真实 review RPC（与 UI 同一 service 代理）：
 * state=读 isWritePathEnabled；applyByTitle/undoByProposalTitle/
 * reconcileByProposalTitle=按标题定位后调用对应 RPC。
 *
 * accessor 发现：从审核视图 DOM 沿 React fiber 走到 ServiceProvider 的 value。
 * 注意 renderer 侧的 reviewService 是 ProxyChannel.toService 代理——只有 get
 * trap、没有 has/keys，因此判型必须用 typeof 取值，不能用 `in`/Object.keys。
 */
async function rpcReview(request: {
  op: "state" | "applyByTitle" | "undoByProposalTitle" | "reconcileByProposalTitle";
  title?: string;
}): Promise<ReviewRpcOutcome> {
  return browser.execute(
    async (payload: { op: string; title?: string }) => {
      interface FiberLike {
        memoizedProps?: { value?: unknown };
        type?: { _currentValue?: unknown };
        return?: FiberLike | null;
      }
      interface ReviewServiceLike {
        isWritePathEnabled: () => Promise<boolean>;
        listProposals: () => Promise<unknown>;
        applyProposal: (param: unknown) => Promise<unknown>;
        listRecentOperations: () => Promise<unknown>;
        undoOperation: (param: unknown) => Promise<unknown>;
        reconcileOperation: (param: unknown) => Promise<unknown>;
      }
      const empty: {
        accessorFound: boolean;
        proposalFound: boolean;
        writePathEnabled: boolean | null;
        outcome: string | null;
        reason: string | null;
        message: string | null;
      } = {
        accessorFound: false,
        proposalFound: false,
        writePathEnabled: null,
        outcome: null,
        reason: null,
        message: null,
      };
      const host = document.querySelector('[data-testid="knowledge-review-view"]');
      if (!host) return empty;
      const fiberKey = Object.keys(host).find((key) => key.startsWith("__reactFiber$"));
      if (!fiberKey) return empty;
      let accessor: Record<string, unknown> | null = null;
      let fiber = (host as unknown as Record<string, unknown>)[fiberKey] as
        | FiberLike
        | null
        | undefined;
      while (fiber && !accessor) {
        for (const candidate of [fiber.memoizedProps?.value, fiber.type?._currentValue]) {
          if (!candidate || typeof candidate !== "object") continue;
          const review = (candidate as Record<string, unknown>).knowledgeReviewService;
          if (
            review &&
            (typeof review === "object" || typeof review === "function") &&
            typeof (review as ReviewServiceLike).applyProposal === "function"
          ) {
            accessor = candidate as Record<string, unknown>;
            break;
          }
        }
        fiber = fiber.return ?? null;
      }
      if (!accessor) return empty;
      const review = accessor.knowledgeReviewService as unknown as ReviewServiceLike;
      const enabled = await review.isWritePathEnabled();
      const base = { ...empty, accessorFound: true, writePathEnabled: enabled };
      if (payload.op === "state") return base;
      const list = (await review.listProposals()) as Array<{ title?: string; proposalId?: string }>;
      const proposal = (Array.isArray(list) ? list : []).find(
        (item) => item?.title === payload.title,
      );
      if (!proposal?.proposalId) return base;
      if (payload.op === "applyByTitle") {
        const result = (await review.applyProposal({
          proposalId: proposal.proposalId,
          operationId: crypto.randomUUID(),
        })) as { outcome?: string; reason?: string; message?: string };
        return {
          ...base,
          proposalFound: true,
          outcome: result?.outcome ?? null,
          reason: result?.reason ?? null,
          message: result?.message ?? null,
        };
      }
      const history = (await review.listRecentOperations()) as Array<{
        proposalId?: string;
        operationId?: string;
      }>;
      const operation = (Array.isArray(history) ? history : []).find(
        (item) => item?.proposalId === proposal.proposalId && item.operationId,
      );
      if (!operation?.operationId) {
        return {
          ...base,
          proposalFound: true,
          outcome: "no-operation",
          reason: "no-operation-for-proposal",
        };
      }
      const method = payload.op === "undoByProposalTitle" ? "undoOperation" : "reconcileOperation";
      const result = (await review[method]({ operationId: operation.operationId })) as {
        outcome?: string;
        reason?: string;
        message?: string;
      };
      return {
        ...base,
        proposalFound: true,
        outcome: result?.outcome ?? null,
        reason: result?.reason ?? null,
        message: result?.message ?? null,
      };
    },
    request as unknown as { op: string; title?: string },
  );
}

async function readVaultConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(VAULT_CONFIG, "utf8")) as Record<string, unknown>;
}

async function waitForVaultConfigField(
  field: string,
  expected: boolean,
  timeout = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const config = await readVaultConfig().catch(() => null);
    if (config && config[field] === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`R7 vault-config.json field ${field} did not become ${expected}`);
    }
    await new Promise((delay) => setTimeout(delay, 300));
  }
}

/** 手改偏好文件（模拟绕过 UI 的本地编辑；其余字段原样保留）。 */
async function handEditReviewWritePathPreference(enabled: boolean): Promise<void> {
  const config = await readVaultConfig();
  config.reviewWritePathEnabled = enabled;
  await writeFile(VAULT_CONFIG, JSON.stringify(config, null, 2), "utf8");
}

function runPermissionHook(stdin: Record<string, unknown>): {
  status: number | null;
  stdout: string;
} {
  const result = spawnSync(process.execPath, [PERMISSION_HOOK], {
    input: `${JSON.stringify(stdin)}\n`,
    encoding: "utf8",
    env: { ...process.env, DRORA_PLUGIN_DATA: PLUGIN_DATA_DIR },
    timeout: 20_000,
  });
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

function assertHookProbe(probe: HookProbeResult): void {
  const isAllow = probe.stdout.startsWith("{");
  if (probe.expect === "allow") {
    assert.equal(probe.status, 0, `${probe.name}: hook exit ${probe.status}`);
    assert.equal(isAllow, true, `${probe.name}: expected allow decision, got silent`);
    const decision = JSON.parse(probe.stdout) as {
      hookSpecificOutput?: { decision?: { behavior?: string } };
    };
    assert.equal(
      decision.hookSpecificOutput?.decision?.behavior,
      "allow",
      `${probe.name}: unexpected decision payload`,
    );
  } else {
    assert.equal(probe.status, 0, `${probe.name}: hook exit ${probe.status}`);
    assert.equal(
      probe.stdout,
      "",
      `${probe.name}: expected silence (no auto-allow), got "${probe.stdout}"`,
    );
  }
}

describe("R7 write boundary acceptance: G31 + G32 + G40 + L1 hook matrix", () => {
  let proposalAReady = false;

  before(async function () {
    this.timeout(300_000);
    assertSandbox();
    assert.equal(
      existsSync(PERMISSION_HOOK),
      true,
      `R7 real permission hook artifact missing: ${PERMISSION_HOOK} (run node scripts/build-desktop-agent-cli.mjs)`,
    );
    // 本包自有的隔离 Vault 夹具（含 L1 hook 矩阵所需文件/软链）。
    await mkdir(join(VAULT_ROOT, "notes"), { recursive: true });
    await writeFile(NOTE_FILE, NOTE_BODY, { encoding: "utf8", flag: "wx" });
    await writeFile(SUB_NOTE, "# R7 sub note\n", { encoding: "utf8", flag: "wx" });
    await mkdir(join(VAULT_ROOT, ".obsidian"), { recursive: true });
    await mkdir(OUTSIDE_DIR, { recursive: true });
    await writeFile(join(OUTSIDE_DIR, "target.md"), "# outside target\n", {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await symlink(OUTSIDE_DIR, join(VAULT_ROOT, "notes", "link-dir"), "dir");
      await symlink(
        join(OUTSIDE_DIR, "target.md"),
        join(VAULT_ROOT, "notes", "link-file.md"),
        "file",
      );
    } catch (error) {
      throw new Error(
        `R7 needs real symlinks inside the isolated vault for the escape-rejection probes: ${
          (error as Error).message
        }`,
      );
    }
    // 真实主进程/host：仅 Vault 夹具是合成的。
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await clickControl('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitForVisible('[data-testid="vault-view"]', "Vault main view");
    await clickControl('[data-testid="vault-switcher-trigger"]', "Vault switcher");
    await clickControl('[data-testid="vault-create-managed"]', "create isolated managed Vault");
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector('[data-testid="vault-switcher-trigger"]')
              ?.textContent?.includes("Drora Vault"),
          ),
        ),
      { timeout: 30_000, timeoutMsg: "R7 managed Vault was not connected by production host" },
    );
    await clickControl('[data-testid="vault-tab-review"]', "review tab in real Vault");
    await waitForVisible('[data-testid="knowledge-review-view"]', "Knowledge review view");
  });

  after(async () => {
    assertSandbox();
    // 只清理本包自己创建的隔离夹具。
    await rm(NOTE_FILE, { force: true });
    await rm(SUB_NOTE, { force: true });
    await rm(join(VAULT_ROOT, "notes", "r7-new-probe.md"), { force: true });
    await rm(join(VAULT_ROOT, "notes", "link-dir"), { force: true, recursive: true });
    await rm(join(VAULT_ROOT, "notes", "link-file.md"), { force: true, recursive: true });
    await rm(join(VAULT_ROOT, ".obsidian", "r7-hidden.md"), { force: true });
    await rm(join(VAULT_ROOT, "notes", ".r7-dotfile.md"), { force: true });
    await rm(join(VAULT_ROOT, "notes", "r7-data.txt"), { force: true });
    await rm(OUTSIDE_DIR, { recursive: true, force: true });
    await browser.electron.restoreAllMocks();
  });

  it("G31 review view: released desktop-local gate, dual default-off, proposals still usable", async function () {
    this.timeout(240_000);
    // 现行口径（S03_CLOSEOUT 2026-10-17）：desktop-local 装配门放行——开关可用、
    // 无 NO-GO 横幅；两个用户开关默认双关。历史「禁用+NO-GO」形态只属于
    // remote/unspecified authority host，不在本 E2E 可达范围内。
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const toggle = document.querySelector<HTMLButtonElement>(
            '[data-testid="review-write-path-toggle"] [role="switch"]',
          );
          return Boolean(toggle && toggle.getClientRects().length > 0);
        }),
      { timeout: 30_000, timeoutMsg: "R7 L2 switch never became visible" },
    );
    const initial = await readToggleState();
    assert.deepEqual(
      initial,
      { noGo: false, enabled: true, checked: "false", agentChecked: "false" },
      "G31 current semantics: released gate + both user switches default off",
    );
    // 经 UI 授权 L1（真实 setVaultAgentWritesEnabled 写 vault-config.json）。
    // 提案创建本身是只读+账本操作、不要求 L1；但 apply 前置要求 allowAgentWrites=true
    //（§5e.5.1），且 L1 翻转会换 epoch 使既有批准失效，故在创建/批准前先授权。
    await clickControl(
      '[data-testid="review-agent-writes-toggle"] [role="switch"]',
      "grant Vault Agent writes",
    );
    await waitForVaultConfigField("allowAgentWrites", true);
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const editor = document.querySelector<HTMLInputElement>(
            '[data-testid="review-proposal-title"]',
          );
          return Boolean(editor && !editor.disabled);
        }),
      { timeout: 30_000, timeoutMsg: "G31 proposal composer never became ready" },
    );
    // 提案 A：创建 → 预览前批准禁用（未看全内容 fail-closed）→ 精确预览 → 批准。
    await fillProposal({
      title: TITLE_A,
      reason: "R7 G31/G32 dual-switch boundary proposal A",
      content: PROPOSED_A,
      clearFirst: false,
    });
    await waitForProposalCard(TITLE_A, "pending");
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      NOTE_BODY,
      "G31 creating a proposal must not write the note",
    );
    const prematureDisabled = await browser.execute((cardTitle) => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
      ).find((el) => (el.textContent ?? "").includes(cardTitle));
      const approve = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (button) => ["批准", "Approve"].includes(button.textContent?.trim() ?? ""),
      );
      return Boolean(approve?.disabled);
    }, TITLE_A);
    assert.equal(
      prematureDisabled,
      true,
      "G31 must not approve before the exact preview is reviewed",
    );
    await previewProposalChange(TITLE_A, "R7 proposal A: dual opt-in approved write");
    await clickCardAction(TITLE_A, APPROVE_ZH_EN);
    await waitForProposalCard(TITLE_A, "approvedCurrent");
    // 提案 B：创建 → 预览 → 拒绝（L2 关闭时拒绝同样可用）。
    await fillProposal({
      title: TITLE_B,
      reason: "R7 G31 reject-path proposal B",
      content: PROPOSED_B,
      clearFirst: true,
    });
    await waitForProposalCard(TITLE_B, "pending");
    await previewProposalChange(TITLE_B, "R7 proposal B: to be rejected, never written");
    await clickCardAction(TITLE_B, REJECT_ZH_EN);
    await waitForProposalCard(TITLE_B, "rejected");
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      NOTE_BODY,
      "G31 browse/preview/approve/reject with L2 off must never touch the file",
    );
    proposalAReady = true;
  });

  it("G32 hand-edited reviewWritePathEnabled=true alone grants nothing in the live host", async function () {
    this.timeout(120_000);
    if (!proposalAReady) this.skip();
    // 手改偏好文件（不重启、不走 UI 开关）：文件为 true，但引擎运行时授权不变。
    await handEditReviewWritePathPreference(true);
    const edited = await readVaultConfig();
    assert.equal(
      edited.reviewWritePathEnabled,
      true,
      "R7 hand edit must land in vault-config.json first",
    );
    const state = await rpcReview({ op: "state" });
    assert.equal(state.accessorFound, true, "R7 service accessor probe failed (fiber walk)");
    assert.equal(
      state.writePathEnabled,
      false,
      "G32 hand-edited preference alone must not flip the engine write path",
    );
    // 绕过 UI disabled 按钮直调真实 RPC：服务端必须结构化拒绝（不依赖 UI 纪律）。
    const applied = await rpcReview({ op: "applyByTitle", title: TITLE_A });
    assert.equal(applied.outcome, "blocked");
    assert.equal(
      applied.reason,
      "write_path_disabled",
      "G32 apply must fail closed with write_path_disabled despite the hand-edited file",
    );
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      NOTE_BODY,
      "G32 blocked apply must leave the Vault file untouched",
    );
    const ui = await readToggleState();
    assert.equal(ui.checked, "false", "G32 UI switch must stay unchecked after a hand edit");
    assert.equal(ui.enabled, true);
    // 还原手改，避免影响后续用例的持久化基线。
    await handEditReviewWritePathPreference(false);
  });

  it("G32/G40 dual opt-in applies, revocation re-blocks undo; reconcile stays available", async function () {
    this.timeout(180_000);
    if (!proposalAReady) this.skip();
    // 双开：L1 已在 G31 用例开启；此处经 UI 开 L2（真实 setWritePathEnabled：先落盘后翻转）。
    await clickControl(
      '[data-testid="review-write-path-toggle"] [role="switch"]',
      "explicitly enable local L2 writes",
    );
    await waitForVaultConfigField("reviewWritePathEnabled", true);
    await browser.waitUntil(
      async () => (await rpcReview({ op: "state" })).writePathEnabled === true,
      { timeout: 30_000, timeoutMsg: "R7 L2 opt-in did not flip the engine write path" },
    );
    await clickCardScopedControl(
      TITLE_A,
      '[data-testid="review-proposal-apply"]',
      "apply approved proposal through real production Host",
    );
    await browser.waitUntil(async () => (await readFile(NOTE_FILE, "utf8")) === PROPOSED_A, {
      timeout: 30_000,
      timeoutMsg: "R7 dual opt-in apply did not reach the Vault file",
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector('[data-testid="review-operation-state"]')
              ?.textContent?.match(/applied|已应用/i) !== null,
        ),
      { timeout: 30_000, timeoutMsg: "R7 applied operation missing from the real ledger" },
    );
    // 撤销 L2 用户开关：进程内立即失去写授权。
    await clickControl(
      '[data-testid="review-write-path-toggle"] [role="switch"]',
      "revoke L2 opt-in after apply",
    );
    await browser.waitUntil(
      async () => (await rpcReview({ op: "state" })).writePathEnabled === false,
      { timeout: 30_000, timeoutMsg: "R7 L2 revocation did not take effect immediately" },
    );
    // undo 直调：必须 write_path_disabled，文件保持 applied 态（G40：undo 检查当前写授权）。
    const undo = await rpcReview({ op: "undoByProposalTitle", title: TITLE_A });
    assert.equal(undo.outcome, "blocked");
    assert.equal(
      undo.reason,
      "write_path_disabled",
      "G40 undo must re-check the current Vault write authorization",
    );
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      PROPOSED_A,
      "G40 blocked undo must leave the applied content in place",
    );
    const undoButtonDisabled = await browser.execute((cardTitle) => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'),
      ).find((el) => (el.textContent ?? "").includes(cardTitle));
      return Boolean(
        card?.querySelector<HTMLButtonElement>('[data-testid="review-proposal-undo"]')?.disabled,
      );
    }, TITLE_A);
    assert.equal(undoButtonDisabled, true, "G40 UI undo button must be disabled while L2 is off");
    // 只读 reconcile 不受 L2 写开关阻断（settled 操作 → not_applicable，而非 write_path_disabled）。
    const reconcile = await rpcReview({ op: "reconcileByProposalTitle", title: TITLE_A });
    assert.equal(
      reconcile.outcome,
      "not_applicable",
      "G40 read-only reconcile must stay available with the L2 write switch off",
    );
    assert.notEqual(reconcile.reason, "write_path_disabled");
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      PROPOSED_A,
      "G40 read-only reconcile must never mutate files",
    );
    // 重新双开后 undo 才能真实恢复快照（收尾还原现场）。
    await clickControl(
      '[data-testid="review-write-path-toggle"] [role="switch"]',
      "re-enable L2 opt-in for undo",
    );
    await browser.waitUntil(
      async () => (await rpcReview({ op: "state" })).writePathEnabled === true,
      { timeout: 30_000, timeoutMsg: "R7 L2 re-enable did not flip the engine write path" },
    );
    await clickCardScopedControl(
      TITLE_A,
      '[data-testid="review-proposal-undo"]',
      "undo through the real persisted operation ledger",
    );
    await browser.waitUntil(async () => (await readFile(NOTE_FILE, "utf8")) === NOTE_BODY, {
      timeout: 30_000,
      timeoutMsg: "R7 undo did not restore the protected snapshot",
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector('[data-testid="review-operation-state"]')
              ?.textContent?.match(/undo_applied|undone|已撤销/i) !== null,
        ),
      { timeout: 30_000, timeoutMsg: "R7 undo did not settle in the real ledger" },
    );
    await clickControl(
      '[data-testid="review-write-path-toggle"] [role="switch"]',
      "revoke L2 opt-in after test",
    );
  });

  it("L1 hook matrix: allowAgentWrites gates only plain non-hidden .md Write/Edit", async function () {
    this.timeout(120_000);
    // 阶段一：L1 撤回（真实 UI 开关 → host 写 vault-config.json）。
    await clickControl(
      '[data-testid="review-agent-writes-toggle"] [role="switch"]',
      "revoke L1 agent writes",
    );
    await waitForVaultConfigField("allowAgentWrites", false);
    const revokedConfig = await readVaultConfig();
    assert.equal(
      revokedConfig.allowAgentWrites,
      false,
      "R7 hook must consume the host-written config",
    );
    const falseProbes: Array<{ name: string; stdin: Record<string, unknown> }> = [
      {
        name: "allowAgentWrites=false + Write 根内普通 .md（绝对路径）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: SUB_NOTE },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "allowAgentWrites=false + Edit 根内普通 .md（相对路径+cwd）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Edit",
          toolInput: { file_path: "notes/sub.md" },
          cwd: VAULT_ROOT,
        },
      },
    ];
    for (const probe of falseProbes) {
      assertHookProbe({ ...probe, expect: "silent", ...runPermissionHook(probe.stdin) });
    }
    // 阶段二：L1 重新授权（真实 UI 开关）。
    await clickControl(
      '[data-testid="review-agent-writes-toggle"] [role="switch"]',
      "grant L1 agent writes",
    );
    await waitForVaultConfigField("allowAgentWrites", true);
    const grantedConfig = await readVaultConfig();
    assert.equal(grantedConfig.allowAgentWrites, true);
    const allowProbes: Array<{ name: string; stdin: Record<string, unknown> }> = [
      {
        name: "L1 on + Write 根内已存在普通 .md（绝对路径）自动 allow",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: SUB_NOTE },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 根内普通 .md（相对路径+cwd）自动 allow",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/sub.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 根内新建普通 .md（ENOENT 分支）自动 allow",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/r7-new-probe.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Edit 根内普通 .md 自动 allow",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Edit",
          toolInput: { file_path: SUB_NOTE },
          cwd: VAULT_ROOT,
        },
      },
    ];
    const silentProbes: Array<{ name: string; stdin: Record<string, unknown> }> = [
      {
        name: "L1 on + Write .obsidian/ 隐藏目录不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: ".obsidian/r7-hidden.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 点文件（隐藏段）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/.r7-dotfile.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 非 .md 文件不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/r7-data.txt" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 相对路径逃出授权根（../..）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "../../../r7-l1-outside/escape.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 根外绝对路径不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: join(OUTSIDE_DIR, "abs.md") },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 经根内软链目录逃逸不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/link-dir/r7-escape.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 根内软链文件（指向根外）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/link-file.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Bash 写入命令不经本 hook 放行（静默交回运行时问询）",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Bash",
          toolInput: { command: "echo r7 > notes/sub.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + node_repl(js) 不经本 hook 放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "node_repl",
          toolInput: { code: "require('fs').writeFileSync('notes/sub.md','r7')" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + MCP 工具（含 path 输入）不经本 hook 放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "mcp__r7__write_file",
          toolInput: { path: "notes/sub.md" },
          cwd: VAULT_ROOT,
        },
      },
      {
        name: "L1 on + Write 相对路径缺 cwd（无法对齐运行时工作目录）不自动放行",
        stdin: {
          hookEventName: "PermissionRequest",
          toolName: "Write",
          toolInput: { file_path: "notes/sub.md" },
        },
      },
    ];
    for (const probe of allowProbes) {
      assertHookProbe({ ...probe, expect: "allow", ...runPermissionHook(probe.stdin) });
    }
    for (const probe of silentProbes) {
      assertHookProbe({ ...probe, expect: "silent", ...runPermissionHook(probe.stdin) });
    }
    // 逃逸目标从未被创建（hook 静默 ⇒ 运行时必须逐次问询；本测试从未批准任何写入）。
    assert.equal(
      existsSync(join(OUTSIDE_DIR, "escape.md")),
      false,
      "R7 relative escape target must not exist",
    );
    assert.equal(
      existsSync(join(OUTSIDE_DIR, "abs.md")),
      false,
      "R7 absolute escape target must not exist",
    );
    assert.equal(
      await readFile(SUB_NOTE, "utf8"),
      "# R7 sub note\n",
      "R7 hook probes must never mutate vault files",
    );
  });
});
