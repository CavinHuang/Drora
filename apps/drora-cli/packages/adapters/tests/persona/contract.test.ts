import { describe, expect, it } from "vitest";
import {
  PERSONA_ERROR_CODES,
  PERSONA_RECEIPT_SCOPES,
  PERSONA_STORE_SCHEMA_VERSION,
  PERSONA_TEMPLATE_VERSION,
  type PersonaErrorCode,
} from "@drora/shared";
import {
  isPersonaStoreError,
  openPersonaStore,
  PERSONA_STORE_DEFAULTS,
  PersonaStoreError,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
import { cliPersonaStoreModule } from "../../src/storage/persona/module.js";
import { PERSONA_MIGRATIONS } from "../../src/storage/persona/migrations.js";

/**
 * cli-persona-store 模块契约（architecture-governance 五件套）：
 * 把 SQL CHECK 词汇、默认预算/容量与 shared contracts 的单一出处逐字面量钉住；
 * 行为语义（CAS/receipt/容量/损坏区分）在 persona-store.test.ts。
 */

function checkVocabulary(tableName: string, column: string): string[] {
  const sql = PERSONA_MIGRATIONS[0]?.sql ?? "";
  const tableBlock = sql.slice(sql.indexOf(`create table if not exists ${tableName}`));
  const columnStart = tableBlock.indexOf(`${column} `);
  // 列声明在本迁移里都是单行；直接取整行再做 CHECK 词汇匹配。
  const line = tableBlock.slice(columnStart).split("\n")[0]!;
  const match = line.match(/in \(([^)]*)\)/);
  if (!match) throw new Error(`no CHECK vocabulary found for ${tableName}.${column}`);
  return match[1]!
    .split(",")
    .map((literal) => literal.trim().replaceAll("'", ""));
}

describe("cli-persona-store contract", () => {
  it("declares its module manifest", () => {
    expect(cliPersonaStoreModule).toEqual({
      id: "cli-persona-store",
      requires: ["shared", "sqlite-migrations"],
      provides: ["cli-persona-store"],
      publicEntrypoints: ["index.ts", "contract.ts"],
    });
  });

  it("receipt scope/result_code 的 CHECK 词汇与 shared contracts 逐一相等", () => {
    const scopes = checkVocabulary("persona_mutation_receipt", "scope");
    expect(scopes).toHaveLength(Object.values(PERSONA_RECEIPT_SCOPES).length);
    for (const scope of Object.values(PERSONA_RECEIPT_SCOPES)) {
      expect(scopes).toContain(scope);
    }
    // result_code 词汇 = 各变更结果 status 字面量（created/saved/unchanged）。
    expect(checkVocabulary("persona_mutation_receipt", "result_code")).toEqual([
      "created",
      "saved",
      "unchanged",
    ]);
  });

  it("core 表达枚举词汇与 PersonaEditableCore 的允许值一致", () => {
    expect(checkVocabulary("persona_core", "warmth")).toEqual(["restrained", "balanced", "warm"]);
    expect(checkVocabulary("persona_core", "directness")).toEqual(["gentle", "balanced", "direct"]);
    expect(checkVocabulary("persona_core", "humor")).toEqual(["off", "light"]);
  });

  it("默认预算/容量钉在合同 §2 初始值；阈值调整必须显式改这里", () => {
    expect(PERSONA_STORE_DEFAULTS.lockWaitTimeoutMs).toBe(100);
    expect(PERSONA_STORE_DEFAULTS.adminRequestBudgetMs).toBe(5000);
    expect(PERSONA_STORE_DEFAULTS.captureBudgetMs).toBe(250);
    expect(PERSONA_STORE_DEFAULTS.receiptRetentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(PERSONA_STORE_DEFAULTS.receiptMaxPerAuthority).toBe(4096);
    expect(PERSONA_STORE_SCHEMA_VERSION).toBe(1);
    expect(PERSONA_TEMPLATE_VERSION).toBe(1);
  });

  it("PersonaStoreError 只使用 shared contracts 封闭错误码枚举的成员", () => {
    const known = new Set(Object.values(PERSONA_ERROR_CODES));
    for (const code of [
      PERSONA_ERROR_CODES.storageUnavailable,
      PERSONA_ERROR_CODES.schemaIncompatible,
      PERSONA_ERROR_CODES.outcomeUnknown,
    ]) {
      const error = new PersonaStoreError("transport failure", { code });
      expect(known.has(error.code)).toBe(true);
      expect(isPersonaStoreError(error)).toBe(true);
    }
    // 端口语义：业务终态以 PersonaManagementResult 值返回，不经错误通道
    //（编译期由 PersonaErrorCode 封闭枚举保证，这里钉住四个业务码的成员资格）。
    const businessCodes: PersonaErrorCode[] = [
      PERSONA_ERROR_CODES.uninitialized,
      PERSONA_ERROR_CODES.revisionConflict,
      PERSONA_ERROR_CODES.mutationConflict,
      PERSONA_ERROR_CODES.storageCapacity,
    ];
    expect(businessCodes.every((code) => known.has(code))).toBe(true);
  });

  it("端口不暴露路径规则：dbPath 是唯一 open 必填输入，缺失时不回退 cwd/config 推导", async () => {
    const error = await openPersonaStore({ dbPath: "" }).catch((thrown: unknown) => thrown);
    expect(isPersonaStoreError(error)).toBe(true);
    if (isPersonaStoreError(error)) expect(error.code).toBe("storage_unavailable");
  });

  it("端口方法面保持最小（readSnapshot/initializeAuthority/updateCore/close）", () => {
    type MethodNames = keyof PersonaStorePort;
    // 编译期穷尽：接口新增方法会让下面缺键报错，删除方法则多键报错。
    // 端口语义扩展（偏好/策略域）必须先改契约与本用例，不静默加方法。
    const exhaustive: Record<MethodNames, true> = {
      readSnapshot: true,
      initializeAuthority: true,
      updateCore: true,
      close: true,
    };
    expect(Object.keys(exhaustive)).toHaveLength(4);
  });
});
