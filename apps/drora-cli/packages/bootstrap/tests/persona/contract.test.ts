import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { PERSONA_STORAGE_KEYS, PERSONA_TEMPLATE_VERSION, PERSONA_STORE_SCHEMA_VERSION } from "@drora/shared";
import { cliPersonaServiceModule } from "../../src/app/drora-persona/module.js";
import { resolvePersonaDatabasePath } from "../../src/app/drora-persona/contract.js";
import { getProductPersonaTemplate } from "../../src/app/drora-persona/product-template.js";

// 契约测试只 import contract/module/资产面，不知道实现细节；存储词汇的单一出处在此钉住。
describe("cli-persona-service contract", () => {
  it("declares its module manifest", () => {
    expect(cliPersonaServiceModule.id).toBe("cli-persona-service");
    expect(cliPersonaServiceModule.publicEntrypoints).toEqual(["index.ts", "contract.ts"]);
  });

  it("服务层只引用 shared contracts 的存储/版本词汇，不手写字面量", () => {
    expect(resolvePersonaDatabasePath("/root/cli")).toBe(
      join("/root/cli", PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database),
    );
    expect(getProductPersonaTemplate().templateVersion).toBe(PERSONA_TEMPLATE_VERSION);
    expect(PERSONA_STORE_SCHEMA_VERSION).toBe(1);
  });
});
