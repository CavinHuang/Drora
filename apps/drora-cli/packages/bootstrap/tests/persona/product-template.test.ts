import { describe, expect, it } from "vitest";
import { compilePersonaCore, defaultPersonaCore, validatePersonaCoreFields } from "@drora/core/persona";
import {
  PERSONA_COMPILER_VERSION,
  PERSONA_CORE_LIMITS,
  PERSONA_TEMPLATE_VERSION,
} from "@drora/shared";
import { getProductPersonaTemplate } from "../../src/app/drora-persona/product-template.js";

function codePoints(text: string): number {
  return [...text].length;
}

describe("产品模板资产（版本化、只读、随发行）", () => {
  it("版本字面量唯一出处是 shared contracts（模板/编译器版本钉住）", () => {
    const template = getProductPersonaTemplate();
    expect(template.templateVersion).toBe(PERSONA_TEMPLATE_VERSION);
    expect(template.compilerVersion).toBe(PERSONA_COMPILER_VERSION);
  });

  it("默认核心引用 cli-persona-domain 单一出处，且通过字段资格校验", () => {
    const template = getProductPersonaTemplate();
    expect(template.defaultCore).toBe(defaultPersonaCore);
    expect(validatePersonaCoreFields(template.defaultCore)).toEqual({
      status: "valid",
      core: defaultPersonaCore,
    });
  });

  it("构建期保证：默认核心编译通过且正文不超 4,000 code point", () => {
    const compiled = compilePersonaCore(getProductPersonaTemplate().defaultCore, 1);
    if (compiled.status !== "compiled") throw new Error("default core must compile");
    expect(codePoints(compiled.contribution.content)).toBeLessThanOrEqual(
      PERSONA_CORE_LIMITS.compiledContributionMax,
    );
    // 模板资产与编译输出的版本元数据一致（同一 templateVersion/compilerVersion 族）。
    expect(compiled.contribution.templateVersion).toBe(getProductPersonaTemplate().templateVersion);
    expect(compiled.contribution.compilerVersion).toBe(getProductPersonaTemplate().compilerVersion);
  });

  it("构建期保证：最坏字段组合（40/300 code point 上限）仍在编译上限内——模板超限是构建期错误，不推给用户编辑", () => {
    const worstCase = {
      displayName: "D".repeat(PERSONA_CORE_LIMITS.displayNameMax),
      selfDescription: "字".repeat(PERSONA_CORE_LIMITS.selfDescriptionMax),
      warmth: "warm",
      directness: "gentle",
      humor: "light",
    } as const;
    const compiled = compilePersonaCore(worstCase, 1);
    if (compiled.status !== "compiled") {
      throw new Error("worst-case fields must compile: template exceeds the 4000 code point budget");
    }
    expect(codePoints(compiled.contribution.content)).toBeLessThanOrEqual(
      PERSONA_CORE_LIMITS.compiledContributionMax,
    );
  });

  it("审阅字段齐备且资产冻结（运行期无人能改模板正文）", () => {
    const template = getProductPersonaTemplate();
    expect(template.identityStatement.length).toBeGreaterThan(0);
    expect(template.principles.length).toBeGreaterThan(0);
    expect(template.capabilityHonesty.length).toBeGreaterThan(0);
    expect(template.relationshipBoundary.length).toBeGreaterThan(0);
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.principles)).toBe(true);
    expect(Object.isFrozen(template.situationIds)).toBe(true);
  });

  it("v1 情境词汇为空：编译器没有情境参数，不发明不影响输出的假情境", () => {
    expect(getProductPersonaTemplate().situationIds).toEqual([]);
  });
});
