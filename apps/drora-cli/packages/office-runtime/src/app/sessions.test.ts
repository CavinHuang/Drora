import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createDocumentOwner,
  type DocumentSession,
} from "#office/app/documents.ts";
import { createWorkspaceFiles, type LoadedFile } from "#office/adapters/files.ts";
import type { ParsedDocument } from "#office/domain/model.ts";
import { FILE_CHUNK_BYTES } from "#office/contract.ts";

// 会话多路复用（_meta.session_id 分桶、LRU 32、逐出 dispose）的 owner 级单测。
// 场景对应 specs/official-plugin-sync-2026-10.md §7.1；行为逐条对照官方 0.2.1/0.2.2
// office 插件 dist（presentations-plugin/dist/server.mjs :43656-43851）。

const fixtures = resolve(import.meta.dirname, "../../fixtures");

/** Minimal parsed document: session logic only needs the shape, not real format parsing. */
const parseOk = async (file: LoadedFile): Promise<ParsedDocument> => ({
  kind: file.kind,
  title: null,
  units: 1,
  outline: [],
  read: () => ({ text: "", next: null }),
  search: () => [],
  check: (locator) => locator,
});

const fresh = () => createDocumentOwner({ files: createWorkspaceFiles(fixtures), parse: parseOk });

/** Load one fixture in a session and return its chunk token. */
async function tokenOf(session: DocumentSession, path = "paper.pdf") {
  return (await session.load(path)).file.token;
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("routes viewer state per session key", async () => {
  const owner = fresh();
  const a = owner.session("a");
  await a.open("report.docx");
  expect(a.current()?.path).toBe("report.docx");
  const b = owner.session("b");
  expect(b.current()).toBeNull();
  // 视图上报同样分桶
  await a.report({ viewId: "v", path: "paper.pdf", at: "page:1" });
  expect(a.view("v").path).toBe("paper.pdf");
  expect(b.view("v").path).toBeNull();
  expect(b.views()).toHaveLength(0);
});

it("falls back to the shared default session when the call has no key", () => {
  const owner = fresh();
  expect(owner.session()).toBe(owner.session("default"));
  // 空串键与缺省等价（官方 session(): key = id || DEFAULT_SESSION）
  expect(owner.session("")).toBe(owner.session("default"));
});

it("keeps the most recently used 32 sessions and evicts the least recently used", async () => {
  const owner = fresh();
  const s1 = owner.session("s1");
  const t1 = await tokenOf(s1);
  const s2 = owner.session("s2");
  const t2 = await tokenOf(s2);
  for (let i = 3; i <= 32; i++) owner.session(`s${i}`);
  // delete+set 触碰：s1 变为最新，s2 成最旧
  owner.session("s1");
  owner.session("s33");
  expect(() => owner.chunk(t2, 0)).toThrow(/file handle expired/);
  expect(() => owner.chunk(t1, -1)).toThrow(/out of range/);
});

it("disposes an evicted session's load tokens and recovers on reload", async () => {
  const owner = fresh();
  const a = owner.session("a");
  const token = await tokenOf(a);
  for (let i = 0; i < 32; i++) owner.session(`s${i}`);
  expect(() => owner.chunk(token, 0)).toThrow(/file handle expired/);
  // 同键重入得到全新会话，可重载恢复
  const reloaded = owner.session("a");
  expect(reloaded.current()).toBeNull();
  await expect(reloaded.load("paper.pdf")).resolves.toBeTruthy();
});

it("rejects an in-flight load with the official reset message when evicted mid-parse", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const owner = createDocumentOwner({
    files: createWorkspaceFiles(fixtures),
    parse: async (file) => {
      await gate;
      return parseOk(file);
    },
  });
  const victim = owner.session("victim");
  const pending = victim.load("paper.pdf");
  // 解析 await 期间被逐出（第 33 个会话加入）
  for (let i = 0; i < 32; i++) owner.session(`s${i}`);
  release();
  // 拿到 bytes 后检查 disposed：官方逐出文案（presentations dist :43775-43779）
  await expect(pending).rejects.toThrow("This viewer session was reset; reload the document.");
});

it("does not resurrect an evicted session from an in-flight view report", async () => {
  const files = createWorkspaceFiles(fixtures);
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const owner = createDocumentOwner({
    files: {
      ...files,
      resolve: async (input) => {
        await gate;
        return files.resolve(input);
      },
    },
    parse: parseOk,
  });
  const victim = owner.session("victim");
  const pending = victim.report({ viewId: "late", path: "paper.pdf" });
  for (let i = 0; i < 32; i++) owner.session(`s${i}`);
  release();
  // 在途 report 写入已分离对象后照常完成，不崩、不复活
  await expect(pending).resolves.toBeTruthy();
  expect(owner.session("victim").views()).toEqual([]);
});

it("caps load tokens at 4 per session without touching other sessions' tokens", async () => {
  const owner = fresh();
  const a = owner.session("a");
  const paths = ["report.docx", "budget.xlsx", "launch.pptx", "cjk.pdf", "paper.pdf"];
  const tokens: string[] = [];
  for (const path of paths) tokens.push(await tokenOf(a, path));
  // 第 5 个 load 淘汰的是 a 自己最旧的令牌
  expect(() => owner.chunk(tokens[0], 0)).toThrow(/file handle expired/);
  expect(() => owner.chunk(tokens[4], 0)).not.toThrow();
  const b = owner.session("b");
  const bt = await tokenOf(b);
  expect(() => owner.chunk(bt, 0)).not.toThrow();
});

it("releases a token once its last chunk is read", async () => {
  const owner = fresh();
  // 单块文件：index 0 即尾块
  const single = owner.session("single");
  const small = await single.load("paper.pdf");
  expect(small.file.chunks).toBe(1);
  expect(owner.chunk(small.file.token, 0)).toBeTruthy();
  expect(() => owner.chunk(small.file.token, 0)).toThrow(/file handle expired/);
  // 多块文件：非尾块读后令牌仍在，尾块读后释放（官方 :43863）
  const root = await mkdtemp(join(tmpdir(), "office-sessions-"));
  roots.push(root);
  await writeFile(join(root, "big.pdf"), Buffer.alloc(FILE_CHUNK_BYTES * 2 + 1, 7));
  const big = createDocumentOwner({
    files: createWorkspaceFiles(root),
    parse: parseOk,
  });
  const session = big.session("big");
  const loaded = await session.load("big.pdf");
  expect(loaded.file.chunks).toBe(3);
  expect(() => big.chunk(loaded.file.token, -1)).toThrow(/out of range/);
  expect(big.chunk(loaded.file.token, 0)).toBeTruthy();
  expect(big.chunk(loaded.file.token, 1)).toBeTruthy();
  expect(big.chunk(loaded.file.token, 2)).toBeTruthy();
  expect(() => big.chunk(loaded.file.token, 1)).toThrow(/file handle expired/);
});

it("can evict the default session too, resetting direct stdio clients", async () => {
  const owner = fresh();
  const def = owner.session();
  const token = await tokenOf(def);
  await def.open("report.docx");
  for (let i = 1; i <= 32; i++) owner.session(`s${i}`);
  // default 也是 LRU 成员：与单实例等价仅在总会话数 ≤ 32 时成立（spec §4#6）
  expect(() => owner.chunk(token, 0)).toThrow(/file handle expired/);
  expect(owner.session().current()).toBeNull();
});
