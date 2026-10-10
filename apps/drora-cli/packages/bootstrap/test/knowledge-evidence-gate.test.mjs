/**
 * W03 Evidence gate（CLI Runtime 只读复验）测试——specs/obsidian-knowledge.md §5.3。
 *
 * 真 gate 实现 + 真 vault-config.json + 真 SQLite 账本（共享 DDL 常量建表 = migration
 * v2 同一出处）+ 合成临时 Vault 文件；零模型/零网络。
 * 运行：node --import tsx --test apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  KNOWLEDGE_EVIDENCE_GUARDS,
  KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS,
  KNOWLEDGE_EVIDENCE_REASONS,
  knowledgeSourceFingerprint,
  normalizeContentForQuoteSelector,
} from "@drora/shared";
import {
  createKnowledgeEvidenceGate,
  resolveKnowledgeDatabasePathForGate,
} from "../src/knowledge-evidence/evidence-gate.js";
import {
  loadGateVaultConfig,
  resolveObsidianPluginDataDirForGate,
} from "../src/knowledge-evidence/vault-config-reader.js";

const NOTE_BODY = "# 证据标题\n\n独特的证据句子 gate marker one\n\n第二段 gate marker two";

function sha256(content) {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

async function writeNote(vaultRoot, relativePath, content) {
  const absolute = join(vaultRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
}

function createTestEnvRoot() {
  return mkdtemp(join(tmpdir(), "drora-gate-"));
}

/** 写 vault-config.json（形状 = services loadVaultConfig 同一形状）。 */
async function writeVaultConfig(pluginDataDir, rootPath, configuredAt) {
  await mkdir(pluginDataDir, { recursive: true });
  await writeFile(
    join(pluginDataDir, "vault-config.json"),
    JSON.stringify({
      rootPath,
      displayName: "测试库",
      inboxPath: "Inbox",
      allowAgentWrites: false,
      configuredAt,
    }),
    "utf-8",
  );
}

