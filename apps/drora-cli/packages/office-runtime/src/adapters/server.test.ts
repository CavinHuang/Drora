import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOfficeServer, sessionOf } from "#office/adapters/server.ts";
import { createDocumentOwner } from "#office/app/documents.ts";
import { createDocumentImporter, createWorkspaceFiles, type LoadedFile } from "#office/adapters/files.ts";
import type { ParsedDocument } from "#office/domain/model.ts";

// server 级会话多路复用单测：specs/official-plugin-sync-2026-10.md §7.1。
// 接线用例经 SDK InMemoryTransport 伪造 _meta.session_id，能抓住「register 包装器漏传
// session.id / begin_file_import 漏传归属」的滑失——extra._meta 由 SDK protocol.js 从
// request.params._meta 透传（1.29.0 实测），与传输无关。

it("sessionOf prefers root_session_id, then session_id, skipping junk", () => {
  expect(sessionOf({ root_session_id: "r", session_id: "s" })).toBe("r");
  expect(sessionOf({ session_id: "s" })).toBe("s");
  // 空串与非字符串都跳过
  expect(sessionOf({ root_session_id: "", session_id: "s" })).toBe("s");
  expect(sessionOf({ root_session_id: 42, session_id: "s" })).toBe("s");
  expect(sessionOf({ session_id: "" })).toBeUndefined();
  expect(sessionOf({})).toBeUndefined();
  expect(sessionOf(undefined)).toBeUndefined();
});

const fixtures = resolve(import.meta.dirname, "../../fixtures");

/** Minimal parsed document: the wiring under test only needs the shape. */
const parseOk = async (file: LoadedFile): Promise<ParsedDocument> => ({
  kind: file.kind,
  title: null,
  units: 1,
  outline: [],
  read: () => ({ text: "", next: null }),
  search: () => [],
  check: (locator) => locator,
});

type Structured = {
  document?: { path?: string } | null;
  id?: string;
  file?: { token?: string };
  error?: { code?: string };
};
const structured = (result: unknown): Structured =>
  ((result as { structuredContent?: unknown }).structuredContent ?? {}) as Structured;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("routes calls by _meta.session_id and attributes file imports to the calling session", async () => {
  const owner = createDocumentOwner({
    files: createWorkspaceFiles(fixtures),
    parse: parseOk,
  });
  const root = await mkdtemp(join(tmpdir(), "office-server-"));
  roots.push(root);
  const importer = createDocumentImporter(root);
  const server = createOfficeServer({ owner, assetRoot: fixtures, importer });
  const client = new Client({ name: "office-server-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown>, sessionId?: string) =>
    client.callTool({
      name,
      arguments: args,
      _meta: sessionId ? { session_id: sessionId } : undefined,
    });
  try {
    // 不同 _meta.session_id 的查看器状态分桶
    await call("open_document", { path: "report.docx" }, "s1");
    await call("open_document", { path: "paper.pdf" }, "s2");
    expect(structured(await call("get_viewer", {}, "s1")).document?.path).toBe("report.docx");
    expect(structured(await call("get_viewer", {}, "s2")).document?.path).toBe("paper.pdf");
    // 无 _meta 落 default，与两个具名会话互不可见
    expect(structured(await call("get_viewer", {})).document).toBeNull();
    // load_document 同样按会话路由：两个会话各自拿到可读令牌（chunk 为 owner 级，令牌全局唯一）
    const loaded1 = structured(await call("load_document", { path: "report.docx" }, "s1"));
    const loaded2 = structured(await call("load_document", { path: "paper.pdf" }, "s2"));
    expect(loaded1.file?.token).toBeTruthy();
    expect(loaded2.file?.token).toBeTruthy();
    expect(() => owner.chunk(loaded1.file!.token!, 0)).not.toThrow();
    // 导入归属调用会话：若接线漏传 session.id，配额会全部落 default，第 5 个具名调用
    // 将与 default 的第 5 个一起失败——本断言在该滑失下必然不通过。
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const started = await call("begin_file_import", { name: "a.pdf", size: 1 }, "s1");
      expect(started.isError).toBeFalsy();
      ids.push(structured(started).id!);
    }
    const fifth = await call("begin_file_import", { name: "a.pdf", size: 1 }, "s1");
    expect(fifth.isError).toBe(true);
    expect(structured(fifth).error?.code).toBe("invalid_token");
    const other = await call("begin_file_import", { name: "b.pdf", size: 1 }, "s2");
    expect(other.isError).toBeFalsy();
    for (const id of ids) await call("cancel_file_import", { id }, "s1");
    await call("cancel_file_import", { id: structured(other).id! }, "s2");
  } finally {
    await client.close();
    await importer.close();
  }
});