/** 打开账本 DB 并按共享 DDL 建表（与 migration v2 同一出处）。目录不存在时先建。 */
async function openLedgerWithSharedDdl(databasePath) {
  await mkdir(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  for (const statement of KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS) db.exec(statement);
  return db;
}

/** 插入一条真账本行：sha 都按当前文件与 quote 真算（override 可注错复验负例）。 */
async function insertReceipt(db, options) {
  const content = options.fileContent;
  const quote = options.quote;
  const chunkText = normalizeContentForQuoteSelector(content).slice(quote.startOffset, quote.endOffset);
  const realRoot = await realpath(options.vaultRoot);
  const vaultId = sha256(realRoot);
  const row = {
    receipt_id: options.receiptId,
    session_id: options.sessionId ?? "session-1",
    run_id: "run-1",
    article_id: "article-1",
    vault_id: vaultId,
    source_epoch: 1,
    source_fingerprint: knowledgeSourceFingerprint(vaultId, options.configuredAt),
    relative_path: options.relativePath,
    title: "证据标题",
    heading: null,
    file_sha256: options.wrongFileSha === true ? "f".repeat(64) : sha256(content),
    chunk_sha256: options.wrongChunkSha === true ? "0".repeat(64) : sha256(chunkText),
    start_line: quote.startLine,
    end_line: quote.endLine,
    start_offset: quote.startOffset,
    end_offset: quote.endOffset,
    excerpt: "有界摘录",
    created_at_ms: Date.now(),
  };
  db.prepare(
    `INSERT INTO evidence_receipts(
       receipt_id, session_id, run_id, article_id, vault_id, source_epoch,
       source_fingerprint, relative_path, title, heading, file_sha256, chunk_sha256,
       start_line, end_line, start_offset, end_offset, excerpt, created_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.receipt_id,
    row.session_id,
    row.run_id,
    row.article_id,
    row.vault_id,
    row.source_epoch,
    row.source_fingerprint,
    row.relative_path,
    row.title,
    row.heading,
    row.file_sha256,
    row.chunk_sha256,
    row.start_line,
    row.end_line,
    row.start_offset,
    row.end_offset,
    row.excerpt,
    row.created_at_ms,
  );
  return row;
}

/** 构造 quote：取第 startLine..endLine 行（1-based）的规范化偏移。 */
function quoteForLines(content, startLine1, endLine1) {
  const normalized = normalizeContentForQuoteSelector(content);
  const lines = normalized.split("\n");
  let startOffset = 0;
  for (let index = 0; index < startLine1 - 1; index++) startOffset += (lines[index] ?? "").length + 1;
  let endOffset = startOffset;
  for (let index = startLine1 - 1; index < endLine1; index++) endOffset += (lines[index] ?? "").length + 1;
  return { startLine: startLine1, endLine: endLine1, startOffset, endOffset: endOffset - 1 };
}

test("gate 形状守卫：非法 receiptId / 空 refs", async () => {
  const root = await createTestEnvRoot();
  let gate;
  try {
    const vaultRoot = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
    await writeNote(vaultRoot, "a.md", NOTE_BODY);
    await writeVaultConfig(pluginDataDir, vaultRoot, 111);
    const db = await openLedgerWithSharedDdl(databasePath);
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 111,
      fileContent: NOTE_BODY,
      quote: quoteForLines(NOTE_BODY, 3, 3),
      relativePath: "a.md",
      receiptId: "evr_good0000000000000000000000000001",
    });
    db.close();
    gate = createKnowledgeEvidenceGate({ pluginDataDir, databasePath });

    // 非 evr_ 前缀 → unknown（不扫表）。
    const badShape = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "session-row-1" }],
    });
    assert.equal(badShape.ok, false);
    assert.equal(badShape.guard, KNOWLEDGE_EVIDENCE_GUARDS.unknown);

    // 无 refs → 直接放行（不触 IO）。
    const noRefs = await gate.verify({ sessionId: "session-1", evidenceRefs: [] });
    assert.deepEqual(noRefs, { ok: true });
  } finally {
    gate?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gate 正例：账本 + 授权 + 文件 + quote 全部一致 → ok", async () => {
  const root = await createTestEnvRoot();
  let gate;
  try {
    const vaultRoot = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
    await writeNote(vaultRoot, "notes/a.md", NOTE_BODY);
    await writeVaultConfig(pluginDataDir, vaultRoot, 222);
    const db = await openLedgerWithSharedDdl(databasePath);
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 222,
      fileContent: NOTE_BODY,
      quote: quoteForLines(NOTE_BODY, 1, 3),
      relativePath: "notes/a.md",
      receiptId: "evr_good0000000000000000000000000002",
    });
    db.close();
    gate = createKnowledgeEvidenceGate({ pluginDataDir, databasePath });
    const verdict = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_good0000000000000000000000000002" }],
    });
    assert.deepEqual(verdict, { ok: true });
  } finally {
    gate?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gate 复验失败分型：改文件/删文件/撤权/切库/重授权/伪造/跨会话/坏账本行", async () => {
  const root = await createTestEnvRoot();
  let gate;
  try {
    const vaultRoot = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
    await writeNote(vaultRoot, "a.md", NOTE_BODY);
    await writeVaultConfig(pluginDataDir, vaultRoot, 333);
    const db = await openLedgerWithSharedDdl(databasePath);
    const quote = quoteForLines(NOTE_BODY, 3, 3);
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 333,
      fileContent: NOTE_BODY,
      quote,
      relativePath: "a.md",
      receiptId: "evr_stale0000000000000000000000000001",
    });
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 333,
      fileContent: NOTE_BODY,
      quote,
      relativePath: "a.md",
      receiptId: "evr_missing00000000000000000000000001",
    });
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 333,
      fileContent: NOTE_BODY,
      quote,
      relativePath: "a.md",
      receiptId: "evr_badsha000000000000000000000000001",
      wrongFileSha: true,
    });
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 333,
      fileContent: NOTE_BODY,
      quote,
      relativePath: "a.md",
      receiptId: "evr_badchunk0000000000000000000000001",
      wrongChunkSha: true,
    });
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 333,
      fileContent: NOTE_BODY,
      quote,
      relativePath: "a.md",
      receiptId: "evr_others000000000000000000000000001",
      sessionId: "session-other",
    });
    db.close();
    gate = createKnowledgeEvidenceGate({ pluginDataDir, databasePath });

    // 改文件 → stale/file_modified（guard.evidenceStale）。
    await writeNote(vaultRoot, "a.md", "# 证据标题\n\n内容已被修改 gate marker changed");
    const stale = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_stale0000000000000000000000000001" }],
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.guard, KNOWLEDGE_EVIDENCE_GUARDS.stale);
    assert.equal(stale.reason, KNOWLEDGE_EVIDENCE_REASONS.fileModified);

    // 删文件 → missing（guard.evidenceMissing）。删前先还原内容供其它用例。
    await writeNote(vaultRoot, "a.md", NOTE_BODY);
    await unlink(join(vaultRoot, "a.md"));
    const missing = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_missing00000000000000000000000001" }],
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.guard, KNOWLEDGE_EVIDENCE_GUARDS.missing);
    await writeNote(vaultRoot, "a.md", NOTE_BODY);

    // 账本行 file sha 被篡改（等于文件被改的等价判定）→ stale。
    const badSha = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_badsha000000000000000000000000001" }],
    });
    assert.equal(badSha.ok, false);
    assert.equal(badSha.guard, KNOWLEDGE_EVIDENCE_GUARDS.stale);

    // 账本行 chunk sha 被篡改（quote 移位等价）→ stale（A15 防线真实生效）。
    const badChunk = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_badchunk0000000000000000000000001" }],
    });
    assert.equal(badChunk.ok, false);
    assert.equal(badChunk.reason, KNOWLEDGE_EVIDENCE_REASONS.quoteMoved);

    // 跨会话 → forbidden/cross_session。
    const cross = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_others000000000000000000000000001" }],
    });
    assert.equal(cross.ok, false);
    assert.equal(cross.guard, KNOWLEDGE_EVIDENCE_GUARDS.forbidden);
    assert.equal(cross.reason, KNOWLEDGE_EVIDENCE_REASONS.crossSession);

    // 伪造 id → forbidden/unknown_receipt。
    const forged = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_forged00000000000000000000000001" }],
    });
    assert.equal(forged.ok, false);
    assert.equal(forged.guard, KNOWLEDGE_EVIDENCE_GUARDS.unknown);
    assert.equal(forged.reason, KNOWLEDGE_EVIDENCE_REASONS.unknownReceipt);

    // 切库 → forbidden/vault_switched。
    const otherVault = join(root, "vault-b");
    await writeNote(otherVault, "b.md", "另一个库");
    await writeVaultConfig(pluginDataDir, otherVault, 444);
    const switched = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_stale0000000000000000000000000001" }],
    });
    assert.equal(switched.ok, false);
    assert.equal(switched.guard, KNOWLEDGE_EVIDENCE_GUARDS.forbidden);
    assert.equal(switched.reason, KNOWLEDGE_EVIDENCE_REASONS.vaultSwitched);

    // 撤权（配置失效）→ forbidden/source_unconfigured。
    await unlink(join(pluginDataDir, "vault-config.json"));
    const revoked = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_stale0000000000000000000000000001" }],
    });
    assert.equal(revoked.ok, false);
    assert.equal(revoked.reason, KNOWLEDGE_EVIDENCE_REASONS.sourceUnconfigured);

    // 重授权同一根（configuredAt 变化）→ stale/source_reauthorized，绝不放行。
    await writeVaultConfig(pluginDataDir, vaultRoot, 555);
    const reauthed = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_stale0000000000000000000000000001" }],
    });
    assert.equal(reauthed.ok, false);
    assert.equal(reauthed.guard, KNOWLEDGE_EVIDENCE_GUARDS.stale);
    assert.equal(reauthed.reason, KNOWLEDGE_EVIDENCE_REASONS.sourceReauthorized);
  } finally {
    gate?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("gate fail-closed：无 DB / v1 无账本表 → 一律 unknown，不放行", async () => {
  const root = await createTestEnvRoot();
  let gate;
  try {
    const vaultRoot = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    await writeNote(vaultRoot, "a.md", NOTE_BODY);
    await writeVaultConfig(pluginDataDir, vaultRoot, 666);

    // 无 DB 文件。
    const gateNoDb = createKnowledgeEvidenceGate({
      pluginDataDir,
      databasePath: join(root, "knowledge", "absent.sqlite"),
    });
    const noDb = await gateNoDb.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_whatever0000000000000000000000001" }],
    });
    assert.equal(noDb.ok, false);
    assert.equal(noDb.guard, KNOWLEDGE_EVIDENCE_GUARDS.unknown);

    // v1 库（无 evidence_receipts 表）= 空 ledger。
    const v1Path = join(root, "knowledge", "v1.sqlite");
    const v1dir = dirname(v1Path);
    await mkdir(v1dir, { recursive: true });
    const v1 = new DatabaseSync(v1Path);
    v1.exec("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)");
    v1.close();
    const gateV1 = createKnowledgeEvidenceGate({ pluginDataDir, databasePath: v1Path });
    const onV1 = await gateV1.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_whatever0000000000000000000000002" }],
    });
    assert.equal(onV1.ok, false);
    assert.equal(onV1.guard, KNOWLEDGE_EVIDENCE_GUARDS.unknown);
  } finally {
    // 两个 gate 都不持有打开的连接（missing/空 ledger 路径）；无需 close。
    await rm(root, { recursive: true, force: true });
  }
});

test("gate 拒绝越界/软链路径；配置读取口径与 services 对齐", async () => {
  const root = await createTestEnvRoot();
  let gate;
  try {
    const vaultRoot = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
    await writeNote(vaultRoot, "inside.md", "根内内容");
    await writeVaultConfig(pluginDataDir, vaultRoot, 777);
    const db = await openLedgerWithSharedDdl(databasePath);
    // 账本行指向越界路径：文件不存在于根内 → missing（不读根外文件）。
    await insertReceipt(db, {
      vaultRoot,
      configuredAt: 777,
      fileContent: "根外内容",
      quote: { startLine: 1, endLine: 1, startOffset: 0, endOffset: 12 },
      relativePath: "../outside.md",
      receiptId: "evr_escape00000000000000000000000001",
    });
    db.close();
    await writeFile(join(root, "outside.md"), "根外内容", "utf-8");
    gate = createKnowledgeEvidenceGate({ pluginDataDir, databasePath });
    const escape = await gate.verify({
      sessionId: "session-1",
      evidenceRefs: [{ receiptId: "evr_escape00000000000000000000000001" }],
    });
    assert.equal(escape.ok, false);
    assert.ok(
      escape.guard === KNOWLEDGE_EVIDENCE_GUARDS.missing || escape.guard === KNOWLEDGE_EVIDENCE_GUARDS.forbidden,
      `越界路径必须被拒: ${JSON.stringify(escape)}`,
    );

    // 路径推导与 services 同式：DRORA_DATA_BASE_DIR 优先，其次 HOME。
    const derived = resolveObsidianPluginDataDirForGate({ DRORA_DATA_BASE_DIR: root, HOME: "elsewhere" });
    assert.equal(derived, join(root, ".drora", "cli", "data", "obsidian@drora-plugins-official"));
    const config = await loadGateVaultConfig(pluginDataDir);
    assert.ok(config);
    assert.equal(config.rootPath, await realpath(vaultRoot));
    assert.equal(config.configuredAt, 777);
    // DB 路径推导同式。
    const dbPath = resolveKnowledgeDatabasePathForGate({ DRORA_DATA_BASE_DIR: root, HOME: "elsewhere" });
    assert.equal(dbPath, join(root, ".drora", "knowledge", "knowledge-index.sqlite"));
  } finally {
    gate?.close();
    await rm(root, { recursive: true, force: true });
  }
});
